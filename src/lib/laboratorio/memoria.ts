// Memoria del laboratorio (SIMULADO): qué parte de lo aprendido se le muestra a un bot o a la pantalla.
// Funciones puras. Una estadística con pocos casos es ruido y no se muestra.
import { EVENTOS, MIN_CASOS } from "./eventos";

export type EstadisticaDB = {
  evento: string;
  ticker: string;
  horizonte: number;
  n: number;
  media: number | null;
  mediana: number | null;
  pct_positivo: number | null;
  media_base: number | null;
};

export type EstadisticaUsable = {
  origen: "ticker" | "universo";
  n: number;
  media: number;
  mediana: number;
  pctPositivo: number;
  mediaBase: number;
  // Cuánto mejor (o peor) que un día cualquiera, en puntos porcentuales.
  ventaja: number;
};

function usable(fila: EstadisticaDB | undefined, origen: "ticker" | "universo", minimo: number): EstadisticaUsable | null {
  if (!fila || fila.n < minimo || fila.media === null || fila.mediana === null || fila.pct_positivo === null || fila.media_base === null) return null;
  return {
    origen,
    n: fila.n,
    media: fila.media,
    mediana: fila.mediana,
    pctPositivo: fila.pct_positivo,
    mediaBase: fila.media_base,
    ventaja: Math.round((fila.media - fila.media_base) * 100) / 100,
  };
}

// Prefiere la estadística del propio ticker si tiene casos suficientes; si no, la de todo el universo.
export function estadisticaParaSenal(
  filas: EstadisticaDB[],
  evento: string,
  ticker: string,
  horizonte: number,
  minimo = MIN_CASOS
): EstadisticaUsable | null {
  const buscar = (t: string) => filas.find((fila) => fila.evento === evento && fila.ticker === t && fila.horizonte === horizonte);
  return usable(buscar(ticker), "ticker", minimo) ?? usable(buscar("*"), "universo", minimo);
}

export type SenalConMemoria = {
  ticker: string;
  evento: string;
  etiqueta: string;
  a5: EstadisticaUsable | null;
  a20: EstadisticaUsable | null;
};

export function armarSenales(senales: Array<{ ticker: string; evento: string }>, filas: EstadisticaDB[], minimo = MIN_CASOS): SenalConMemoria[] {
  return senales.map((senal) => ({
    ticker: senal.ticker,
    evento: senal.evento,
    etiqueta: EVENTOS[senal.evento] ?? senal.evento,
    a5: estadisticaParaSenal(filas, senal.evento, senal.ticker, 5, minimo),
    a20: estadisticaParaSenal(filas, senal.evento, senal.ticker, 20, minimo),
  }));
}

export type DiarioResumido = { fecha: string; resumen: string; puntos_clave: string[]; a_mirar: string[]; tono: string };

// `diarios` de la nota más nueva a la más vieja. Se queda con las últimas `maxDias` y, si se pasa del
// tope de caracteres, descarta primero las más viejas: la memoria no puede inflar el briefing.
export function recortarDiarios(diarios: DiarioResumido[], maxDias = 5, maxCaracteres = 3_500): DiarioResumido[] {
  const elegidos = diarios.slice(0, maxDias);
  const tamano = (diario: DiarioResumido) => diario.resumen.length + diario.puntos_clave.join(" ").length + diario.a_mirar.join(" ").length;
  while (elegidos.length > 1 && elegidos.reduce((total, diario) => total + tamano(diario), 0) > maxCaracteres) elegidos.pop();
  return elegidos;
}
