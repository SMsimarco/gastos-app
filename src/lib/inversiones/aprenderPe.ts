// Promedio de P/E de 5 años para el componente de valuación. El laboratorio guarda solo el P/E actual, así que este
// promedio se calcula con la serie trimestral de Finnhub (peTTM) y se guarda aparte (aprender_pe_promedio), solo para
// los tickers de la lista de aprender. Excepción acordada a "no duplicar recolección": no toca el laboratorio.
import { fetchConTimeout } from "../laboratorio/fuentes/http";

export type PuntoSerie = { period?: string; v?: number | null };

export const MIN_TRIMESTRES_PE = 12;

// Promedia los P/E positivos de los últimos 5 años. Devuelve null si hay menos de 12 trimestres con dato.
export function calcularPromedioPe5a(serie: PuntoSerie[], hoy: string): { promedio: number; muestras: number } | null {
  const limite = new Date(Date.parse(`${hoy}T00:00:00Z`));
  limite.setUTCFullYear(limite.getUTCFullYear() - 5);
  const desde = limite.toISOString().slice(0, 10);
  const valores = serie
    .filter((punto) => typeof punto.period === "string" && punto.period >= desde && punto.period <= hoy && typeof punto.v === "number" && Number.isFinite(punto.v) && punto.v > 0)
    .map((punto) => punto.v as number);
  if (valores.length < MIN_TRIMESTRES_PE) return null;
  const promedio = valores.reduce((total, valor) => total + valor, 0) / valores.length;
  return { promedio: Math.round(promedio * 100) / 100, muestras: valores.length };
}

// Llama a Finnhub (la key va en el header para que no aparezca en una URL de error). null si el ticker no tiene serie
// (por ejemplo los ETF).
export async function obtenerPromedioPe5a(ticker: string, hoy: string): Promise<{ promedio: number; muestras: number } | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("Falta FINNHUB_API_KEY");
  const respuesta = await fetchConTimeout(`https://finnhub.io/api/v1/stock/metric?${new URLSearchParams({ symbol: ticker, metric: "all" })}`, { headers: { "X-Finnhub-Token": key } });
  if (!respuesta.ok) throw new Error(`Finnhub respondió HTTP ${respuesta.status} para el P/E de ${ticker}`);
  const data = (await respuesta.json()) as { series?: { quarterly?: { peTTM?: PuntoSerie[] } } };
  return calcularPromedioPe5a(data.series?.quarterly?.peTTM ?? [], hoy);
}
