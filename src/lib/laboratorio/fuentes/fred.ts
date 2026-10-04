import { fetchConTimeout } from "./http";

// FRED (Reserva Federal de St. Louis): API gratuita con key. Sin límite por minuto documentado
// en `series/observations`. `variacion` define cómo se muestra el cambio en el panel:
// pct = % contra la observación anterior, pp = diferencia en puntos, interanual = contra 12 meses atrás.
export const SERIES_MACRO = [
  { id: "DFF", nombre: "Tasa de la Fed (efectiva)", unidad: "%", observaciones: 40, variacion: "pp" },
  { id: "CPIAUCSL", nombre: "Inflación EE.UU. (índice CPI)", unidad: "índice", observaciones: 16, variacion: "interanual" },
  { id: "UNRATE", nombre: "Desempleo EE.UU.", unidad: "%", observaciones: 16, variacion: "pp" },
  { id: "T10Y2Y", nombre: "Curva 10 años − 2 años", unidad: "pp", observaciones: 40, variacion: "pp" },
  { id: "VIXCLS", nombre: "VIX", unidad: "puntos", observaciones: 40, variacion: "pct" },
  { id: "DCOILWTICO", nombre: "Petróleo WTI", unidad: "US$", observaciones: 40, variacion: "pct" },
  { id: "DGS10", nombre: "Bono EE.UU. a 10 años", unidad: "%", observaciones: 40, variacion: "pp" },
  { id: "DGS2", nombre: "Bono EE.UU. a 2 años", unidad: "%", observaciones: 40, variacion: "pp" },
  { id: "BAMLH0A0HYM2", nombre: "Spread de crédito high yield", unidad: "pp", observaciones: 40, variacion: "pp" },
  { id: "ICSA", nombre: "Pedidos semanales de subsidio por desempleo", unidad: "pedidos", observaciones: 20, variacion: "pct" },
  { id: "UMCSENT", nombre: "Confianza del consumidor (Michigan)", unidad: "puntos", observaciones: 16, variacion: "pp" },
  { id: "DTWEXBGS", nombre: "Índice dólar (amplio)", unidad: "índice", observaciones: 40, variacion: "pct" },
] as const;

export type SerieMacroId = (typeof SERIES_MACRO)[number]["id"];
export type ObservacionMacro = { fecha: string; valor: number };

// Publicaciones macro que mueven el mercado: ids de release de FRED (verificados el 2026-10-04).
export const PUBLICACIONES_MACRO = [
  { releaseId: 10, codigo: "CPI", nombre: "Inflación de EE.UU. (CPI)" },
  { releaseId: 50, codigo: "EMPLEO", nombre: "Informe de empleo de EE.UU." },
  { releaseId: 53, codigo: "PBI", nombre: "PBI de EE.UU." },
  { releaseId: 46, codigo: "PPI", nombre: "Precios al productor (PPI)" },
  { releaseId: 54, codigo: "PCE", nombre: "Ingresos y gasto personal (PCE)" },
  { releaseId: 9, codigo: "VENTAS", nombre: "Ventas minoristas de EE.UU." },
] as const;

// FRED manda "." cuando no hay dato ese día.
export function parsearObservaciones(observaciones: Array<{ date?: string; value?: string }>): ObservacionMacro[] {
  return observaciones.flatMap((observacion) => {
    const valor = Number(observacion.value);
    if (!observacion.date || observacion.value === "." || !Number.isFinite(valor)) return [];
    return [{ fecha: observacion.date, valor }];
  });
}

function key(): string {
  const valor = process.env.FRED_API_KEY;
  if (!valor) throw new Error("Falta FRED_API_KEY");
  return valor;
}

export async function obtenerSerieFred(id: string, limite: number): Promise<ObservacionMacro[]> {
  const params = new URLSearchParams({ series_id: id, api_key: key(), file_type: "json", sort_order: "desc", limit: String(limite) });
  const respuesta = await fetchConTimeout(`https://api.stlouisfed.org/fred/series/observations?${params}`);
  // No se imprime la URL en el error: lleva la api_key.
  if (!respuesta.ok) throw new Error(`FRED respondió HTTP ${respuesta.status} para ${id}`);
  const data = (await respuesta.json()) as { observations?: Array<{ date?: string; value?: string }> };
  return parsearObservaciones(data.observations ?? []);
}

// Próximas fechas de una publicación (por ejemplo el CPI), a partir de `desde` (YYYY-MM-DD).
export function parsearFechasPublicacion(fechas: Array<{ date?: string }>): string[] {
  return fechas.flatMap((fila) => (fila.date && /^\d{4}-\d{2}-\d{2}$/.test(fila.date) ? [fila.date] : []));
}

export async function obtenerFechasPublicacion(releaseId: number, desde: string, cantidad = 3): Promise<string[]> {
  const params = new URLSearchParams({
    release_id: String(releaseId),
    api_key: key(),
    file_type: "json",
    realtime_start: desde,
    realtime_end: "9999-12-31",
    include_release_dates_with_no_data: "true",
    sort_order: "asc",
    limit: String(cantidad),
  });
  const respuesta = await fetchConTimeout(`https://api.stlouisfed.org/fred/release/dates?${params}`);
  if (!respuesta.ok) throw new Error(`FRED respondió HTTP ${respuesta.status} para la publicación ${releaseId}`);
  const data = (await respuesta.json()) as { release_dates?: Array<{ date?: string }> };
  return parsearFechasPublicacion(data.release_dates ?? []);
}
