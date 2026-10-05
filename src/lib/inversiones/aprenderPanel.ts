// Datos de la sección "Aprender" de la pestaña Plan. Solo lectura, con el cliente del usuario (RLS).
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluarCandidatos, MIN_CASOS_HISTORIAL } from "./aprender";
import { cargarEstadoAprender } from "./aprenderDatos";
import { compararConVoo, type FlujoAprender } from "./aprenderRendimiento";
import { redactarFaltaAprender } from "./aprenderTextos";
import { DISCLAIMER_FINANCIERO } from "./avisos";

export async function obtenerPanelAprender(supabase: SupabaseClient, usuarioId: string) {
  const { estado, contexto } = await cargarEstadoAprender(supabase, usuarioId);
  const resultado = evaluarCandidatos(estado);

  const idsAprender = contexto.activosPolitica.filter((activo) => activo.bolsillo_clave === "aprender").map((activo) => activo.id);
  const [{ data: operaciones }, { data: preciosVoo }, { data: propuestas }, { count: casosMedidos }, { data: ultimasSugerencias }] = await Promise.all([
    idsAprender.length ? supabase.from("operaciones").select("fecha, tipo, monto_usd").eq("usuario_id", usuarioId).in("activo_id", idsAprender).order("fecha") : Promise.resolve({ data: [] }),
    supabase.from("precios").select("fecha, cierre_usd").eq("ticker", "VOO").order("fecha"),
    supabase.from("aprender_propuestas_pesos").select("id, mes, pesos_actuales, pesos_propuestos, evidencia, created_at").eq("usuario_id", usuarioId).eq("estado", "pendiente").order("created_at", { ascending: false }),
    supabase.from("aprender_resultados").select("id", { count: "exact", head: true }).eq("usuario_id", usuarioId),
    supabase.from("aprender_sugerencias").select("fecha, de_sombra").eq("usuario_id", usuarioId).order("fecha", { ascending: false }).limit(1),
  ]);

  const flujos: FlujoAprender[] = (operaciones ?? []).map((operacion) => ({ fecha: String(operacion.fecha), tipo: operacion.tipo as FlujoAprender["tipo"], montoUsd: Number(operacion.monto_usd) }));
  const vooSerie = (preciosVoo ?? []).map((fila) => ({ fecha: String(fila.fecha), precio: Number(fila.cierre_usd) }));
  const vooActual = estado.voo?.precio?.valor ?? vooSerie.at(-1)?.precio ?? null;
  const valorPosicionesUsd = estado.activos.reduce((total, activo) => total + activo.valorPosicionUsd, 0);
  const rendimiento = flujos.length ? compararConVoo({ flujos, valorActualUsd: valorPosicionesUsd, vooSerie, vooActualUsd: vooActual }) : null;

  return {
    saldoUsd: resultado.saldoUsd,
    minimoCompraUsd: estado.minimoCompraUsd,
    puedeComprar: resultado.puedeComprar,
    faltaUsd: resultado.faltaUsd,
    textoFalta: resultado.puedeComprar ? null : redactarFaltaAprender(resultado),
    candidatos: resultado.candidatos,
    excluidos: resultado.excluidos,
    voo: resultado.voo,
    opcionEsperar: resultado.opcionEsperar,
    alertas: resultado.alertas,
    advertencias: resultado.advertencias,
    pesos: estado.pesos,
    usarHistorialBots: Boolean((contexto.config as unknown as { usar_historial_bots?: boolean }).usar_historial_bots),
    activos: contexto.activosPolitica
      .filter((activo) => activo.bolsillo_clave === "aprender")
      .map((activo) => {
        const datos = estado.datos[activo.ticker];
        const posicion = estado.activos.find((item) => item.ticker === activo.ticker);
        return {
          id: activo.id,
          ticker: activo.ticker,
          tesis: activo.tesis ?? "",
          tomaGananciaPct: activo.toma_ganancia_pct === null ? null : Number(activo.toma_ganancia_pct),
          stopRevisionPct: activo.stop_revision_pct === null ? null : Number(activo.stop_revision_pct),
          valorPosicionUsd: posicion?.valorPosicionUsd ?? 0,
          gananciaPct: posicion?.gananciaPct ?? 0,
          conDatosDelLaboratorio: Boolean(datos?.precio),
        };
      }),
    rendimiento,
    historial: {
      porCriterio: estado.historial ?? {},
      casosMedidos: casosMedidos ?? 0,
      minCasos: MIN_CASOS_HISTORIAL,
      ultimaEvaluacion: ultimasSugerencias?.[0] ? { fecha: String(ultimasSugerencias[0].fecha), deSombra: Boolean(ultimasSugerencias[0].de_sombra) } : null,
    },
    propuestasPesos: (propuestas ?? []).map((propuesta) => ({ id: String(propuesta.id), mes: String(propuesta.mes), pesosActuales: propuesta.pesos_actuales, pesosPropuestos: propuesta.pesos_propuestos, texto: (propuesta.evidencia as { texto?: string } | null)?.texto ?? "" })),
    descargo: DISCLAIMER_FINANCIERO,
  };
}

export type PanelAprender = Awaited<ReturnType<typeof obtenerPanelAprender>>;
