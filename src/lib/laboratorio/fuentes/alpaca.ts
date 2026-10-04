import type { Barra } from "../indicadores";
import { fetchConTimeout } from "./http";

// Alpaca, solo lectura. Datos de mercado (plan gratuito, feed IEX, 200 llamadas/min) y reloj del
// mercado. Las órdenes (parte B) usarán su propio cliente, que solo acepta la URL de paper.
const DATA_URL = "https://data.alpaca.markets";
const PAPER_URL = "https://paper-api.alpaca.markets";

function credenciales(): Record<string, string> {
  const id = process.env.ALPACA_API_KEY_ID;
  const secreto = process.env.ALPACA_API_SECRET_KEY;
  if (!id || !secreto) throw new Error("Faltan ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY");
  return { "APCA-API-KEY-ID": id, "APCA-API-SECRET-KEY": secreto, Accept: "application/json" };
}

async function pedir<T>(url: string): Promise<T> {
  const respuesta = await fetchConTimeout(url, { headers: credenciales() });
  if (!respuesta.ok) throw new Error(`Alpaca respondió HTTP ${respuesta.status} en ${new URL(url).pathname}`);
  return (await respuesta.json()) as T;
}

export type RelojMercado = { abierto: boolean; ahora: string; proximaApertura: string; proximoCierre: string };

export async function obtenerReloj(): Promise<RelojMercado> {
  const data = await pedir<{ timestamp: string; is_open: boolean; next_open: string; next_close: string }>(`${PAPER_URL}/v2/clock`);
  return { abierto: data.is_open, ahora: data.timestamp, proximaApertura: data.next_open, proximoCierre: data.next_close };
}

// --- Barras diarias ---

type BarraAlpaca = { t: string; c: number; v: number };

export function parsearBarras(mapa: Record<string, BarraAlpaca[] | undefined>): Record<string, Barra[]> {
  const resultado: Record<string, Barra[]> = {};
  for (const [ticker, barras] of Object.entries(mapa)) {
    resultado[ticker] = (barras ?? [])
      .filter((barra) => Number.isFinite(barra.c) && barra.c > 0)
      .map((barra) => ({ fecha: barra.t.slice(0, 10), cierre: barra.c, volumen: barra.v ?? 0 }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }
  return resultado;
}

export async function obtenerBarrasDiarias(tickers: string[], dias = 400): Promise<Record<string, Barra[]>> {
  const inicio = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
  const acumulado: Record<string, BarraAlpaca[]> = {};
  let pagina: string | null = null;
  for (let i = 0; i < 5; i++) {
    // Feed consolidado (SIP): el plan gratis lo permite para datos con más de 15 minutos y da cierres y
    // volúmenes del mercado completo (el feed IEX es una fracción: AAPL 0,8 M de acciones contra 33 M).
    const params = new URLSearchParams({
      symbols: tickers.join(","),
      timeframe: "1Day",
      start: inicio,
      end: new Date(Date.now() - 20 * 60_000).toISOString(),
      limit: "10000",
      adjustment: "split",
      feed: "sip",
    });
    if (pagina) params.set("page_token", pagina);
    const data = await pedir<{ bars?: Record<string, BarraAlpaca[]>; next_page_token?: string | null }>(
      `${DATA_URL}/v2/stocks/bars?${params}`
    );
    for (const [ticker, barras] of Object.entries(data.bars ?? {})) {
      acumulado[ticker] = [...(acumulado[ticker] ?? []), ...barras];
    }
    pagina = data.next_page_token ?? null;
    if (!pagina) break;
  }
  return parsearBarras(acumulado);
}

// --- Snapshots (último precio) ---

export type Snapshot = { ticker: string; precio: number; ts: string; volumenDia: number | null; cierreAnterior: number | null };

type SnapshotAlpaca = {
  latestTrade?: { p?: number; t?: string };
  dailyBar?: { c?: number; v?: number; t?: string };
  prevDailyBar?: { c?: number };
};

export function parsearSnapshots(data: Record<string, unknown>): Snapshot[] {
  const mapa = ((data as { snapshots?: Record<string, SnapshotAlpaca> }).snapshots ?? data) as Record<string, SnapshotAlpaca>;
  const resultado: Snapshot[] = [];
  for (const [ticker, snap] of Object.entries(mapa)) {
    const precio = snap?.latestTrade?.p ?? snap?.dailyBar?.c;
    const ts = snap?.latestTrade?.t ?? snap?.dailyBar?.t;
    if (!(typeof precio === "number" && precio > 0) || !ts) continue;
    resultado.push({
      ticker,
      precio,
      ts,
      volumenDia: snap.dailyBar?.v ?? null,
      cierreAnterior: snap.prevDailyBar?.c ?? null,
    });
  }
  return resultado;
}

export async function obtenerSnapshots(tickers: string[]): Promise<Snapshot[]> {
  const params = new URLSearchParams({ symbols: tickers.join(","), feed: "iex" });
  return parsearSnapshots(await pedir<Record<string, unknown>>(`${DATA_URL}/v2/stocks/snapshots?${params}`));
}

// --- Noticias ---

export type NoticiaCruda = {
  fuente: string;
  titular: string;
  url: string;
  publicadoAt: string;
  resumenFuente: string | null;
  tickers: string[];
};

type NoticiaAlpaca = {
  headline?: string;
  summary?: string;
  url?: string;
  created_at?: string;
  symbols?: string[];
  source?: string;
};

export function parsearNoticias(noticias: NoticiaAlpaca[]): NoticiaCruda[] {
  return noticias
    .filter((noticia) => noticia.headline && noticia.url && noticia.created_at)
    .map((noticia) => ({
      fuente: `alpaca:${noticia.source ?? "desconocida"}`,
      titular: noticia.headline!,
      url: noticia.url!,
      publicadoAt: noticia.created_at!,
      resumenFuente: noticia.summary || null,
      tickers: (noticia.symbols ?? []).map((simbolo) => simbolo.toUpperCase()),
    }));
}

export async function obtenerNoticias(tickers: string[], desde: Date, maxPaginas = 3): Promise<NoticiaCruda[]> {
  const resultado: NoticiaCruda[] = [];
  let pagina: string | null = null;
  for (let i = 0; i < maxPaginas; i++) {
    const params = new URLSearchParams({ start: desde.toISOString(), limit: "50", sort: "desc" });
    // Sin tickers trae el flujo general de noticias de mercado (macro, Fed, petróleo, etc.).
    if (tickers.length > 0) params.set("symbols", tickers.join(","));
    if (pagina) params.set("page_token", pagina);
    const data = await pedir<{ news?: NoticiaAlpaca[]; next_page_token?: string | null }>(`${DATA_URL}/v1beta1/news?${params}`);
    resultado.push(...parsearNoticias(data.news ?? []));
    pagina = data.next_page_token ?? null;
    if (!pagina) break;
  }
  return resultado;
}

// Noticias generales de mercado (sin filtrar por ticker): respaldo confiable para las noticias globales.
export async function obtenerNoticiasGenerales(desde: Date, maxPaginas = 3): Promise<NoticiaCruda[]> {
  return obtenerNoticias([], desde, maxPaginas);
}

// --- Dividendos ---

export type Dividendo = { ticker: string; fechaEx: string; fechaPago: string | null; monto: number; especial: boolean };

type DividendoAlpaca = { symbol?: string; ex_date?: string; payable_date?: string; rate?: number; special?: boolean };

export function parsearDividendos(filas: DividendoAlpaca[]): Dividendo[] {
  return filas.flatMap((fila) => {
    if (!fila.symbol || !fila.ex_date || typeof fila.rate !== "number" || !(fila.rate > 0)) return [];
    return [{ ticker: fila.symbol.toUpperCase(), fechaEx: fila.ex_date, fechaPago: fila.payable_date ?? null, monto: fila.rate, especial: Boolean(fila.special) }];
  });
}

// Próximos dividendos en efectivo del universo (fecha ex entre `desde` y `hasta`, YYYY-MM-DD).
export async function obtenerDividendos(tickers: string[], desde: string, hasta: string): Promise<Dividendo[]> {
  const params = new URLSearchParams({ symbols: tickers.join(","), types: "cash_dividend", start: desde, end: hasta, limit: "100" });
  const data = await pedir<{ corporate_actions?: { cash_dividends?: DividendoAlpaca[] } }>(`${DATA_URL}/v1/corporate-actions?${params}`);
  return parsearDividendos(data.corporate_actions?.cash_dividends ?? []);
}
