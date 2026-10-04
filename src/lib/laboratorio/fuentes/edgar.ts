import { fetchConTimeout } from "./http";

// SEC EDGAR: gratis y sin key, pero exige un User-Agent que identifique a quien consulta (variable
// SEC_USER_AGENT) y pide no pasar de 10 pedidos por segundo. Solo se guardan los formularios que
// cuentan hechos de la empresa; los Form 4 y 144 (movimientos de directivos) ya se cubren con Finnhub.
const FORMULARIOS = new Set(["8-K", "6-K", "10-Q", "10-K", "20-F", "40-F"]);

export type FilingCrudo = {
  ticker: string;
  accesion: string;
  fecha: string;
  formulario: string;
  items: string[];
  url: string;
};

type Presentaciones = {
  accessionNumber?: string[];
  filingDate?: string[];
  form?: string[];
  items?: string[];
  primaryDocument?: string[];
};

export function mapearCik(data: Record<string, { cik_str?: number; ticker?: string }>): Record<string, number> {
  const mapa: Record<string, number> = {};
  for (const fila of Object.values(data)) {
    if (fila.ticker && typeof fila.cik_str === "number") mapa[fila.ticker.toUpperCase()] = fila.cik_str;
  }
  return mapa;
}

// `recent` de la respuesta de /submissions: arrays paralelos, del más nuevo al más viejo.
export function parsearFilings(ticker: string, cik: number, recent: Presentaciones, desdeFecha: string): FilingCrudo[] {
  const formularios = recent.form ?? [];
  const resultado: FilingCrudo[] = [];
  for (let i = 0; i < formularios.length; i++) {
    const fecha = recent.filingDate?.[i];
    const accesion = recent.accessionNumber?.[i];
    const documento = recent.primaryDocument?.[i];
    if (!fecha || !accesion || !documento || fecha < desdeFecha || !FORMULARIOS.has(formularios[i])) continue;
    resultado.push({
      ticker,
      accesion,
      fecha,
      formulario: formularios[i],
      items: (recent.items?.[i] ?? "").split(",").map((item) => item.trim()).filter(Boolean),
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accesion.replaceAll("-", "")}/${documento}`,
    });
  }
  return resultado;
}

function cabeceras(): Record<string, string> {
  const agente = process.env.SEC_USER_AGENT;
  if (!agente) throw new Error("Falta SEC_USER_AGENT (nombre de la app y un mail de contacto, lo exige la SEC)");
  return { "User-Agent": agente, Accept: "application/json" };
}

export async function obtenerMapaCik(): Promise<Record<string, number>> {
  const respuesta = await fetchConTimeout("https://www.sec.gov/files/company_tickers.json", { headers: cabeceras() });
  if (!respuesta.ok) throw new Error(`SEC respondió HTTP ${respuesta.status} en company_tickers`);
  return mapearCik((await respuesta.json()) as Record<string, { cik_str?: number; ticker?: string }>);
}

export async function obtenerFilings(ticker: string, cik: number, desdeFecha: string): Promise<FilingCrudo[]> {
  const respuesta = await fetchConTimeout(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, { headers: cabeceras() });
  if (!respuesta.ok) throw new Error(`SEC respondió HTTP ${respuesta.status} para ${ticker}`);
  const data = (await respuesta.json()) as { filings?: { recent?: Presentaciones } };
  return parsearFilings(ticker, cik, data.filings?.recent ?? {}, desdeFecha);
}
