import type { Movimiento } from "@/lib/gemini";

// Cobro pactado en USD pero acreditado en pesos ("cobré 500 dólares, me transfirieron 725.000").
// Lo real es lo que entró al banco: se guarda como ARS, con el tipo de cambio implícito y
// los USD como referencia. Así el reparto sale de los pesos reales y no de USD x cotización.
export function resolverCobroEnPesos(
  item: Movimiento
): { item: Movimiento; tcUsado: number; montoUsd: number } | null {
  const recibido = Number(item.monto_ars_recibido ?? 0);
  if (item.moneda !== "USD" || !(item.monto > 0) || !(recibido > 0)) return null;
  return {
    item: { ...item, moneda: "ARS", monto: recibido },
    tcUsado: Number((recibido / item.monto).toFixed(4)),
    montoUsd: item.monto,
  };
}
