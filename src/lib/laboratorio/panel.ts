// Armado del panel en vivo (SIMULADO). Funciones puras: toman filas ya leídas de la base y
// devuelven lo que muestra la pantalla.
import { fechaNuevaYork } from "./config";
import { SERIES_ARGENTINA } from "./fuentes/argentina";
import { SERIES_MACRO } from "./fuentes/fred";
import { consensoAnalistas, resumenInsiders, type ConsensoAnalistas, type ResumenInsiders } from "./fundamentales";
import type { TareaLab } from "./recoleccion";

export type FilaIndicadoresPanel = {
  fecha: string;
  cierre: number;
  cierre_anterior: number | null;
  rsi14: number | null;
  distancia_max52s: number | null;
  sma50: number | null;
  variacion_dia: number | null;
};

// Variación del día de un precio intradía. La referencia es el cierre de la rueda anterior: si la
// fila de indicadores ya incluye la rueda de hoy (se calculó después del cierre), esa referencia
// es `cierre_anterior`; si todavía es la de ayer, es `cierre`.
export function variacionDelDia(precio: { valor: number; ts: string }, fila: Pick<FilaIndicadoresPanel, "fecha" | "cierre" | "cierre_anterior">): number | null {
  const fechaPrecio = fechaNuevaYork(new Date(precio.ts));
  let referencia: number | null;
  if (fechaPrecio > fila.fecha) referencia = fila.cierre;
  else if (fechaPrecio === fila.fecha) referencia = fila.cierre_anterior;
  else return null; // el precio es más viejo que los indicadores
  if (!referencia || referencia <= 0) return null;
  return Math.round((precio.valor / referencia - 1) * 10_000) / 100;
}

// --- Macro y Argentina ---

export type TipoVariacion = "pct" | "pp" | "interanual";
export type GrupoMacro = "eeuu" | "argentina";

type MetaSerie = { id: string; nombre: string; unidad: string; variacion: TipoVariacion; grupo: GrupoMacro };

export const SERIES_PANEL: MetaSerie[] = [
  ...SERIES_MACRO.map((serie) => ({ id: serie.id, nombre: serie.nombre, unidad: serie.unidad, variacion: serie.variacion as TipoVariacion, grupo: "eeuu" as const })),
  ...SERIES_ARGENTINA.map((serie) => ({ id: serie.id, nombre: serie.nombre, unidad: serie.unidad, variacion: serie.variacion as TipoVariacion, grupo: "argentina" as const })),
];

export type FilaMacroPanel = {
  serie: string;
  nombre: string;
  unidad: string;
  grupo: GrupoMacro;
  valor: number;
  fecha: string;
  variacion: number | null;
  tipoVariacion: TipoVariacion;
};

function mesesEntre(desde: string, hasta: string): number {
  const a = new Date(`${desde}T00:00:00Z`);
  const b = new Date(`${hasta}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

// `filas` de una misma serie, de la más nueva a la más vieja.
export function resumirMacro(serie: string, filas: Array<{ fecha: string; valor: number }>): FilaMacroPanel | null {
  const meta = SERIES_PANEL.find((item) => item.id === serie);
  if (!meta || filas.length === 0) return null;
  const [ultima, anterior] = filas;
  const base = { serie, nombre: meta.nombre, unidad: meta.unidad, grupo: meta.grupo, valor: ultima.valor, fecha: ultima.fecha };

  if (meta.variacion === "interanual") {
    // Inflación interanual: contra la observación de 12 meses atrás.
    const hace12 = filas.find((fila) => mesesEntre(fila.fecha, ultima.fecha) === 12);
    return { ...base, variacion: hace12 && hace12.valor > 0 ? Math.round((ultima.valor / hace12.valor - 1) * 10_000) / 100 : null, tipoVariacion: "interanual" };
  }
  if (!anterior) return { ...base, variacion: null, tipoVariacion: meta.variacion };
  if (meta.variacion === "pct") {
    return { ...base, variacion: anterior.valor > 0 ? Math.round((ultima.valor / anterior.valor - 1) * 10_000) / 100 : null, tipoVariacion: "pct" };
  }
  return { ...base, variacion: Math.round((ultima.valor - anterior.valor) * 100) / 100, tipoVariacion: "pp" };
}

// --- Fundamentales, analistas, sorpresas e insiders ---

export type FilaFundamentalPanel = {
  ticker: string;
  fechaDatos: string | null;
  pe: number | null;
  margenNeto: number | null;
  crecimientoIngresos: number | null;
  beta: number | null;
  rendimiento26s: number | null;
  analistas: (ConsensoAnalistas & { periodo: string }) | null;
  sorpresa: { pct: number; periodo: string } | null;
  insiders: ResumenInsiders | null;
};

type FilaAnalistas = { ticker: string; periodo: string; strong_buy: number; buy: number; hold: number; sell: number; strong_sell: number };

// Todas las listas vienen de la más nueva a la más vieja; de cada ticker se toma la primera fila.
export function armarFundamentales(params: {
  empresas: string[];
  fundamentales: Array<{ ticker: string; fecha: string; datos: Record<string, number | null> }>;
  analistas: FilaAnalistas[];
  sorpresas: Array<{ ticker: string; periodo: string; sorpresa_pct: number | null }>;
  insiders: Array<{ ticker: string; codigo: string; fecha_transaccion: string; cambio_acciones: number }>;
  hoy: string;
}): FilaFundamentalPanel[] {
  const primera = <T extends { ticker: string }>(filas: T[], ticker: string) => filas.find((fila) => fila.ticker === ticker);
  return params.empresas.map((ticker) => {
    const fundamental = primera(params.fundamentales, ticker);
    const analista = primera(params.analistas, ticker);
    const consenso = analista ? consensoAnalistas(analista) : null;
    const sorpresa = primera(params.sorpresas, ticker);
    const movimientos = params.insiders.filter((fila) => fila.ticker === ticker);
    const datos = fundamental?.datos;
    return {
      ticker,
      fechaDatos: fundamental?.fecha ?? null,
      pe: datos?.pe ?? null,
      margenNeto: datos?.margen_neto ?? null,
      crecimientoIngresos: datos?.crecimiento_ingresos ?? null,
      beta: datos?.beta ?? null,
      rendimiento26s: datos?.rendimiento_26s ?? null,
      analistas: analista && consenso ? { ...consenso, periodo: analista.periodo } : null,
      sorpresa: sorpresa && sorpresa.sorpresa_pct !== null ? { pct: sorpresa.sorpresa_pct, periodo: sorpresa.periodo } : null,
      insiders: fundamental || movimientos.length > 0 ? resumenInsiders(movimientos, params.hoy) : null,
    };
  });
}

// --- Estado de las tareas ---

export type EstadoFuente = { tarea: TareaLab; ts: string; ok: boolean; error: string | null };

// `ejecuciones` de la más nueva a la más vieja: se queda con la última de cada tarea. Una tarea sin
// corridas en las últimas `maxHoras` (por ejemplo una pausada) no se muestra, para no dejar un error viejo en pantalla.
export function ultimaEjecucionPorTarea(
  ejecuciones: Array<{ tarea: TareaLab; ts: string; ok: boolean; error: string | null }>,
  ahora: Date = new Date(),
  maxHoras = 36
): EstadoFuente[] {
  const vistas = new Set<TareaLab>();
  const resultado: EstadoFuente[] = [];
  for (const ejecucion of ejecuciones) {
    if (vistas.has(ejecucion.tarea)) continue;
    if (ahora.getTime() - new Date(ejecucion.ts).getTime() > maxHoras * 3_600_000) continue;
    vistas.add(ejecucion.tarea);
    resultado.push(ejecucion);
  }
  return resultado;
}
