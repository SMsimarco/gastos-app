import { fetchConTimeout } from "./http";

// FRED (Reserva Federal de St. Louis): API gratuita con key. Sin límite por minuto documentado
// en el endpoint de observaciones; con 6 series por día no hay riesgo.
export const SERIES_MACRO = [
  { id: "DFF", nombre: "Tasa de la Fed (efectiva)", unidad: "%", observaciones: 40 },
  { id: "CPIAUCSL", nombre: "Inflación EE.UU. (índice CPI)", unidad: "índice", observaciones: 16 },
  { id: "UNRATE", nombre: "Desempleo EE.UU.", unidad: "%", observaciones: 16 },
  { id: "T10Y2Y", nombre: "Curva 10 años − 2 años", unidad: "pp", observaciones: 40 },
  { id: "VIXCLS", nombre: "VIX", unidad: "puntos", observaciones: 40 },
  { id: "DCOILWTICO", nombre: "Petróleo WTI", unidad: "US$", observaciones: 40 },
] as const;

export type SerieMacroId = (typeof SERIES_MACRO)[number]["id"];
export type ObservacionMacro = { fecha: string; valor: number };

// FRED manda "." cuando no hay dato ese día.
export function parsearObservaciones(observaciones: Array<{ date?: string; value?: string }>): ObservacionMacro[] {
  return observaciones.flatMap((observacion) => {
    const valor = Number(observacion.value);
    if (!observacion.date || observacion.value === "." || !Number.isFinite(valor)) return [];
    return [{ fecha: observacion.date, valor }];
  });
}

export async function obtenerSerieFred(id: string, limite: number): Promise<ObservacionMacro[]> {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error("Falta FRED_API_KEY");
  const params = new URLSearchParams({ series_id: id, api_key: key, file_type: "json", sort_order: "desc", limit: String(limite) });
  const respuesta = await fetchConTimeout(`https://api.stlouisfed.org/fred/series/observations?${params}`);
  // No se imprime la URL en el error: lleva la api_key.
  if (!respuesta.ok) throw new Error(`FRED respondió HTTP ${respuesta.status} para ${id}`);
  const data = (await respuesta.json()) as { observations?: Array<{ date?: string; value?: string }> };
  return parsearObservaciones(data.observations ?? []);
}
