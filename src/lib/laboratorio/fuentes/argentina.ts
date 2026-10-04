import { fetchConTimeout } from "./http";

// Datos de Argentina, gratis y sin key: riesgo país (argentinadatos.com) y cotizaciones del dólar
// (dolarapi.com). Importan para YPF y VIST (empresas argentinas) y para el contexto local.
export const SERIES_ARGENTINA = [
  { id: "RIESGO_PAIS", nombre: "Riesgo país (EMBI)", unidad: "pb", variacion: "pp" },
  { id: "USD_OFICIAL", nombre: "Dólar oficial (venta)", unidad: "$", variacion: "pct" },
  { id: "USD_MEP", nombre: "Dólar MEP (venta)", unidad: "$", variacion: "pct" },
  { id: "USD_CCL", nombre: "Dólar CCL (venta)", unidad: "$", variacion: "pct" },
  { id: "USD_BLUE", nombre: "Dólar blue (venta)", unidad: "$", variacion: "pct" },
] as const;

export type ObservacionArgentina = { serie: string; fecha: string; valor: number };

export function parsearRiesgoPais(data: { valor?: number; fecha?: string }): ObservacionArgentina[] {
  if (typeof data.valor !== "number" || !Number.isFinite(data.valor) || !data.fecha) return [];
  return [{ serie: "RIESGO_PAIS", fecha: data.fecha.slice(0, 10), valor: data.valor }];
}

const SERIE_POR_CASA: Record<string, string> = {
  oficial: "USD_OFICIAL",
  bolsa: "USD_MEP",
  contadoconliqui: "USD_CCL",
  blue: "USD_BLUE",
};

// Se guarda el precio de venta con la fecha en que cada casa lo actualizó por última vez.
export function parsearDolares(
  cotizaciones: Array<{ casa?: string; venta?: number; fechaActualizacion?: string }>
): ObservacionArgentina[] {
  return cotizaciones.flatMap((cotizacion) => {
    const serie = cotizacion.casa ? SERIE_POR_CASA[cotizacion.casa] : undefined;
    if (!serie || typeof cotizacion.venta !== "number" || !(cotizacion.venta > 0) || !cotizacion.fechaActualizacion) return [];
    return [{ serie, fecha: cotizacion.fechaActualizacion.slice(0, 10), valor: cotizacion.venta }];
  });
}

async function pedirJson<T>(url: string): Promise<T> {
  const respuesta = await fetchConTimeout(url);
  if (!respuesta.ok) throw new Error(`${new URL(url).host} respondió HTTP ${respuesta.status}`);
  return (await respuesta.json()) as T;
}

export async function obtenerRiesgoPais(): Promise<ObservacionArgentina[]> {
  return parsearRiesgoPais(await pedirJson("https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo"));
}

export async function obtenerDolares(): Promise<ObservacionArgentina[]> {
  return parsearDolares(await pedirJson("https://dolarapi.com/v1/dolares"));
}
