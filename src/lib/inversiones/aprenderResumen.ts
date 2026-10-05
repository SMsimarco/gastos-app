// Sección "Aprender" del resumen semanal del domingo: saldo, posiciones contra VOO en el mismo período, algo para
// revisar y una línea de lo que aprendió el asesor esa semana. Todo sale de números calculados por el código.
import type { SupabaseClient } from "@supabase/supabase-js";
import { cargarEstadoAprender } from "./aprenderDatos";
import { evaluarCandidatos } from "./aprender";
import { descripcionPropuesta, lineaDiarioAprendizaje, type MedidaSemana } from "./aprenderHistorial";
import { compararConVoo, type FlujoAprender } from "./aprenderRendimiento";
import { redactarResumenAprender } from "./aprenderTextos";

const diasAtras = (hoy: string, dias: number) => new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);

// Líneas para pegar en el resumen. Vacío si el usuario no usa aprender (sin activos ni saldo).
export async function resumenSemanalAprender(supabase: SupabaseClient, usuarioId: string): Promise<string[]> {
  const { estado, contexto } = await cargarEstadoAprender(supabase, usuarioId);
  if (estado.activos.length === 0 && estado.saldoAprenderUsd <= 0) return [];
  const resultado = evaluarCandidatos(estado);

  const ids = contexto.activosPolitica.filter((activo) => activo.bolsillo_clave === "aprender").map((activo) => activo.id);
  const [{ data: operaciones }, { data: preciosVoo }, { data: medidas }, { data: propuestas }] = await Promise.all([
    ids.length ? supabase.from("operaciones").select("activo_id, fecha, tipo, monto_usd").eq("usuario_id", usuarioId).in("activo_id", ids) : Promise.resolve({ data: [] }),
    supabase.from("precios").select("fecha, cierre_usd").eq("ticker", "VOO").order("fecha"),
    supabase.from("aprender_resultados").select("ticker, semanas, rendimiento_pct, voo_pct, gano_a_voo").eq("usuario_id", usuarioId).gte("created_at", `${diasAtras(estado.hoy, 7)}T00:00:00Z`),
    supabase.from("aprender_propuestas_pesos").select("pesos_actuales, pesos_propuestos, evidencia").eq("usuario_id", usuarioId).eq("estado", "pendiente"),
  ]);
  const vooSerie = (preciosVoo ?? []).map((fila) => ({ fecha: String(fila.fecha), precio: Number(fila.cierre_usd) }));
  const vooActual = estado.voo?.precio?.valor ?? vooSerie.at(-1)?.precio ?? null;

  const posiciones = estado.activos
    .filter((activo) => activo.valorPosicionUsd > 0)
    .map((activo) => {
      const idActivo = contexto.activosPolitica.find((item) => item.ticker === activo.ticker)?.id;
      const flujos: FlujoAprender[] = (operaciones ?? []).filter((operacion) => operacion.activo_id === idActivo).map((operacion) => ({ fecha: String(operacion.fecha), tipo: operacion.tipo as FlujoAprender["tipo"], montoUsd: Number(operacion.monto_usd) }));
      const comparacion = compararConVoo({ flujos, valorActualUsd: activo.valorPosicionUsd, vooSerie, vooActualUsd: vooActual });
      return { ticker: activo.ticker, gananciaPct: comparacion.gananciaPct ?? activo.gananciaPct, vooPct: comparacion.siVooPct };
    });

  const medidasSemana: MedidaSemana[] = (medidas ?? []).map((fila) => ({ ticker: String(fila.ticker), semanas: Number(fila.semanas), rendimientoPct: Number(fila.rendimiento_pct), vooPct: Number(fila.voo_pct), ganoAVoo: Boolean(fila.gano_a_voo) }));
  const lineas = redactarResumenAprender({
    saldoUsd: resultado.saldoUsd,
    faltaUsd: resultado.faltaUsd,
    posiciones,
    alertas: resultado.alertas,
    aprendizaje: lineaDiarioAprendizaje(medidasSemana),
  });
  for (const propuesta of propuestas ?? []) {
    const texto = (propuesta.evidencia as { texto?: string } | null)?.texto;
    if (texto) lineas.push(texto);
    else lineas.push(descripcionPropuesta(propuesta.pesos_actuales, { pesosPropuestos: propuesta.pesos_propuestos, evidencia: [] }));
  }
  return lineas;
}
