import { fetchConTimeout } from "./http";

// Finnhub, plan gratuito: ~60 llamadas por minuto (y máx. 30 por segundo), solo uso no comercial.
// Acá se usa solo el calendario de balances (earnings calendar).
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
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("Falta FINNHUB_API_KEY");
  const params = new URLSearchParams({ from: desde, to: hasta, symbol: ticker });
  const respuesta = await fetchConTimeout(`https://finnhub.io/api/v1/calendar/earnings?${params}`, {
    headers: { "X-Finnhub-Token": key },
  });
  if (!respuesta.ok) throw new Error(`Finnhub respondió HTTP ${respuesta.status} para ${ticker}`);
  const data = (await respuesta.json()) as { earningsCalendar?: BalanceFinnhub[] };
  return parsearBalances(data.earningsCalendar ?? []);
}
