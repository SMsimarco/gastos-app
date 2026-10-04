// Avisos del asesor de aprender: push + Telegram. Máximo 1 aviso de aprender por semana, salvo toma de ganancia o
// revisión de tesis (que igual no se repiten más de una vez por semana por activo). Usa alertas_enviadas.
// Las funciones de servidor reciben un cliente service_role: filtran siempre por usuario_id.
import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarPush } from "../push";
import { enviarMensajeTelegram } from "../telegram";
import { evaluarCandidatos, type EstadoAprender, type ResultadoAprender } from "./aprender";
import { cargarEstadoAprender } from "./aprenderDatos";
import { redactarConIA } from "./aprenderRedaccion";
import { redactarAlertaAprender, redactarAvisoAprender } from "./aprenderTextos";
import type { Sugerencia } from "./sugerencias";

export const PREFIJO_AVISO = "aprender-aviso:";
export const PREFIJO_ALERTA = "aprender-alerta:";
const DIAS_ENTRE_AVISOS = 7;

export type AlertaHistorial = { clave: string; fecha: string };

const diasAtras = (hoy: string, dias: number) => new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);

export function claveAlerta(alerta: Sugerencia): string {
  return `${PREFIJO_ALERTA}${alerta.tipo}:${String(alerta.datos.ticker)}`;
}

// Decide qué se manda hoy. Pura: la reserva en alertas_enviadas y el envío los hace enviarAvisosAprender.
export function decidirAvisosAprender(input: { hoy: string; resultado: ResultadoAprender; historial: AlertaHistorial[]; forzarAviso?: boolean }): { enviarAviso: boolean; alertas: Sugerencia[] } {
  const limite = diasAtras(input.hoy, DIAS_ENTRE_AVISOS - 1);
  const reciente = (prefijo: string, clave?: string) => input.historial.some((item) => (clave ? item.clave === clave : item.clave.startsWith(prefijo)) && item.fecha >= limite);
  return {
    enviarAviso: input.resultado.puedeComprar && !reciente(PREFIJO_AVISO),
    alertas: input.resultado.alertas.filter((alerta) => !reciente(PREFIJO_ALERTA, claveAlerta(alerta))),
  };
}

// Guarda lo que se evaluó (con el aporte de cada criterio) para medirlo después contra VOO.
export async function registrarSugerencia(servicio: SupabaseClient, usuarioId: string, estado: EstadoAprender, resultado: ResultadoAprender, deSombra: boolean) {
  if (resultado.candidatos.length === 0) return null;
  const candidatos = resultado.candidatos.map((candidato) => ({
    ticker: candidato.ticker,
    puntaje: candidato.puntaje,
    precio: estado.datos[candidato.ticker]?.precio?.valor ?? null,
    aportes: Object.fromEntries(candidato.componentes.filter((fila) => fila.aporte !== null).map((fila) => [fila.criterio, fila.aporte])),
  }));
  const { data, error } = await servicio
    .from("aprender_sugerencias")
    .upsert({ usuario_id: usuarioId, fecha: estado.hoy, saldo_usd: resultado.saldoUsd, de_sombra: deSombra, candidatos, voo_precio: estado.voo?.precio?.valor ?? null }, { onConflict: "usuario_id,fecha,de_sombra" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function enviarPorCanales(servicio: SupabaseClient, usuarioId: string, texto: string) {
  const { data: vinculo } = await servicio.from("telegram_vinculos").select("chat_id").eq("usuario_id", usuarioId).maybeSingle();
  const resultados = await Promise.allSettled([
    enviarPush(servicio, usuarioId, { title: "Aprender", body: texto.split("\n").slice(0, 3).join(" ").slice(0, 280) }),
    vinculo ? enviarMensajeTelegram(Number(vinculo.chat_id), texto) : Promise.resolve(),
  ]);
  return resultados.some((resultado) => resultado.status === "fulfilled");
}

function hechosDe(resultado: ResultadoAprender) {
  return {
    saldoUsd: Math.round(resultado.saldoUsd),
    candidatos: resultado.candidatos.map((candidato) => ({ ticker: candidato.ticker, puntaje: Math.round(candidato.puntaje), porQueSi: candidato.porQueSi, porQueNo: candidato.porQueNo, balanceEnDias: candidato.balanceEnDias })),
    opcionEsperar: resultado.opcionEsperar.motivo,
  };
}

// Se llama después de aplicar un reparto (y desde el job diario como respaldo). Nunca lanza: un aviso fallido no
// puede romper el reparto.
export async function enviarAvisosAprender(servicio: SupabaseClient, usuarioId: string): Promise<{ aviso: boolean; alertas: number; falta?: number; error?: string }> {
  try {
    const { estado } = await cargarEstadoAprender(servicio, usuarioId);
    const resultado = evaluarCandidatos(estado);
    const { data: historial } = await servicio.from("alertas_enviadas").select("clave, fecha").eq("usuario_id", usuarioId).like("clave", "aprender-%").gte("fecha", diasAtras(estado.hoy, DIAS_ENTRE_AVISOS));
    const decision = decidirAvisosAprender({ hoy: estado.hoy, resultado, historial: (historial ?? []) as AlertaHistorial[] });
    let alertas = 0;
    for (const alerta of decision.alertas) {
      const { error } = await servicio.from("alertas_enviadas").insert({ usuario_id: usuarioId, clave: claveAlerta(alerta), fecha: estado.hoy });
      if (error) continue;
      await enviarPorCanales(servicio, usuarioId, redactarAlertaAprender(alerta));
      alertas += 1;
    }
    if (!decision.enviarAviso) return { aviso: false, alertas, falta: resultado.faltaUsd };
    const claveAviso = `${PREFIJO_AVISO}${estado.hoy}`;
    const { error: errorReserva } = await servicio.from("alertas_enviadas").insert({ usuario_id: usuarioId, clave: claveAviso, fecha: estado.hoy });
    if (errorReserva) return { aviso: false, alertas };
    try {
      const base = redactarAvisoAprender(resultado);
      const texto = await redactarConIA(base, hechosDe(resultado), { maxLineas: 5 });
      await registrarSugerencia(servicio, usuarioId, estado, resultado, false);
      if (!(await enviarPorCanales(servicio, usuarioId, texto))) throw new Error("No pude enviar el aviso por ningún canal");
    } catch (errorEnvio) {
      // Si no salió, se libera el lugar para que el próximo intento (el job diario) lo reintente.
      await servicio.from("alertas_enviadas").delete().eq("usuario_id", usuarioId).eq("clave", claveAviso).eq("fecha", estado.hoy);
      throw errorEnvio;
    }
    return { aviso: true, alertas };
  } catch (error) {
    return { aviso: false, alertas: 0, error: error instanceof Error ? error.message : "Error desconocido" };
  }
}
