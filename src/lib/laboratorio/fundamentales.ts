// Cálculos puros sobre fundamentales, analistas, insiders y filings del laboratorio (SIMULADO).
// La IA recibe estos números ya hechos; no cuenta ni promedia nada.

export type ConsensoAnalistas = { compra: number; mantener: number; venta: number; total: number; pctCompra: number };

export function consensoAnalistas(fila: { strong_buy: number; buy: number; hold: number; sell: number; strong_sell: number }): ConsensoAnalistas | null {
  const compra = fila.strong_buy + fila.buy;
  const venta = fila.sell + fila.strong_sell;
  const total = compra + fila.hold + venta;
  if (total === 0) return null;
  return { compra, mantener: fila.hold, venta, total, pctCompra: Math.round((compra / total) * 100) };
}

export type ResumenInsiders = { compras: number; ventas: number; accionesCompradas: number; accionesVendidas: number };

// Compras y ventas de directivos en los últimos `dias` días hasta `hoy` (YYYY-MM-DD).
export function resumenInsiders(
  movimientos: Array<{ codigo: string; fecha_transaccion: string; cambio_acciones: number }>,
  hoy: string,
  dias = 90
): ResumenInsiders {
  const limite = new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
  const resumen: ResumenInsiders = { compras: 0, ventas: 0, accionesCompradas: 0, accionesVendidas: 0 };
  for (const movimiento of movimientos) {
    if (movimiento.fecha_transaccion < limite) continue;
    if (movimiento.codigo === "P") {
      resumen.compras += 1;
      resumen.accionesCompradas += Math.abs(movimiento.cambio_acciones);
    } else if (movimiento.codigo === "S") {
      resumen.ventas += 1;
      resumen.accionesVendidas += Math.abs(movimiento.cambio_acciones);
    }
  }
  return resumen;
}

const ITEMS_8K: Record<string, string> = {
  "1.01": "Acuerdo importante",
  "1.02": "Fin de un acuerdo importante",
  "1.03": "Quiebra",
  "2.01": "Compra o venta de activos",
  "2.02": "Resultados trimestrales",
  "2.03": "Nueva deuda",
  "2.05": "Reestructuración",
  "2.06": "Deterioro de activos",
  "3.01": "Aviso de listado en bolsa",
  "3.02": "Venta de acciones no registrada",
  "4.01": "Cambio de auditor",
  "4.02": "Reexpresión de balances",
  "5.01": "Cambio de control",
  "5.02": "Cambios en directivos",
  "5.03": "Cambio de estatutos",
  "5.07": "Resultados de la asamblea de accionistas",
  "7.01": "Divulgación de información",
  "8.01": "Otros eventos",
};

const FORMULARIOS: Record<string, string> = {
  "10-Q": "Informe trimestral",
  "10-K": "Informe anual",
  "6-K": "Comunicado de emisor extranjero",
  "20-F": "Informe anual de emisor extranjero",
  "40-F": "Informe anual de emisor extranjero",
};

// El 9.01 (anexos) acompaña a casi todos los 8-K y no dice nada; se omite.
export function describirFiling(formulario: string, items: string[]): string {
  if (formulario === "8-K") {
    const descripciones = items.filter((item) => item !== "9.01").map((item) => ITEMS_8K[item] ?? `Ítem ${item}`);
    return descripciones.length > 0 ? descripciones.join(", ") : "Reporte de hechos relevantes";
  }
  return FORMULARIOS[formulario] ?? formulario;
}
