export type PrecioDiario = { ticker: string; fecha: string; cierre_usd: number; max_52s: number };

type RespuestaTwelveData = {
  status?: string;
  code?: number;
  message?: string;
  values?: Array<{ datetime: string; close: string }>;
};

export async function obtenerPreciosTwelveData(ticker: string, apiKey: string): Promise<PrecioDiario[]> {
  const params = new URLSearchParams({
    symbol: ticker,
    interval: "1day",
    outputsize: "370",
    order: "ASC",
    apikey: apiKey,
  });
  const respuesta = await fetch(`https://api.twelvedata.com/time_series?${params}`, { cache: "no-store" });
  if (!respuesta.ok) throw new Error(`Twelve Data respondió HTTP ${respuesta.status}`);
  const data = await respuesta.json() as RespuestaTwelveData;
  if (data.status === "error" || !data.values?.length) {
    throw new Error(data.message ?? `Twelve Data no devolvió precios para ${ticker}`);
  }

  const serie = data.values
    .map((valor) => ({ fecha: valor.datetime.slice(0, 10), cierre: Number(valor.close) }))
    .filter((valor) => Number.isFinite(valor.cierre) && valor.cierre > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  return serie.map((valor, indice) => {
    const limite = new Date(`${valor.fecha}T00:00:00Z`);
    limite.setUTCDate(limite.getUTCDate() - 365);
    const desde = limite.toISOString().slice(0, 10);
    const max52 = Math.max(...serie.slice(0, indice + 1).filter((item) => item.fecha >= desde).map((item) => item.cierre));
    return { ticker, fecha: valor.fecha, cierre_usd: valor.cierre, max_52s: max52 };
  });
}
