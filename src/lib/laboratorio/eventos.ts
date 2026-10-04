// Estudio de eventos del laboratorio (SIMULADO). Funciones puras, sin IA: para cada tipo de evento
// técnico mide qué hizo el precio 1, 5 y 20 ruedas después, con años de historia.
//
// Regla de oro: un evento en la rueda `i` se decide SOLO con datos hasta `i` (nada del futuro). Los
// retornos posteriores se miden desde el cierre de `i`. Cada serie se calcula una vez, de forma
// incremental, así que el valor en `i` nunca depende de lo que pasó después.
import type { Barra } from "./indicadores";

export const HORIZONTES = [1, 5, 20] as const;
// Con menos casos que esto una estadística no se le pasa a un bot: es ruido.
export const MIN_CASOS = 20;

export const EVENTOS: Record<string, string> = {
  rsi_bajo: "RSI baja de 30 (sobrevendida)",
  rsi_alto: "RSI sube de 70 (sobrecomprada)",
  caida_fuerte: "Caída de 3% o más en un día",
  suba_fuerte: "Suba de 3% o más en un día",
  maximo_52s: "Nuevo máximo de 52 semanas",
  minimo_52s: "Nuevo mínimo de 52 semanas",
  cruce_sma200_arriba: "Cruza por encima de su media de 200 días",
  cruce_sma200_abajo: "Cruza por debajo de su media de 200 días",
};

const RUEDAS_ANIO = 252;

export type Serie = {
  cierres: number[];
  fechas: string[];
  rsi: Array<number | null>;
  sma200: Array<number | null>;
};

// RSI de Wilder incremental: rsiSerie(c)[i] == rsi(c.slice(0, i + 1)) (ver tests).
export function rsiSerie(cierres: number[], n = 14): Array<number | null> {
  const resultado: Array<number | null> = cierres.map(() => null);
  if (cierres.length < n + 1) return resultado;
  let ganancia = 0;
  let perdida = 0;
  for (let i = 1; i <= n; i++) {
    const cambio = cierres[i] - cierres[i - 1];
    if (cambio >= 0) ganancia += cambio;
    else perdida += -cambio;
  }
  ganancia /= n;
  perdida /= n;
  const valor = (g: number, p: number) => (p === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / p));
  resultado[n] = valor(ganancia, perdida);
  for (let i = n + 1; i < cierres.length; i++) {
    const cambio = cierres[i] - cierres[i - 1];
    ganancia = (ganancia * (n - 1) + (cambio > 0 ? cambio : 0)) / n;
    perdida = (perdida * (n - 1) + (cambio < 0 ? -cambio : 0)) / n;
    resultado[i] = valor(ganancia, perdida);
  }
  return resultado;
}

export function smaSerie(valores: number[], n: number): Array<number | null> {
  const resultado: Array<number | null> = valores.map(() => null);
  let suma = 0;
  for (let i = 0; i < valores.length; i++) {
    suma += valores[i];
    if (i >= n) suma -= valores[i - n];
    if (i >= n - 1) resultado[i] = suma / n;
  }
  return resultado;
}

export function calcularSerie(barras: Barra[]): Serie {
  const validas = barras.filter((barra) => barra.cierre > 0);
  const cierres = validas.map((barra) => barra.cierre);
  return { cierres, fechas: validas.map((barra) => barra.fecha), rsi: rsiSerie(cierres), sma200: smaSerie(cierres, 200) };
}

// Eventos que se activan en la rueda `i`, mirando solo hasta `i`.
export function eventosEnIndice(serie: Serie, i: number): string[] {
  if (i < 1 || i >= serie.cierres.length) return [];
  const { cierres, rsi, sma200 } = serie;
  const eventos: string[] = [];

  const rsiHoy = rsi[i];
  const rsiAyer = rsi[i - 1];
  if (rsiHoy !== null && rsiAyer !== null) {
    if (rsiHoy < 30 && rsiAyer >= 30) eventos.push("rsi_bajo");
    if (rsiHoy > 70 && rsiAyer <= 70) eventos.push("rsi_alto");
  }

  const retornoDia = (cierres[i] / cierres[i - 1] - 1) * 100;
  if (retornoDia <= -3) eventos.push("caida_fuerte");
  if (retornoDia >= 3) eventos.push("suba_fuerte");

  if (i >= RUEDAS_ANIO) {
    let maximo = -Infinity;
    let minimo = Infinity;
    for (let j = i - RUEDAS_ANIO; j < i; j++) {
      if (cierres[j] > maximo) maximo = cierres[j];
      if (cierres[j] < minimo) minimo = cierres[j];
    }
    if (cierres[i] > maximo) eventos.push("maximo_52s");
    if (cierres[i] < minimo) eventos.push("minimo_52s");
  }

  const mediaHoy = sma200[i];
  const mediaAyer = sma200[i - 1];
  if (mediaHoy !== null && mediaAyer !== null) {
    if (cierres[i] > mediaHoy && cierres[i - 1] <= mediaAyer) eventos.push("cruce_sma200_arriba");
    if (cierres[i] < mediaHoy && cierres[i - 1] >= mediaAyer) eventos.push("cruce_sma200_abajo");
  }
  return eventos;
}

// Eventos de la última rueda disponible de una serie de barras.
export function eventosDeHoy(barras: Barra[]): { fecha: string; eventos: string[] } | null {
  const serie = calcularSerie(barras);
  if (serie.cierres.length < 2) return null;
  const ultimo = serie.cierres.length - 1;
  return { fecha: serie.fechas[ultimo], eventos: eventosEnIndice(serie, ultimo) };
}

// --- Estadísticas ---

export type FilaEstadistica = {
  evento: string;
  ticker: string; // '*' = todo el universo junto
  horizonte: number;
  n: number;
  media: number;
  mediana: number;
  pctPositivo: number;
  mediaBase: number;
  desde: string;
  hasta: string;
};

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function mediaDe(valores: number[]): number {
  return valores.reduce((total, valor) => total + valor, 0) / valores.length;
}

function medianaDe(valores: number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1 ? ordenados[medio] : (ordenados[medio - 1] + ordenados[medio]) / 2;
}

export function estudiarEventos(seriesPorTicker: Record<string, Barra[]>): { filas: FilaEstadistica[]; desde: string | null; hasta: string | null } {
  // retornos[evento|ticker][horizonte] y base[ticker][horizonte]
  const porEvento = new Map<string, number[][]>();
  const base = new Map<string, number[][]>();
  const agregar = (mapa: Map<string, number[][]>, clave: string, indiceHorizonte: number, retorno: number) => {
    if (!mapa.has(clave)) mapa.set(clave, HORIZONTES.map(() => []));
    mapa.get(clave)![indiceHorizonte].push(retorno);
  };
  let desde: string | null = null;
  let hasta: string | null = null;

  for (const [ticker, barras] of Object.entries(seriesPorTicker)) {
    const serie = calcularSerie(barras);
    const n = serie.cierres.length;
    if (n < 2) continue;
    if (desde === null || serie.fechas[0] < desde) desde = serie.fechas[0];
    if (hasta === null || serie.fechas[n - 1] > hasta) hasta = serie.fechas[n - 1];

    for (let i = 1; i < n; i++) {
      const eventos = eventosEnIndice(serie, i);
      for (const [indiceHorizonte, horizonte] of HORIZONTES.entries()) {
        if (i + horizonte >= n) continue; // todavía no pasó ese horizonte
        const retorno = (serie.cierres[i + horizonte] / serie.cierres[i] - 1) * 100;
        agregar(base, ticker, indiceHorizonte, retorno);
        agregar(base, "*", indiceHorizonte, retorno);
        for (const evento of eventos) {
          agregar(porEvento, `${evento}|${ticker}`, indiceHorizonte, retorno);
          agregar(porEvento, `${evento}|*`, indiceHorizonte, retorno);
        }
      }
    }
  }

  const filas: FilaEstadistica[] = [];
  if (desde === null || hasta === null) return { filas, desde, hasta };
  for (const [clave, porHorizonte] of porEvento) {
    const [evento, ticker] = clave.split("|");
    for (const [indiceHorizonte, horizonte] of HORIZONTES.entries()) {
      const retornos = porHorizonte[indiceHorizonte];
      const referencia = base.get(ticker)?.[indiceHorizonte];
      if (retornos.length === 0 || !referencia || referencia.length === 0) continue;
      filas.push({
        evento,
        ticker,
        horizonte,
        n: retornos.length,
        media: redondear(mediaDe(retornos)),
        mediana: redondear(medianaDe(retornos)),
        pctPositivo: redondear((retornos.filter((retorno) => retorno > 0).length / retornos.length) * 100),
        mediaBase: redondear(mediaDe(referencia)),
        desde,
        hasta,
      });
    }
  }
  return { filas, desde, hasta };
}
