// Avisos de empresas grandes (Opción A): un resumen diario con las 3 que más se movieron (para arriba o para abajo) y
// VOO, "día tranquilo" en una línea si ninguna se movió más de 2%, y una alerta aparte si alguna se mueve fuerte
// (5% en el día; 8% para YPF y VIST). Funciones PURAS con tests; los datos salen de lab_* (ver empresasFuertesAvisos.ts).
// Nada de esto dice "vendé" ni "comprá": es información, y la decisión es del usuario.
import { DISCLAIMER_FINANCIERO } from "./avisos";

export const UMBRAL_DIA_TRANQUILO_PCT = 2;
export const UMBRAL_FUERTE_PCT = 5;
export const UMBRAL_FUERTE_VOLATILES_PCT = 8;
export const MAX_DESTACADAS = 3;
export const DIAS_BALANCE_AVISO = 7;
const VOLATILES = new Set(["YPF", "VIST"]);
const URL_APP = "https://gastosvoz.vercel.app/plan";

export const NOMBRES_EMPRESAS: Record<string, string> = {
  MSFT: "Microsoft", GOOGL: "Google", AMZN: "Amazon", AAPL: "Apple", NVDA: "Nvidia", META: "Meta", JPM: "JPMorgan",
  XOM: "Exxon", KO: "Coca-Cola", YPF: "YPF", VIST: "Vista", VOO: "VOO", QQQ: "QQQ", VTI: "VTI", SCHD: "SCHD",
};

export type Observacion = {
  ticker: string;
  fecha: string; // fecha de los datos (YYYY-MM-DD)
  variacionDia: number | null; // %
  variacionMes: number | null; // %
  distanciaMax52s: number | null; // % (<= 0)
  balanceEnDias: number | null;
  titular: { texto: string; fuente: string } | null;
};

export type EvaluacionFuertes = {
  fecha: string | null;
  destacadas: Observacion[];
  voo: Observacion | null;
  tranquilo: boolean;
  alertasFuertes: Observacion[];
};

export const umbralFuerte = (ticker: string) => (VOLATILES.has(ticker) ? UMBRAL_FUERTE_VOLATILES_PCT : UMBRAL_FUERTE_PCT);

export function evaluarEmpresasFuertes(observaciones: Observacion[]): EvaluacionFuertes {
  const voo = observaciones.find((item) => item.ticker === "VOO") ?? null;
  const empresas = observaciones.filter((item) => item.ticker !== "VOO" && item.variacionDia !== null);
  const porMovimiento = [...empresas].sort((a, b) => Math.abs(b.variacionDia!) - Math.abs(a.variacionDia!) || a.ticker.localeCompare(b.ticker));
  const destacadas = porMovimiento.filter((item) => Math.abs(item.variacionDia!) >= UMBRAL_DIA_TRANQUILO_PCT).slice(0, MAX_DESTACADAS);
  const fechas = observaciones.map((item) => item.fecha).sort();
  return {
    fecha: fechas.at(-1) ?? null,
    destacadas,
    voo,
    tranquilo: destacadas.length === 0,
    alertasFuertes: porMovimiento.filter((item) => Math.abs(item.variacionDia!) >= umbralFuerte(item.ticker)),
  };
}

// 2,4 con un decimal debajo de 10; entero desde 10 (como en el resto de los textos).
const numeroCorto = (valor: number) => {
  const absoluto = Math.abs(valor);
  return (absoluto < 10 ? String(Math.round(absoluto * 10) / 10) : String(Math.round(absoluto))).replace(".", ",");
};
const movimiento = (valor: number) => `${valor >= 0 ? "subió" : "bajó"} ${numeroCorto(valor)}%`;
const fechaCorta = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
const nombre = (ticker: string) => (NOMBRES_EMPRESAS[ticker] && NOMBRES_EMPRESAS[ticker] !== ticker ? `${ticker} (${NOMBRES_EMPRESAS[ticker]})` : ticker);

function detalle(item: Observacion): string {
  const partes: string[] = [];
  if (item.variacionMes !== null) partes.push(`${item.variacionMes >= 0 ? "subió" : "bajó"} ${numeroCorto(item.variacionMes)}% en el mes`);
  if (item.distanciaMax52s !== null) partes.push(item.distanciaMax52s > -1 ? "está en su máximo del año" : `está ${numeroCorto(item.distanciaMax52s)}% abajo de su máximo del año`);
  if (item.balanceEnDias !== null && item.balanceEnDias >= 0 && item.balanceEnDias <= DIAS_BALANCE_AVISO) partes.push(`presenta balance en ${item.balanceEnDias} ${item.balanceEnDias === 1 ? "día" : "días"} (puede moverse fuerte ese día)`);
  return partes.join("; ");
}

export function textoResumenFuertes(evaluacion: EvaluacionFuertes): string {
  const vooLinea = evaluacion.voo?.variacionDia != null ? `VOO ${movimiento(evaluacion.voo.variacionDia)} en el día.` : null;
  if (evaluacion.tranquilo) {
    const voo = evaluacion.voo?.variacionDia != null ? ` (VOO ${evaluacion.voo.variacionDia >= 0 ? "+" : "−"}${numeroCorto(evaluacion.voo.variacionDia)}%)` : "";
    return `Día tranquilo: ninguna de tus empresas se movió más de ${UMBRAL_DIA_TRANQUILO_PCT}%${voo}.\n${DISCLAIMER_FINANCIERO}`;
  }
  const lineas = [`Empresas que más se movieron${evaluacion.fecha ? ` (${fechaCorta(evaluacion.fecha)})` : ""}:`];
  for (const item of evaluacion.destacadas) {
    const extra = detalle(item);
    lineas.push(`${nombre(item.ticker)} ${movimiento(item.variacionDia!)} en el día${extra ? `; ${extra}` : ""}.${item.titular ? ` Noticia: ${item.titular.texto} (${item.titular.fuente}).` : ""}`);
  }
  if (vooLinea) lineas.push(vooLinea);
  lineas.push(`Mirá el detalle en la app: ${URL_APP}`);
  lineas.push(DISCLAIMER_FINANCIERO);
  return lineas.join("\n");
}

export function textoAlertaFuerte(item: Observacion): string {
  const extra = detalle(item);
  return [
    `${nombre(item.ticker)} se movió fuerte: ${movimiento(item.variacionDia!)} en el día${extra ? `; ${extra}` : ""}.`,
    item.titular ? `Noticia: ${item.titular.texto} (${item.titular.fuente}).` : "Mirá si hay una noticia que lo explique antes de decidir algo.",
    "Es solo información: la decisión es tuya y esperar también es una opción.",
    `Mirá el detalle en la app: ${URL_APP}`,
    DISCLAIMER_FINANCIERO,
  ].join("\n");
}

export function textoAlertaVoo(caidaPct: number): string {
  return [
    `VOO está ${numeroCorto(caidaPct)}% abajo de su máximo de 52 semanas.`,
    "Para tu largo plazo, comprar más barato puede ser una oportunidad; que baje nunca es una señal para vender.",
    `Mirá el detalle en la app: ${URL_APP}`,
    DISCLAIMER_FINANCIERO,
  ].join("\n");
}
