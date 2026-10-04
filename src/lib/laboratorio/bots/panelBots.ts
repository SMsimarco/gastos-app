// Armado del panel de bots del laboratorio (SIMULADO). Función pura: toma filas ya leídas y devuelve lo que
// muestra la pantalla. Nunca se suma a nada real.
export const DIAS_EXPERIMENTO = 182; // 6 meses

export type DecisionBotPanel = {
  ticker: string;
  accion: string;
  montoPropuestoUsd: number;
  montoAprobadoUsd: number;
  razon: string | null;
  ajuste: string | null;
  estadoOrden: string;
  precioEjecucion: number | null;
};

export type LeccionPanel = { fecha: string; ticker: string; accion: string; resultadoPct: number; vooPct: number | null; veredicto: string; leccion: string };

export type CorridaPanel = { id: string; ts: string; estado: string; disparador: string; modelo: string | null; resumenMercado: string; error: string | null; decisiones: DecisionBotPanel[] };

export type BotPanel = {
  clave: string;
  nombre: string;
  perfil: string;
  reactivo: boolean;
  pausado: boolean;
  motivoPausa: string | null;
  valorUsd: number | null;
  efectivoUsd: number | null;
  rendimientoPct: number | null;
  costoIaUsd: number;
  lecciones: LeccionPanel[];
  posiciones: Array<{ ticker: string; valorUsd: number; resultadoPct: number | null }>;
  ultimaCorrida: CorridaPanel | null;
  historial: CorridaPanel[];
};

export type LaboratorioBotsPanel = {
  activo: boolean;
  fechaInicio: string | null;
  capitalInicialUsd: number;
  diasTranscurridos: number | null;
  diasTotales: number;
  benchmark: { valorUsd: number; rendimientoPct: number } | null;
  bots: BotPanel[];
};

type FilaBot = { id: string; clave: string; nombre: string; perfil_info: string; reactivo: boolean; pausado: boolean; motivo_pausa: string | null };
type FilaSnapshot = { bot_id: string | null; ts: string; valor_usd: number; efectivo_usd: number | null; costo_ia_acumulado_usd: number; posiciones: Array<{ ticker: string; valor_usd: number; resultado_pct?: number | null }> };
type FilaCorrida = { id: string; bot_id: string; ts: string; estado: string; disparador: string; modelo: string | null; error: string | null; respuesta_ia: { resumen_mercado?: string } | null };
type FilaLeccion = { bot_id: string; fecha_decision: string; ticker: string; accion: string; resultado_pct: number; voo_pct: number | null; veredicto: string; leccion: string };
type FilaDecision = { corrida_id: string; ticker: string; accion: string; monto_propuesto_usd: number; monto_aprobado_usd: number; razon_ia: string | null; ajuste_riesgo: string | null; estado_orden: string; precio_ejecucion: number | null };

const redondear = (valor: number) => Math.round(valor * 100) / 100;

// `snapshots` y `corridas` vienen de la más nueva a la más vieja.
export function armarPanelBots(params: {
  config: { activo: boolean; fecha_inicio: string | null; capital_inicial_usd: number } | null;
  bots: FilaBot[];
  snapshots: FilaSnapshot[];
  corridas: FilaCorrida[];
  decisiones: FilaDecision[];
  lecciones?: FilaLeccion[];
  hoy: string;
}): LaboratorioBotsPanel {
  const capital = Number(params.config?.capital_inicial_usd ?? 1_000);
  const rendimiento = (valor: number) => (capital > 0 ? redondear((valor / capital - 1) * 100) : 0);
  const orden = ["A", "B", "C"];

  const bots: BotPanel[] = [...params.bots]
    .sort((a, b) => orden.indexOf(a.clave) - orden.indexOf(b.clave))
    .map((bot) => {
      const snapshot = params.snapshots.find((fila) => fila.bot_id === bot.id);
      const corridasBot = params.corridas.filter((fila) => fila.bot_id === bot.id);
      const aPanel = (corrida: FilaCorrida): CorridaPanel => ({
        id: corrida.id,
        ts: corrida.ts,
        estado: corrida.estado,
        disparador: corrida.disparador,
        modelo: corrida.modelo,
        resumenMercado: corrida.respuesta_ia?.resumen_mercado ?? "",
        error: corrida.error,
        decisiones: params.decisiones
          .filter((decision) => decision.corrida_id === corrida.id)
          .map((decision) => ({
            ticker: decision.ticker,
            accion: decision.accion,
            montoPropuestoUsd: Number(decision.monto_propuesto_usd),
            montoAprobadoUsd: Number(decision.monto_aprobado_usd),
            razon: decision.razon_ia,
            ajuste: decision.ajuste_riesgo,
            estadoOrden: decision.estado_orden,
            precioEjecucion: decision.precio_ejecucion === null ? null : Number(decision.precio_ejecucion),
          })),
      });
      return {
        clave: bot.clave,
        nombre: bot.nombre,
        perfil: bot.perfil_info,
        reactivo: bot.reactivo,
        pausado: bot.pausado,
        motivoPausa: bot.motivo_pausa,
        valorUsd: snapshot ? Number(snapshot.valor_usd) : null,
        efectivoUsd: snapshot?.efectivo_usd === null || snapshot?.efectivo_usd === undefined ? null : Number(snapshot.efectivo_usd),
        rendimientoPct: snapshot ? rendimiento(Number(snapshot.valor_usd)) : null,
        costoIaUsd: snapshot ? Number(snapshot.costo_ia_acumulado_usd) : 0,
        lecciones: (params.lecciones ?? [])
          .filter((fila) => fila.bot_id === bot.id)
          .slice(0, 3)
          .map((fila) => ({ fecha: fila.fecha_decision, ticker: fila.ticker, accion: fila.accion, resultadoPct: Number(fila.resultado_pct), vooPct: fila.voo_pct === null ? null : Number(fila.voo_pct), veredicto: fila.veredicto, leccion: fila.leccion })),
        posiciones: (snapshot?.posiciones ?? []).map((posicion) => ({ ticker: posicion.ticker, valorUsd: Number(posicion.valor_usd), resultadoPct: posicion.resultado_pct ?? null })),
        ultimaCorrida: corridasBot[0] ? aPanel(corridasBot[0]) : null,
        historial: corridasBot.slice(0, 8).map(aPanel),
      };
    });

  const vooSnapshot = params.snapshots.find((fila) => fila.bot_id === null);
  const fechaInicio = params.config?.fecha_inicio ?? null;
  return {
    activo: Boolean(params.config?.activo),
    fechaInicio,
    capitalInicialUsd: capital,
    diasTranscurridos: fechaInicio ? Math.max(0, Math.round((Date.parse(`${params.hoy}T00:00:00Z`) - Date.parse(`${fechaInicio}T00:00:00Z`)) / 86_400_000)) : null,
    diasTotales: DIAS_EXPERIMENTO,
    benchmark: vooSnapshot ? { valorUsd: Number(vooSnapshot.valor_usd), rendimientoPct: rendimiento(Number(vooSnapshot.valor_usd)) } : null,
    bots,
  };
}
