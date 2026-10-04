// Avisos del laboratorio por Telegram (SIMULADO). Máximo 3 mensajes por día. Las funciones de redacción son
// puras; el envío reserva su lugar en `alertas_enviadas` (la clave única impide pasarse del tope aunque
// dos corridas coincidan) y libera la reserva si Telegram falla.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaNuevaYork } from "../config";
import { enviarMensajeTelegram } from "../../telegram";
import { armarPanelBots, type LaboratorioBotsPanel } from "./panelBots";

export const MAX_AVISOS_LAB_POR_DIA = 3;
export const PIE_AVISO = "Experimento simulado, no es asesoramiento financiero.";

const usd = (valor: number) => `US$${valor.toFixed(2)}`;
const conSigno = (valor: number) => `${valor > 0 ? "+" : ""}${valor.toFixed(2)}%`;

export function describirEventoMercado(tipo: string, ticker: string | null, detalle: Record<string, unknown>): string {
  switch (tipo) {
    case "movimiento":
      return `${ticker} se movió ${conSigno(Number(detalle.variacion_pct))} desde la última decisión del bot`;
    case "vix":
      return `el VIX subió ${conSigno(Number(detalle.variacion_pct))}`;
    case "noticia_relevante":
      return `noticia muy relevante sobre ${ticker}${detalle.titular ? `: ${String(detalle.titular).slice(0, 120)}` : ""}`;
    case "balance_hoy":
      return `${ticker} presenta balance hoy`;
    default:
      return tipo;
  }
}

type DecisionAviso = { ticker: string; accion: string; montoAprobadoUsd: number; razon: string | null; aprobada: boolean; ajuste: string | null };

const VERBO: Record<string, string> = { comprar: "compró", vender: "vendió" };

export function redactarAvisoEvento(params: {
  bot: string;
  evento: { tipo: string; ticker: string | null; detalle: Record<string, unknown> };
  decisiones: DecisionAviso[];
  resumenMercado: string;
  estado: string;
}): string {
  const operaciones = params.decisiones.filter((decision) => decision.aprobada && decision.accion !== "mantener");
  const lineas = ["SIMULADO — plata ficticia", `Bot ${params.bot} decidió por un evento: ${describirEventoMercado(params.evento.tipo, params.evento.ticker, params.evento.detalle)}.`];
  if (params.estado === "error") lineas.push("No pudo decidir (falló la IA): no operó.");
  else if (params.estado === "sin_presupuesto") lineas.push("No decidió: se alcanzó el tope mensual de IA.");
  else if (operaciones.length === 0) lineas.push(`Decidió no operar.${params.resumenMercado ? ` ${params.resumenMercado}` : ""}`);
  else {
    for (const operacion of operaciones) {
      lineas.push(`${VERBO[operacion.accion] ?? operacion.accion} ${usd(operacion.montoAprobadoUsd)} de ${operacion.ticker}${operacion.razon ? ` porque ${operacion.razon.charAt(0).toLowerCase()}${operacion.razon.slice(1)}` : ""}`.replace(/^./, (letra) => letra.toUpperCase()));
    }
  }
  lineas.push("", PIE_AVISO);
  return lineas.join("\n");
}

// Tabla de posiciones para el resumen semanal: los tres bots y el benchmark, de mejor a peor.
export function redactarResumenLab(panel: LaboratorioBotsPanel): string[] {
  if (!panel.activo) return [];
  const filas = panel.bots
    .filter((bot) => bot.valorUsd !== null && bot.rendimientoPct !== null)
    .map((bot) => ({ nombre: `Bot ${bot.clave}`, valor: bot.valorUsd as number, rendimiento: bot.rendimientoPct as number }));
  if (panel.benchmark) filas.push({ nombre: "VOO sin tocar", valor: panel.benchmark.valorUsd, rendimiento: panel.benchmark.rendimientoPct });
  if (filas.length === 0) return ["Laboratorio (SIMULADO): todavía sin datos de cierre."];
  filas.sort((a, b) => b.rendimiento - a.rendimiento);
  return [
    `Laboratorio (SIMULADO, plata ficticia), día ${panel.diasTranscurridos ?? 0} de ${panel.diasTotales}:`,
    ...filas.map((fila, indice) => `${indice + 1}. ${fila.nombre}: ${usd(fila.valor)} (${conSigno(fila.rendimiento)})`),
    "Seis meses es poco para descartar suerte.",
  ];
}

// Envía el aviso si todavía hay cupo del día y la persona tiene Telegram vinculado.
export async function enviarAvisoLab(supabase: SupabaseClient, usuarioId: string, texto: string): Promise<"enviado" | "sin_telegram" | "sin_cupo" | "error"> {
  const { data: vinculo } = await supabase.from("telegram_vinculos").select("chat_id").eq("usuario_id", usuarioId).maybeSingle();
  if (!vinculo) return "sin_telegram";
  const hoy = fechaNuevaYork(new Date());
  let reservada: string | null = null;
  for (let numero = 1; numero <= MAX_AVISOS_LAB_POR_DIA && !reservada; numero++) {
    const clave = `lab_aviso_${numero}`;
    const { error } = await supabase.from("alertas_enviadas").insert({ usuario_id: usuarioId, clave, fecha: hoy });
    if (!error) reservada = clave;
    else if (error.code !== "23505") return "error"; // algo distinto de "ya estaba reservada"
  }
  if (!reservada) return "sin_cupo";
  try {
    await enviarMensajeTelegram(Number(vinculo.chat_id), texto);
    return "enviado";
  } catch {
    await supabase.from("alertas_enviadas").delete().eq("usuario_id", usuarioId).eq("clave", reservada).eq("fecha", hoy);
    return "error";
  }
}

// Avisa de la decisión que tomó el bot reactivo ante un evento. Lee de la base lo que decidió (lo aprobado y
// lo que recortó el gestor de riesgo) y respeta el tope de 3 avisos por día.
export async function avisarDecisionPorEvento(
  supabase: SupabaseClient,
  params: { usuarioId: string; botClave: string; corridaId?: string; estado: string; evento: { tipo: string; ticker: string | null; detalle: Record<string, unknown> } }
): Promise<"enviado" | "sin_telegram" | "sin_cupo" | "error"> {
  let decisiones: DecisionAviso[] = [];
  let resumenMercado = "";
  if (params.corridaId) {
    const [filas, corrida] = await Promise.all([
      supabase.from("lab_decisiones").select("ticker, accion, monto_aprobado_usd, razon_ia, ajuste_riesgo, estado_orden").eq("usuario_id", params.usuarioId).eq("corrida_id", params.corridaId),
      supabase.from("lab_corridas").select("respuesta_ia").eq("usuario_id", params.usuarioId).eq("id", params.corridaId).maybeSingle(),
    ]);
    decisiones = (filas.data ?? []).map((fila) => ({
      ticker: fila.ticker as string,
      accion: fila.accion as string,
      montoAprobadoUsd: Number(fila.monto_aprobado_usd),
      razon: (fila.razon_ia as string | null) ?? null,
      // Una orden que Alpaca rechazó no cuenta como operación.
      aprobada: Number(fila.monto_aprobado_usd) > 0 && !String(fila.estado_orden).startsWith("error"),
      ajuste: (fila.ajuste_riesgo as string | null) ?? null,
    }));
    resumenMercado = ((corrida.data?.respuesta_ia as { resumen_mercado?: string } | null)?.resumen_mercado ?? "").slice(0, 300);
  }
  return enviarAvisoLab(supabase, params.usuarioId, redactarAvisoEvento({ bot: params.botClave, evento: params.evento, decisiones, resumenMercado, estado: params.estado }));
}

// Líneas del laboratorio para el resumen semanal de Telegram (vacío si el laboratorio no está activo).
export async function resumenSemanalLab(supabase: SupabaseClient, usuarioId: string): Promise<string[]> {
  const [config, bots, snapshots] = await Promise.all([
    supabase.from("lab_config").select("activo, fecha_inicio, capital_inicial_usd").eq("usuario_id", usuarioId).maybeSingle(),
    supabase.from("lab_bots").select("id, clave, nombre, perfil_info, reactivo, pausado, motivo_pausa").eq("usuario_id", usuarioId),
    supabase.from("lab_snapshots").select("bot_id, ts, valor_usd, efectivo_usd, costo_ia_acumulado_usd, posiciones").eq("usuario_id", usuarioId).order("ts", { ascending: false }).limit(80),
  ]);
  if (!config.data?.activo) return [];
  const panel = armarPanelBots({
    config: config.data as { activo: boolean; fecha_inicio: string | null; capital_inicial_usd: number },
    bots: (bots.data ?? []) as Parameters<typeof armarPanelBots>[0]["bots"],
    snapshots: (snapshots.data ?? []) as Parameters<typeof armarPanelBots>[0]["snapshots"],
    corridas: [],
    decisiones: [],
    lecciones: [],
    hoy: fechaNuevaYork(new Date()),
  });
  return redactarResumenLab(panel);
}

