// Armado del panel en vivo (SIMULADO). Funciones puras: toman filas ya leídas de la base y
// devuelven lo que muestra la pantalla.
import { fechaNuevaYork } from "./config";
import { SERIES_MACRO } from "./fuentes/fred";
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

export type FilaMacroPanel = {
  serie: string;
  nombre: string;
  unidad: string;
  valor: number;
  fecha: string;
  variacion: number | null;
  tipoVariacion: "pct" | "pp" | "interanual";
};

const SERIES_CON_VARIACION_PCT = new Set(["VIXCLS", "DCOILWTICO"]);

function mesesEntre(desde: string, hasta: string): number {
  const a = new Date(`${desde}T00:00:00Z`);
  const b = new Date(`${hasta}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

// `filas` de una misma serie, de la más nueva a la más vieja.
export function resumirMacro(serie: string, filas: Array<{ fecha: string; valor: number }>): FilaMacroPanel | null {
  const meta = SERIES_MACRO.find((item) => item.id === serie);
  if (!meta || filas.length === 0) return null;
  const [ultima, anterior] = filas;
  const base = { serie, nombre: meta.nombre, unidad: meta.unidad, valor: ultima.valor, fecha: ultima.fecha };

  if (serie === "CPIAUCSL") {
    // Inflación interanual: contra la observación de 12 meses atrás.
    const hace12 = filas.find((fila) => mesesEntre(fila.fecha, ultima.fecha) === 12);
    return { ...base, variacion: hace12 && hace12.valor > 0 ? Math.round((ultima.valor / hace12.valor - 1) * 10_000) / 100 : null, tipoVariacion: "interanual" };
  }
  if (!anterior) return { ...base, variacion: null, tipoVariacion: SERIES_CON_VARIACION_PCT.has(serie) ? "pct" : "pp" };
  if (SERIES_CON_VARIACION_PCT.has(serie)) {
    return { ...base, variacion: anterior.valor > 0 ? Math.round((ultima.valor / anterior.valor - 1) * 10_000) / 100 : null, tipoVariacion: "pct" };
  }
  return { ...base, variacion: Math.round((ultima.valor - anterior.valor) * 100) / 100, tipoVariacion: "pp" };
}

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
