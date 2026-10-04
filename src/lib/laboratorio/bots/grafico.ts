// Series del gráfico de los bots del laboratorio (SIMULADO) y desglose del presupuesto de IA. Funciones puras.
import { fechaNuevaYork, minutosNuevaYork } from "../config";

export type SnapshotGrafico = { bot_id: string | null; ts: string; tipo: "intradia" | "cierre"; valor_usd: number };
export type RangoGrafico = "hoy" | "semana" | "mes" | "todo";
export type SerieClave = "A" | "B" | "C" | "VOO";
export type PuntoGrafico = { t: string; etiqueta: string } & Partial<Record<SerieClave, number>>;

const DIAS_RANGO: Record<Exclude<RangoGrafico, "hoy" | "todo">, number> = { semana: 7, mes: 30 };

function etiquetaHora(ts: Date): string {
  const minutos = minutosNuevaYork(ts);
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

// `botsPorId` traduce el id de cada bot a su clave (A, B o C); el benchmark VOO viene con bot_id null.
export function armarSerieGrafico(params: {
  snapshots: SnapshotGrafico[];
  botsPorId: Record<string, "A" | "B" | "C">;
  rango: RangoGrafico;
  ahora: Date;
}): PuntoGrafico[] {
  const serieDe = (fila: SnapshotGrafico): SerieClave | null => (fila.bot_id === null ? "VOO" : (params.botsPorId[fila.bot_id] ?? null));
  const puntos = new Map<string, PuntoGrafico>();
  const poner = (t: string, etiqueta: string, serie: SerieClave, valor: number) => {
    const punto = puntos.get(t) ?? { t, etiqueta };
    punto[serie] = Math.round(valor * 100) / 100;
    puntos.set(t, punto);
  };

  if (params.rango === "hoy") {
    // La última rueda con snapshots intradía; un punto por cada tramo de 15 minutos (el último valor del tramo).
    const intradia = params.snapshots.filter((fila) => fila.tipo === "intradia" && serieDe(fila)).sort((a, b) => a.ts.localeCompare(b.ts));
    const ultimaFecha = intradia.length > 0 ? fechaNuevaYork(new Date(intradia.at(-1)!.ts)) : null;
    for (const fila of intradia) {
      const momento = new Date(fila.ts);
      if (fechaNuevaYork(momento) !== ultimaFecha) continue;
      const tramo = new Date(Math.floor(momento.getTime() / 900_000) * 900_000);
      poner(tramo.toISOString(), etiquetaHora(tramo), serieDe(fila)!, Number(fila.valor_usd));
    }
  } else {
    const desde = params.rango === "todo" ? null : fechaNuevaYork(new Date(params.ahora.getTime() - DIAS_RANGO[params.rango] * 86_400_000));
    const validas = params.snapshots.filter((fila) => serieDe(fila)).sort((a, b) => a.ts.localeCompare(b.ts));
    const ultimoCierrePorSerie = new Map<SerieClave, string>();
    for (const fila of validas) {
      if (fila.tipo !== "cierre") continue;
      const fecha = fechaNuevaYork(new Date(fila.ts));
      if (desde && fecha < desde) continue;
      poner(fecha, fecha.slice(5).split("-").reverse().join("/"), serieDe(fila)!, Number(fila.valor_usd));
      ultimoCierrePorSerie.set(serieDe(fila)!, fecha);
    }
    // El día de hoy todavía no tiene cierre: se muestra el último valor intradía para que el gráfico no quede atrasado.
    for (const fila of validas) {
      if (fila.tipo !== "intradia") continue;
      const serie = serieDe(fila)!;
      const fecha = fechaNuevaYork(new Date(fila.ts));
      if (desde && fecha < desde) continue;
      if (fecha > (ultimoCierrePorSerie.get(serie) ?? "")) poner(fecha, fecha.slice(5).split("-").reverse().join("/"), serie, Number(fila.valor_usd));
    }
  }
  return [...puntos.values()].sort((a, b) => a.t.localeCompare(b.t));
}

// --- Presupuesto de IA del mes ---

export type PresupuestoPanel = {
  gastadoUsd: number;
  topeUsd: number;
  pctUsado: number;
  porTipo: Array<{ tipo: string; etiqueta: string; usd: number }>;
  porBot: Array<{ clave: string; usd: number }>;
};

const ETIQUETAS_TIPO: Record<string, string> = {
  resumen_noticias: "Resumen de noticias (compartido)",
  diario_mercado: "Diario de mercado (compartido)",
  decision_bot: "Decisiones de los bots",
  leccion_bot: "Lecciones de los bots",
};

// `costos` son las filas de lab_costos_ia del mes. Las decisiones llevan el bot en detalle.bot (A, B, C) y
// las lecciones en detalle.bot_id (uuid), que se traduce con `botsPorId`.
export function armarPresupuestoPanel(params: {
  costos: Array<{ tipo: string; costo_usd: number; detalle: Record<string, unknown> | null }>;
  topeUsd: number;
  botsPorId: Record<string, "A" | "B" | "C">;
}): PresupuestoPanel {
  const porTipo = new Map<string, number>();
  const porBot = new Map<string, number>();
  let gastado = 0;
  for (const fila of params.costos) {
    const costo = Number(fila.costo_usd);
    if (!Number.isFinite(costo)) continue;
    gastado += costo;
    porTipo.set(fila.tipo, (porTipo.get(fila.tipo) ?? 0) + costo);
    const clave = fila.tipo === "decision_bot" ? (fila.detalle?.bot as string | undefined) : fila.tipo === "leccion_bot" ? params.botsPorId[String(fila.detalle?.bot_id ?? "")] : undefined;
    if (clave) porBot.set(clave, (porBot.get(clave) ?? 0) + costo);
  }
  const redondear = (valor: number) => Math.round(valor * 10_000) / 10_000;
  return {
    gastadoUsd: redondear(gastado),
    topeUsd: params.topeUsd,
    pctUsado: params.topeUsd > 0 ? Math.round((gastado / params.topeUsd) * 1_000) / 10 : 0,
    porTipo: [...porTipo.entries()].map(([tipo, usd]) => ({ tipo, etiqueta: ETIQUETAS_TIPO[tipo] ?? tipo, usd: redondear(usd) })).sort((a, b) => b.usd - a.usd),
    porBot: [...porBot.entries()].map(([clave, usd]) => ({ clave, usd: redondear(usd) })).sort((a, b) => a.clave.localeCompare(b.clave)),
  };
}
