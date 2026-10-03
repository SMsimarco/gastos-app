// Indicadores técnicos del laboratorio (SIMULADO). Funciones puras: la IA nunca calcula,
// solo recibe estos números ya hechos.

export type Barra = { fecha: string; cierre: number; volumen: number };

export type Indicadores = {
  fecha: string;
  cierre: number;
  cierre_anterior: number | null;
  volumen: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  volatilidad20: number | null; // % anualizado (desvío de retornos logarítmicos x raíz de 252)
  distancia_max52s: number | null; // % respecto del máximo de cierres de 52 semanas (<= 0)
  variacion_dia: number | null; // %
  variacion_semana: number | null; // % (5 ruedas)
  variacion_mes: number | null; // % (21 ruedas)
  volumen_relativo: number | null; // volumen de la última rueda / promedio de las 20 anteriores
};

const RUEDAS_ANIO = 252;

function redondear(valor: number, decimales = 4): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

export function media(valores: number[], n: number): number | null {
  if (n <= 0 || valores.length < n) return null;
  const ventana = valores.slice(-n);
  return ventana.reduce((acumulado, valor) => acumulado + valor, 0) / n;
}

// RSI de Wilder: primer promedio simple de n variaciones y después suavizado exponencial.
export function rsi(cierres: number[], n = 14): number | null {
  if (cierres.length < n + 1) return null;
  const cambios = cierres.slice(1).map((cierre, i) => cierre - cierres[i]);
  let gananciaProm = 0;
  let perdidaProm = 0;
  for (let i = 0; i < n; i++) {
    if (cambios[i] >= 0) gananciaProm += cambios[i];
    else perdidaProm += -cambios[i];
  }
  gananciaProm /= n;
  perdidaProm /= n;
  for (let i = n; i < cambios.length; i++) {
    const ganancia = cambios[i] > 0 ? cambios[i] : 0;
    const perdida = cambios[i] < 0 ? -cambios[i] : 0;
    gananciaProm = (gananciaProm * (n - 1) + ganancia) / n;
    perdidaProm = (perdidaProm * (n - 1) + perdida) / n;
  }
  if (perdidaProm === 0) return gananciaProm === 0 ? 50 : 100;
  return 100 - 100 / (1 + gananciaProm / perdidaProm);
}

export function volatilidadAnualizada(cierres: number[], n = 20): number | null {
  if (cierres.length < n + 1) return null;
  const ventana = cierres.slice(-(n + 1));
  const retornos = ventana.slice(1).map((cierre, i) => Math.log(cierre / ventana[i]));
  const promedio = retornos.reduce((acumulado, valor) => acumulado + valor, 0) / n;
  const varianza = retornos.reduce((acumulado, valor) => acumulado + (valor - promedio) ** 2, 0) / (n - 1);
  return Math.sqrt(varianza) * Math.sqrt(RUEDAS_ANIO) * 100;
}

function variacionPct(cierres: number[], ruedasAtras: number): number | null {
  if (cierres.length <= ruedasAtras) return null;
  const base = cierres[cierres.length - 1 - ruedasAtras];
  if (!(base > 0)) return null;
  return (cierres[cierres.length - 1] / base - 1) * 100;
}

function opcional(valor: number | null, decimales = 4): number | null {
  return valor === null ? null : redondear(valor, decimales);
}

// `barras` ordenadas de la más vieja a la más nueva.
export function calcularIndicadores(barras: Barra[]): Indicadores | null {
  const validas = barras.filter((barra) => barra.cierre > 0);
  if (validas.length === 0) return null;
  const cierres = validas.map((barra) => barra.cierre);
  const ultima = validas[validas.length - 1];

  const maximo52s = Math.max(...cierres.slice(-RUEDAS_ANIO));
  const volumenesPrevios = validas.slice(0, -1).map((barra) => barra.volumen);
  const volumenPromedio = media(volumenesPrevios, 20);

  return {
    fecha: ultima.fecha,
    cierre: ultima.cierre,
    cierre_anterior: validas.length > 1 ? validas[validas.length - 2].cierre : null,
    volumen: ultima.volumen,
    sma20: opcional(media(cierres, 20)),
    sma50: opcional(media(cierres, 50)),
    sma200: opcional(media(cierres, 200)),
    rsi14: opcional(rsi(cierres, 14), 2),
    volatilidad20: opcional(volatilidadAnualizada(cierres, 20), 2),
    distancia_max52s: opcional((ultima.cierre / maximo52s - 1) * 100, 2),
    variacion_dia: opcional(variacionPct(cierres, 1), 2),
    variacion_semana: opcional(variacionPct(cierres, 5), 2),
    variacion_mes: opcional(variacionPct(cierres, 21), 2),
    volumen_relativo: volumenPromedio && volumenPromedio > 0 ? redondear(ultima.volumen / volumenPromedio, 2) : null,
  };
}
