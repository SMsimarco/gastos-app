// Comparación de los bots del laboratorio (SIMULADO): tabla de posiciones, las tres preguntas del experimento y la
// tarjeta de evaluación. Función pura que une los snapshots y las decisiones con las métricas.
import { calcularMetricasBot, compararPreguntas, redactarEvaluacion, type ComparacionPreguntas, type MetricasBot, type OperacionEvaluable } from "./metricas";

export type FilaTabla = { clave: "A" | "B" | "C" | "VOO"; nombre: string; metricas: MetricasBot };

export type ComparacionPanel = {
  tabla: FilaTabla[];
  preguntas: ComparacionPreguntas;
  evaluacion: string[];
};

type BotComparacion = { id: string; clave: "A" | "B" | "C"; nombre: string };

export function armarComparacion(params: {
  capitalUsd: number;
  diasTotales: number;
  bots: BotComparacion[];
  // Cierres diarios en orden cronológico (bot_id null = benchmark VOO).
  cierres: Array<{ bot_id: string | null; ts: string; valor_usd: number }>;
  // Snapshots de cualquier tipo, del más nuevo al más viejo: de ahí salen el valor actual y el costo de IA acumulado.
  ultimos: Array<{ bot_id: string | null; ts: string; valor_usd: number; costo_ia_acumulado_usd: number }>;
  // Decisiones ejecutadas (con orden y precio de ejecución).
  operaciones: Array<{ bot_id: string; accion: string; ticker: string; precio_ejecucion: number | null }>;
  // Último precio conocido de cada ticker.
  precios: Record<string, number>;
}): ComparacionPanel {
  const metricasDe = (botId: string | null): MetricasBot | null => {
    const ultimo = params.ultimos.find((fila) => fila.bot_id === botId);
    const operaciones: OperacionEvaluable[] =
      botId === null
        ? []
        : params.operaciones
            .filter((fila) => fila.bot_id === botId && (fila.accion === "comprar" || fila.accion === "vender") && fila.precio_ejecucion && params.precios[fila.ticker])
            .map((fila) => ({ accion: fila.accion as "comprar" | "vender", precioEjecucion: Number(fila.precio_ejecucion), precioActual: params.precios[fila.ticker] }));
    return calcularMetricasBot({
      capitalUsd: params.capitalUsd,
      serieCierre: params.cierres.filter((fila) => fila.bot_id === botId).map((fila) => ({ ts: fila.ts, valorUsd: Number(fila.valor_usd) })),
      valorActualUsd: ultimo ? Number(ultimo.valor_usd) : null,
      costoIaUsd: ultimo ? Number(ultimo.costo_ia_acumulado_usd) : 0,
      operaciones,
    });
  };

  const porClave: Record<"A" | "B" | "C" | "VOO", MetricasBot | null> = { A: null, B: null, C: null, VOO: metricasDe(null) };
  for (const bot of params.bots) porClave[bot.clave] = metricasDe(bot.id);

  const tabla: FilaTabla[] = [
    ...params.bots.flatMap((bot) => (porClave[bot.clave] ? [{ clave: bot.clave, nombre: bot.nombre, metricas: porClave[bot.clave] as MetricasBot }] : [])),
    ...(porClave.VOO ? [{ clave: "VOO" as const, nombre: "Comprar VOO y no hacer nada", metricas: porClave.VOO }] : []),
  ].sort((a, b) => b.metricas.rendimientoNetoPct - a.metricas.rendimientoNetoPct);

  const preguntas = compararPreguntas(porClave);
  return { tabla, preguntas, evaluacion: redactarEvaluacion(preguntas, params.diasTotales) };
}
