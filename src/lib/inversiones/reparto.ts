export type ClaveBolsillo =
  | "gastos"
  | "emergencia"
  | "largo_plazo"
  | "aprender"
  | "por_invertir";

export type ConfigReparto = {
  pctGastos: number;
  pctLargoPlazo: number;
  pctAprender: number;
  emergenciaPrimero: boolean;
  mesesEmergencia: number;
  minimoCompraUsd: number;
};

export type ResultadoReparto = Record<ClaveBolsillo, number> & {
  metaEmergenciaUsd: number;
  explicacion: string[];
  acciones: string[];
};

export type MovimientoParaGasto = {
  tipo: "gasto" | "ingreso";
  monto_ars: number;
  fecha: string;
};

const CENTAVOS = 100;

export function redondearCentavos(valor: number): number {
  return Math.round((valor + Number.EPSILON) * CENTAVOS) / CENTAVOS;
}

function validarEntrada(input: {
  montoIngresoArs: number;
  gastoMensualArs: number;
  tcReferencia: number;
  config: ConfigReparto;
}) {
  const { montoIngresoArs, gastoMensualArs, tcReferencia, config } = input;
  if (!Number.isFinite(montoIngresoArs) || montoIngresoArs <= 0) throw new Error("El ingreso debe ser mayor que cero");
  if (!Number.isFinite(gastoMensualArs) || gastoMensualArs < 0) throw new Error("El gasto mensual no puede ser negativo");
  if (!Number.isFinite(tcReferencia) || tcReferencia <= 0) throw new Error("La cotización debe ser mayor que cero");

  const porcentajes = [config.pctGastos, config.pctLargoPlazo, config.pctAprender];
  if (porcentajes.some((pct) => !Number.isInteger(pct) || pct < 0 || pct > 100)) {
    throw new Error("Los porcentajes deben ser enteros entre 0 y 100");
  }
  if (porcentajes.reduce((total, pct) => total + pct, 0) !== 100) {
    throw new Error("Los porcentajes del plan deben sumar 100");
  }
  if (!Number.isFinite(config.mesesEmergencia) || config.mesesEmergencia <= 0) {
    throw new Error("Los meses de emergencia deben ser mayores que cero");
  }
  if (!Number.isFinite(config.minimoCompraUsd) || config.minimoCompraUsd <= 0) {
    throw new Error("El mínimo de compra debe ser mayor que cero");
  }
}

export function calcularReparto(input: {
  montoIngresoArs: number;
  saldos: { gastos: number; emergencia: number; porInvertir?: number };
  gastoMensualArs: number;
  tcReferencia: number;
  config: ConfigReparto;
}): ResultadoReparto {
  validarEntrada(input);
  const { montoIngresoArs, saldos, gastoMensualArs, tcReferencia, config } = input;
  const explicacion: string[] = [];
  const acciones: string[] = [];

  const gastosBase = redondearCentavos((montoIngresoArs * config.pctGastos) / 100);
  const faltanteGastos = Math.max(0, gastoMensualArs - Math.max(0, saldos.gastos));
  const gastos = redondearCentavos(Math.min(montoIngresoArs, Math.max(gastosBase, faltanteGastos)));
  if (gastos > gastosBase) {
    explicacion.push(`Gastos sube a $${Math.round(gastos).toLocaleString("es-AR")} para cubrir un mes.`);
  } else {
    explicacion.push(`Gastos recibe ${config.pctGastos}%: $${Math.round(gastos).toLocaleString("es-AR")}.`);
  }
  if (gastos > 0) acciones.push(`Dejá $${Math.round(gastos).toLocaleString("es-AR")} para gastos.`);

  const disponibleUsd = redondearCentavos((montoIngresoArs - gastos) / tcReferencia);
  const metaEmergenciaUsd = redondearCentavos((config.mesesEmergencia * gastoMensualArs) / tcReferencia);
  const faltanteEmergencia = redondearCentavos(Math.max(0, metaEmergenciaUsd - Math.max(0, saldos.emergencia)));
  const emergencia = config.emergenciaPrimero
    ? redondearCentavos(Math.min(disponibleUsd, faltanteEmergencia))
    : 0;

  if (emergencia > 0) {
    explicacion.push(`Emergencia recibe US$${emergencia.toFixed(2)}; faltaban US$${faltanteEmergencia.toFixed(2)} para la meta.`);
    acciones.push(`Pasá US$${emergencia.toFixed(2)} a USDc remunerado para emergencia.`);
  } else if (config.emergenciaPrimero) {
    explicacion.push("El fondo de emergencia ya está completo.");
  }

  const paraInvertirUsd = redondearCentavos(disponibleUsd - emergencia);
  const pesoInversion = config.pctLargoPlazo + config.pctAprender;
  let largoPlazo = pesoInversion > 0
    ? redondearCentavos((paraInvertirUsd * config.pctLargoPlazo) / pesoInversion)
    : 0;
  let aprender = redondearCentavos(paraInvertirUsd - largoPlazo);
  let porInvertir = 0;

  if (largoPlazo > 0 && largoPlazo < config.minimoCompraUsd) {
    porInvertir = redondearCentavos(porInvertir + largoPlazo);
    explicacion.push(`Largo plazo queda debajo de US$${config.minimoCompraUsd.toFixed(2)} y se acumula en Por invertir.`);
    largoPlazo = 0;
  }
  if (aprender > 0 && aprender < config.minimoCompraUsd) {
    porInvertir = redondearCentavos(porInvertir + aprender);
    explicacion.push(`Aprender queda debajo de US$${config.minimoCompraUsd.toFixed(2)} y se acumula en Por invertir.`);
    aprender = 0;
  }

  const asignadoUsd = redondearCentavos(emergencia + largoPlazo + aprender + porInvertir);
  const residuoUsd = redondearCentavos(disponibleUsd - asignadoUsd);
  if (residuoUsd !== 0) {
    if (largoPlazo > 0) largoPlazo = redondearCentavos(largoPlazo + residuoUsd);
    else porInvertir = redondearCentavos(porInvertir + residuoUsd);
  }

  if (largoPlazo > 0) acciones.push(`Comprá US$${largoPlazo.toFixed(2)} de VOO en ARQ.`);
  if (aprender > 0) acciones.push(`Destiná US$${aprender.toFixed(2)} a un activo de tu lista para aprender.`);
  if (porInvertir > 0) {
    const acumulado = redondearCentavos((saldos.porInvertir ?? 0) + porInvertir);
    acciones.push(`Dejá US$${porInvertir.toFixed(2)} en Por invertir; el saldo quedaría en US$${acumulado.toFixed(2)}.`);
  }

  return {
    gastos,
    emergencia,
    largo_plazo: largoPlazo,
    aprender,
    por_invertir: porInvertir,
    metaEmergenciaUsd,
    explicacion,
    acciones,
  };
}

export function calcularGastoMensual(
  movimientos: MovimientoParaGasto[],
  hoy: Date = new Date()
): number | null {
  const meses = new Set<string>();
  for (let i = 1; i <= 3; i++) {
    const fecha = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    meses.add(fecha.toISOString().slice(0, 7));
  }

  const gastos = movimientos.filter(
    (movimiento) => movimiento.tipo === "gasto" && meses.has(movimiento.fecha.slice(0, 7))
  );
  if (gastos.length === 0) return null;

  const total = gastos.reduce((suma, movimiento) => suma + Number(movimiento.monto_ars), 0);
  return redondearCentavos(total / 3);
}
