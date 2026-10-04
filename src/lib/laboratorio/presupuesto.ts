// Presupuesto de IA del laboratorio (SIMULADO). Funciones puras: el tope es duro, si se alcanza
// no se llama más a la IA hasta el mes siguiente.

type PrecioModelo = { entrada: number; salida: number }; // USD por millón de tokens

// Precios del plan pago estándar (https://ai.google.dev/gemini-api/docs/pricing, verificado 2026-10-03).
export const PRECIOS_MODELO: Record<string, PrecioModelo> = {
  "gemini-3.5-flash-lite": { entrada: 0.3, salida: 2.5 },
  "gemini-3.6-flash": { entrada: 0.75, salida: 3.75 },
  "gemini-3.5-flash": { entrada: 1.5, salida: 9 },
};

// Un modelo desconocido se cobra al precio más caro conocido: mejor sobreestimar que pasarse del tope.
const PRECIO_CONSERVADOR: PrecioModelo = Object.values(PRECIOS_MODELO).reduce(
  (maximo, precio) => ({ entrada: Math.max(maximo.entrada, precio.entrada), salida: Math.max(maximo.salida, precio.salida) }),
  { entrada: 0, salida: 0 }
);

export function costoLlamadaUsd(modelo: string, tokensEntrada: number, tokensSalida: number): number {
  const precio = PRECIOS_MODELO[modelo] ?? PRECIO_CONSERVADOR;
  const costo = (tokensEntrada * precio.entrada + tokensSalida * precio.salida) / 1_000_000;
  return Math.round(costo * 1_000_000) / 1_000_000;
}

// Primer instante del mes (UTC) al que pertenece `ahora`.
export function inicioDeMesUtc(ahora: Date): string {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1)).toISOString();
}

export type EstadoPresupuesto = {
  permitido: boolean;
  gastadoMesUsd: number;
  topeUsd: number;
  restanteUsd: number;
  motivo: string | null;
};

export function evaluarPresupuesto(params: {
  gastadoMesUsd: number;
  topeUsd: number;
  costoEstimadoUsd?: number;
}): EstadoPresupuesto {
  const { gastadoMesUsd, topeUsd } = params;
  const costoEstimadoUsd = params.costoEstimadoUsd ?? 0;
  const restanteUsd = Math.max(0, Math.round((topeUsd - gastadoMesUsd) * 1_000_000) / 1_000_000);
  if (gastadoMesUsd >= topeUsd) {
    return { permitido: false, gastadoMesUsd, topeUsd, restanteUsd: 0, motivo: "sin_presupuesto" };
  }
  if (gastadoMesUsd + costoEstimadoUsd > topeUsd) {
    return { permitido: false, gastadoMesUsd, topeUsd, restanteUsd, motivo: "superaria_el_tope" };
  }
  return { permitido: true, gastadoMesUsd, topeUsd, restanteUsd, motivo: null };
}
