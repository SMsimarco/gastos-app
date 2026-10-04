import { fetchConTimeout } from "./http";

// Finnhub, plan gratuito: ~60 llamadas por minuto (y máx. 30 por segundo), solo uso no comercial.
// Gratis: calendario de balances, métricas, recomendaciones de analistas, sorpresas de balances e
// insiders. Premium (403): calendario económico, precio objetivo y sentimiento social.

function pedirFinnhub<T>(ruta: string, params: Record<string, string>): Promise<T> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("Falta FINNHUB_API_KEY");
  // La key va en el header para que no aparezca en una URL de error.
  return fetchConTimeout(`https://finnhub.io/api/v1/${ruta}?${new URLSearchParams(params)}`, {
    headers: { "X-Finnhub-Token": key },
  }).then(async (respuesta) => {
    if (!respuesta.ok) throw new Error(`Finnhub respondió HTTP ${respuesta.status} en ${ruta}`);
    return (await respuesta.json()) as T;
  });
}

// --- Calendario de balances ---

export type BalanceProgramado = { ticker: string; fecha: string; detalle: Record<string, unknown> };

type BalanceFinnhub = {
  date?: string;
  symbol?: string;
  hour?: string;
  quarter?: number;
  year?: number;
  epsEstimate?: number | null;
  revenueEstimate?: number | null;
};

export function parsearBalances(balances: BalanceFinnhub[]): BalanceProgramado[] {
  return balances.flatMap((balance) => {
    if (!balance.date || !balance.symbol) return [];
    return [
      {
        ticker: balance.symbol.toUpperCase(),
        fecha: balance.date,
        detalle: {
          momento: balance.hour || null, // bmo (antes de la apertura) / amc (después del cierre) / dmh
          trimestre: balance.quarter ?? null,
          anio: balance.year ?? null,
          eps_estimado: balance.epsEstimate ?? null,
          ingresos_estimados: balance.revenueEstimate ?? null,
        },
      },
    ];
  });
}

export async function obtenerBalancesProgramados(ticker: string, desde: string, hasta: string): Promise<BalanceProgramado[]> {
  const data = await pedirFinnhub<{ earningsCalendar?: BalanceFinnhub[] }>("calendar/earnings", { from: desde, to: hasta, symbol: ticker });
  return parsearBalances(data.earningsCalendar ?? []);
}

// --- Fundamentales (métricas) ---

// Nombre en la base -> nombre en Finnhub. Los porcentajes ya vienen en %.
const METRICAS: Record<string, string> = {
  pe: "peTTM",
  ps: "psTTM",
  margen_neto: "netProfitMarginTTM",
  margen_operativo: "operatingMarginTTM",
  crecimiento_ingresos: "revenueGrowthTTMYoy",
  crecimiento_eps: "epsGrowthTTMYoy",
  roe: "roeTTM",
  deuda_capital: "totalDebt/totalEquityQuarterly",
  beta: "beta",
  dividendo_pct: "dividendYieldIndicatedAnnual",
  max_52s: "52WeekHigh",
  min_52s: "52WeekLow",
  rendimiento_13s: "13WeekPriceReturnDaily",
  rendimiento_26s: "26WeekPriceReturnDaily",
  rendimiento_52s: "52WeekPriceReturnDaily",
  cap_mercado_musd: "marketCapitalization",
};

export type MetricasEmpresa = Partial<Record<keyof typeof METRICAS, number | null>>;

// Devuelve null si Finnhub no tiene métricas del ticker (por ejemplo los ETF).
export function parsearMetricas(data: { metric?: Record<string, number | null | undefined> }): MetricasEmpresa | null {
  const metricas = data.metric ?? {};
  const resultado: MetricasEmpresa = {};
  let alguna = false;
  for (const [nombre, claveFinnhub] of Object.entries(METRICAS)) {
    const valor = metricas[claveFinnhub];
    resultado[nombre] = typeof valor === "number" && Number.isFinite(valor) ? valor : null;
    if (resultado[nombre] !== null) alguna = true;
  }
  return alguna ? resultado : null;
}

export async function obtenerMetricas(ticker: string): Promise<MetricasEmpresa | null> {
  return parsearMetricas(await pedirFinnhub("stock/metric", { symbol: ticker, metric: "all" }));
}

// --- Recomendaciones de analistas ---

export type Recomendacion = { periodo: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number };

// Finnhub a veces repite un período (pasó con XOM): se queda con la primera fila de cada uno,
// porque un upsert con dos filas de la misma clave falla.
export function parsearRecomendaciones(
  filas: Array<{ period?: string; strongBuy?: number; buy?: number; hold?: number; sell?: number; strongSell?: number }>
): Recomendacion[] {
  const porPeriodo = new Map<string, Recomendacion>();
  for (const fila of filas) {
    if (!fila.period || porPeriodo.has(fila.period)) continue;
    porPeriodo.set(fila.period, { periodo: fila.period, strongBuy: fila.strongBuy ?? 0, buy: fila.buy ?? 0, hold: fila.hold ?? 0, sell: fila.sell ?? 0, strongSell: fila.strongSell ?? 0 });
  }
  return [...porPeriodo.values()];
}

export async function obtenerRecomendaciones(ticker: string): Promise<Recomendacion[]> {
  return parsearRecomendaciones(await pedirFinnhub("stock/recommendation", { symbol: ticker }));
}

// --- Sorpresas de balances ---

export type Sorpresa = { periodo: string; estimado: number | null; real: number | null; sorpresaPct: number | null; anio: number | null; trimestre: number | null };

export function parsearSorpresas(
  filas: Array<{ period?: string; estimate?: number | null; actual?: number | null; surprisePercent?: number | null; year?: number; quarter?: number }>
): Sorpresa[] {
  const porPeriodo = new Map<string, Sorpresa>();
  for (const fila of filas) {
    if (!fila.period || porPeriodo.has(fila.period)) continue;
    porPeriodo.set(fila.period, {
      periodo: fila.period,
      estimado: fila.estimate ?? null,
      real: fila.actual ?? null,
      sorpresaPct: fila.surprisePercent ?? null,
      anio: fila.year ?? null,
      trimestre: fila.quarter ?? null,
    });
  }
  return [...porPeriodo.values()];
}

export async function obtenerSorpresas(ticker: string): Promise<Sorpresa[]> {
  return parsearSorpresas(await pedirFinnhub("stock/earnings", { symbol: ticker, limit: "4" }));
}

// --- Insiders ---

export type MovimientoInsider = {
  nombre: string;
  fechaTransaccion: string;
  fechaPresentacion: string | null;
  codigo: "P" | "S";
  cambioAcciones: number;
  accionesTotal: number | null;
  precio: number | null;
};

type InsiderFinnhub = {
  name?: string;
  share?: number;
  change?: number;
  filingDate?: string;
  transactionDate?: string;
  transactionCode?: string;
  transactionPrice?: number;
};

// Solo compras (P) y ventas (S) en mercado abierto desde `desdeFecha`; premios, impuestos y regalos no cuentan.
export function parsearInsiders(filas: InsiderFinnhub[], desdeFecha: string): MovimientoInsider[] {
  return filas.flatMap((fila) => {
    if (!fila.name || !fila.transactionDate || fila.transactionDate < desdeFecha) return [];
    if (fila.transactionCode !== "P" && fila.transactionCode !== "S") return [];
    if (typeof fila.change !== "number" || fila.change === 0) return [];
    return [{
      nombre: fila.name,
      fechaTransaccion: fila.transactionDate,
      fechaPresentacion: fila.filingDate ?? null,
      codigo: fila.transactionCode,
      cambioAcciones: fila.change,
      accionesTotal: typeof fila.share === "number" ? fila.share : null,
      precio: typeof fila.transactionPrice === "number" && fila.transactionPrice > 0 ? fila.transactionPrice : null,
    }];
  });
}

export async function obtenerInsiders(ticker: string, desdeFecha: string): Promise<MovimientoInsider[]> {
  const data = await pedirFinnhub<{ data?: InsiderFinnhub[] }>("stock/insider-transactions", { symbol: ticker });
  return parsearInsiders(data.data ?? [], desdeFecha);
}
