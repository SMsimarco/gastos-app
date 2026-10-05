export type ActivoSugerencias = {
  ticker: string;
  bolsilloClave: string;
  gananciaPct: number;
  precioActualUsd: number | null;
  max52sUsd: number | null;
  tomaGananciaPct: number | null;
  stopRevisionPct: number | null;
};

export type EstadoInversiones = {
  hoy: string;
  emergencia: { saldoUsd: number; metaUsd: number };
  porInvertirUsd: number;
  minimoCompraUsd: number;
  activos: ActivoSugerencias[];
  fechaObjetivoDepto: string | null;
  aniosTransicion: number;
  valorAprenderUsd: number;
  valorTotalCarteraUsd: number;
  pctAprenderObjetivo: number;
};

export type Sugerencia = {
  tipo: string;
  prioridad: number;
  mensaje: string;
  datos: Record<string, unknown>;
};

const usd = (valor: number) => valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (valor: number) => valor.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

// Regla de la Fase 4 para VOO: aviso si cae 10% o más desde su máximo de 52 semanas (oportunidad de compra de largo
// plazo, nunca una señal de venta). La reutilizan los avisos de empresas grandes.
export const UMBRAL_VOO_BAJO_MAXIMO_PCT = 10;
export function caidaDesdeMaximoPct(precioActual: number, max52s: number): number {
  return max52s > 0 ? ((max52s - precioActual) / max52s) * 100 : 0;
}

// Reglas 4 y 5 de un activo del bolsillo aprender. Las reutiliza el asesor de aprender (aprender.ts).
export function evaluarObjetivoGanancia(activo: ActivoSugerencias): Sugerencia | null {
  if (activo.tomaGananciaPct === null || activo.gananciaPct < activo.tomaGananciaPct) return null;
  return {
    tipo: "objetivo_ganancia",
    prioridad: 400,
    mensaje: `${activo.ticker} llegó a tu objetivo de +${pct(activo.tomaGananciaPct)}%: tu regla es tomar ganancia acá.`,
    datos: { ticker: activo.ticker, gananciaPct: activo.gananciaPct, objetivoPct: activo.tomaGananciaPct },
  };
}

export function evaluarRevisionTesis(activo: ActivoSugerencias): Sugerencia | null {
  if (activo.stopRevisionPct === null || activo.gananciaPct > -Math.abs(activo.stopRevisionPct)) return null;
  return {
    tipo: "revisar_tesis",
    prioridad: 300,
    mensaje: `${activo.ticker} bajó más de ${pct(Math.abs(activo.stopRevisionPct))}%: revisá si tu tesis sigue siendo válida.`,
    datos: { ticker: activo.ticker, gananciaPct: activo.gananciaPct, umbralPct: activo.stopRevisionPct },
  };
}

export function generarSugerencias(estado: EstadoInversiones): Sugerencia[] {
  const sugerencias: Sugerencia[] = [];
  const faltanteEmergencia = Math.max(0, estado.emergencia.metaUsd - estado.emergencia.saldoUsd);

  if (estado.emergencia.metaUsd > 0 && faltanteEmergencia > 0) {
    sugerencias.push({
      tipo: "completar_emergencia",
      prioridad: 700,
      mensaje: `Completá tu fondo de emergencia: te faltan US$${usd(faltanteEmergencia)} de US$${usd(estado.emergencia.metaUsd)}.`,
      datos: { faltanteUsd: faltanteEmergencia, metaUsd: estado.emergencia.metaUsd },
    });
  }

  if (estado.porInvertirUsd >= estado.minimoCompraUsd) {
    sugerencias.push({
      tipo: "comprar_voo",
      prioridad: 600,
      mensaje: `Tenés US$${usd(estado.porInvertirUsd)} acumulados para comprar VOO.`,
      datos: { saldoUsd: estado.porInvertirUsd, minimoCompraUsd: estado.minimoCompraUsd },
    });
  }

  const voo = estado.activos.find((activo) => activo.ticker === "VOO");
  if (voo?.precioActualUsd && voo.max52sUsd && voo.max52sUsd > 0 && estado.porInvertirUsd > 0) {
    const caidaPct = caidaDesdeMaximoPct(voo.precioActualUsd, voo.max52sUsd);
    if (caidaPct >= UMBRAL_VOO_BAJO_MAXIMO_PCT) {
      sugerencias.push({
        tipo: "voo_bajo_maximo",
        prioridad: 500,
        mensaje: `VOO está ${pct(caidaPct)}% abajo de su máximo de 52 semanas: comprar ahora es comprar más barato. No se vende.`,
        datos: { caidaPct, precioActualUsd: voo.precioActualUsd, max52sUsd: voo.max52sUsd },
      });
    }
  }

  for (const activo of estado.activos.filter((item) => item.bolsilloClave === "aprender")) {
    const objetivo = evaluarObjetivoGanancia(activo);
    if (objetivo) sugerencias.push(objetivo);
    const revision = evaluarRevisionTesis(activo);
    if (revision) sugerencias.push(revision);
  }

  if (estado.fechaObjetivoDepto) {
    const milisegundos = Date.parse(`${estado.fechaObjetivoDepto}T00:00:00Z`) - Date.parse(`${estado.hoy}T00:00:00Z`);
    const aniosRestantes = Math.max(0, milisegundos / (365.25 * 86_400_000));
    if (aniosRestantes < estado.aniosTransicion) {
      sugerencias.push({
        tipo: "transicion_depto",
        prioridad: 200,
        mensaje: `Te quedan menos de ${estado.aniosTransicion} años para la fecha del depto: empezá a pasar una parte de VOO a algo estable.`,
        datos: { fechaObjetivo: estado.fechaObjetivoDepto, aniosRestantes, aniosTransicion: estado.aniosTransicion },
      });
    }
  }

  if (estado.valorTotalCarteraUsd > 0) {
    const participacionPct = (estado.valorAprenderUsd / estado.valorTotalCarteraUsd) * 100;
    if (participacionPct > estado.pctAprenderObjetivo) {
      sugerencias.push({
        tipo: "aprender_sobreponderado",
        prioridad: 100,
        mensaje: `Aprender ya es más del ${pct(estado.pctAprenderObjetivo)}% de tu cartera: no le sumes más por ahora, rebalanceá con los próximos cobros.`,
        datos: { participacionPct, objetivoPct: estado.pctAprenderObjetivo },
      });
    }
  }

  return sugerencias.sort((a, b) => b.prioridad - a.prioridad);
}
