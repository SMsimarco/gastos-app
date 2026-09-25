// Reparto de cobros a bolsillos de ahorro. Función pura, determinística: nada
// de Gemini ni Supabase acá. Ver PLAN_AHORRO.md / README para el contexto.

export type Bolsillo = "gastos" | "emergencia" | "depto" | "aprender";

export type ConfigPlan = {
  mesesEmergencia: number;
  mesesCoberturaGastos: number;
  pctDepto: number; // 0-100, el resto va a "aprender"
  umbralCompraUsd: number;
};

export type ResultadoReparto = {
  gastos: number; // ARS
  emergencia: number; // USD
  depto: number; // USD
  aprender: number; // USD
  metaEmergenciaUsd: number;
  sugerirCompraVOO: boolean;
  explicacion: string[];
};

function redondearCentavos(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calcularReparto(input: {
  montoIngresoArs: number;
  saldos: { gastos: number; emergencia: number };
  gastoMensualArs: number;
  tcReferencia: number;
  config: ConfigPlan;
}): ResultadoReparto {
  const { montoIngresoArs, saldos, gastoMensualArs, tcReferencia, config } = input;
  const explicacion: string[] = [];

  // 1. Gastos (ARS): cubrir hasta el próximo cobro.
  const necesarioGastos = Math.max(0, gastoMensualArs * config.mesesCoberturaGastos - saldos.gastos);
  const aGastosArs = redondearCentavos(Math.min(necesarioGastos, montoIngresoArs));
  if (aGastosArs > 0) {
    explicacion.push(
      `Gastos: $${Math.round(aGastosArs).toLocaleString("es-AR")} → cubrís gastos hasta el próximo cobro`
    );
  } else {
    explicacion.push("Gastos: $0 → ya tenés cubierto hasta el próximo cobro");
  }

  // 2. Resto pasa a USD con la referencia (MEP).
  const restoArs = montoIngresoArs - aGastosArs;
  const restoUsd = tcReferencia > 0 ? restoArs / tcReferencia : 0;

  // 3. Emergencia (USD): completar meta.
  const metaEmergenciaUsd = tcReferencia > 0 ? (config.mesesEmergencia * gastoMensualArs) / tcReferencia : 0;
  const faltanteEmergencia = Math.max(0, metaEmergenciaUsd - saldos.emergencia);
  const aEmergenciaUsd = redondearCentavos(Math.min(restoUsd, faltanteEmergencia));
  if (aEmergenciaUsd > 0) {
    explicacion.push(
      `Emergencia: US$${aEmergenciaUsd.toFixed(2)} → completás la meta de US$${metaEmergenciaUsd.toFixed(2)}`
    );
  } else {
    explicacion.push("Emergencia: US$0 → meta ya completa");
  }

  // 4. Resto: pctDepto% a depto, el resto a aprender.
  const restoUsdTrasEmergencia = restoUsd - aEmergenciaUsd;
  const aDeptoUsd = redondearCentavos((restoUsdTrasEmergencia * config.pctDepto) / 100);
  const aAprenderUsd = redondearCentavos(restoUsdTrasEmergencia - aDeptoUsd);

  // 5. La suma asignada (en USD) tiene que dar exactamente restoUsdTrasEmergencia.
  // Cualquier residuo de redondeo se lo llevamos a depto.
  const asignadoDeptoAprender = redondearCentavos(aDeptoUsd + aAprenderUsd);
  const residuoUsd = redondearCentavos(restoUsdTrasEmergencia - asignadoDeptoAprender);
  const aDeptoFinal = redondearCentavos(aDeptoUsd + residuoUsd);
  const aAprenderFinal = aAprenderUsd;

  explicacion.push(
    `Depto (VOO): US$${aDeptoFinal.toFixed(2)}${aAprenderFinal > 0 ? ` · Aprender: US$${aAprenderFinal.toFixed(2)}` : ""}`
  );

  // 6. Sugerencia de compra VOO.
  const sugerirCompraVOO = aDeptoFinal >= config.umbralCompraUsd;
  if (aDeptoFinal > 0) {
    explicacion.push(
      sugerirCompraVOO
        ? `Podés comprar VOO ahora (US$${aDeptoFinal.toFixed(2)} ≥ umbral de US$${config.umbralCompraUsd})`
        : `Acumulalo en USDc y compralo junto con el próximo cobro (la comisión mínima de ARQ es US$1 por operación)`
    );
  }

  return {
    gastos: aGastosArs,
    emergencia: aEmergenciaUsd,
    depto: aDeptoFinal,
    aprender: aAprenderFinal,
    metaEmergenciaUsd: redondearCentavos(metaEmergenciaUsd),
    sugerirCompraVOO,
    explicacion,
  };
}

export type MovimientoParaGasto = {
  tipo: "gasto" | "ingreso";
  monto_ars: number;
  fecha: string; // YYYY-MM-DD
};

// Promedio de gastos de los últimos 3 meses COMPLETOS (excluye el mes en
// curso y cualquier cuota futura). Si hay menos de 1 mes completo de datos,
// devuelve null — el caller debe usar gasto_mensual_manual o pedirlo en la UI.
export function calcularGastoMensual(movimientos: MovimientoParaGasto[], hoy: Date = new Date()): number | null {
  const hoyISO = hoy.toISOString().slice(0, 10);
  const anioMesActual = hoyISO.slice(0, 7);

  // Meses completos = los 3 anteriores al mes en curso.
  const mesesCompletos: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    mesesCompletos.push(d.toISOString().slice(0, 7));
  }

  const gastosPorMes = new Map<string, number>();
  for (const m of movimientos) {
    if (m.tipo !== "gasto") continue;
    if (m.fecha > hoyISO) continue; // excluye cuotas futuras
    const anioMes = m.fecha.slice(0, 7);
    if (anioMes === anioMesActual) continue; // mes en curso no está completo
    if (!mesesCompletos.includes(anioMes)) continue;
    gastosPorMes.set(anioMes, (gastosPorMes.get(anioMes) ?? 0) + m.monto_ars);
  }

  if (gastosPorMes.size === 0) return null;

  const total = Array.from(gastosPorMes.values()).reduce((a, b) => a + b, 0);
  return redondearCentavos(total / gastosPorMes.size);
}
