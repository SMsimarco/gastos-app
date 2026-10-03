export type Escenarios<T> = { pesimista: T; base: T; optimista: T };

export type EntradaProyeccion = {
  saldoActualUsd: number;
  ahorroMensualPromedioUsd: number;
  rendimientoAnualSupuesto: number;
  precioObjetivoUsd: number;
  fechaBase?: Date;
};

export type ResultadoProyeccion = {
  seLlega: boolean;
  meses: Escenarios<number | null>;
  fechaEstimada: Escenarios<Date | null>;
};

export type MovimientoProyeccion = {
  tipo: "gasto" | "ingreso";
  monto_ars: number;
  fecha: string;
};

export type TipoCambioProyeccion = { fecha: string; mep_venta: number | null };

export type ResumenMesProyeccion = {
  mes: string;
  ingresoUsd: number;
  gastoUsd: number;
  ahorroUsd: number;
  mep: number | null;
};

const MESES_MAXIMOS = 2_400;

function validarNumero(valor: number, nombre: string, minimo = 0) {
  if (!Number.isFinite(valor) || valor < minimo) throw new Error(`${nombre} inválido`);
}
function mesesHastaObjetivo(saldo: number, aporte: number, rendimientoAnual: number, objetivo: number) {
  if (saldo >= objetivo) return 0;
  if (aporte <= 0) return null;
  const tasaMensual = Math.pow(1 + rendimientoAnual, 1 / 12) - 1;
  let capital = saldo;
  for (let mes = 1; mes <= MESES_MAXIMOS; mes++) {
    capital = capital * (1 + tasaMensual) + aporte;
    if (capital >= objetivo) return mes;
  }
  return null;
}

function fechaEnMeses(fecha: Date, meses: number | null) {
  if (meses === null) return null;
  const resultado = new Date(fecha);
  resultado.setUTCMonth(resultado.getUTCMonth() + meses);
  return resultado;
}

export function proyectarDepto(input: EntradaProyeccion): ResultadoProyeccion {
  validarNumero(input.saldoActualUsd, "Saldo actual");
  validarNumero(input.precioObjetivoUsd, "Precio objetivo", Number.EPSILON);
  if (!Number.isFinite(input.rendimientoAnualSupuesto) || input.rendimientoAnualSupuesto <= -1) {
    throw new Error("Rendimiento anual inválido");
  }
  const fechaBase = input.fechaBase ?? new Date();
  const tasas: Escenarios<number> = {
    pesimista: Math.max(-0.99, input.rendimientoAnualSupuesto - 0.02),
    base: input.rendimientoAnualSupuesto,
    optimista: input.rendimientoAnualSupuesto + 0.02,
  };
  const aportes: Escenarios<number> = {
    pesimista: input.ahorroMensualPromedioUsd * 0.8,
    base: input.ahorroMensualPromedioUsd,
    optimista: input.ahorroMensualPromedioUsd * 1.2,
  };
  const meses: Escenarios<number | null> = {
    pesimista: mesesHastaObjetivo(input.saldoActualUsd, aportes.pesimista, tasas.pesimista, input.precioObjetivoUsd),
    base: mesesHastaObjetivo(input.saldoActualUsd, aportes.base, tasas.base, input.precioObjetivoUsd),
    optimista: mesesHastaObjetivo(input.saldoActualUsd, aportes.optimista, tasas.optimista, input.precioObjetivoUsd),
  };
  return {
    seLlega: meses.base !== null,
    meses,
    fechaEstimada: {
      pesimista: fechaEnMeses(fechaBase, meses.pesimista),
      base: fechaEnMeses(fechaBase, meses.base),
      optimista: fechaEnMeses(fechaBase, meses.optimista),
    },
  };
}

function claveMes(fecha: Date) {
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}`;
}

function mesesCompletos(hoy: Date) {
  return Array.from({ length: 6 }, (_, indice) => {
    const fecha = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 6 + indice, 1));
    return claveMes(fecha);
  });
}

export function obtenerMepPorMes(tiposDeCambio: TipoCambioProyeccion[]) {
  const ordenados = tiposDeCambio
    .filter((item) => item.mep_venta !== null && Number(item.mep_venta) > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const mapa = new Map<string, number>();
  for (const item of ordenados) mapa.set(item.fecha.slice(0, 7), Number(item.mep_venta));
  return mapa;
}

export function calcularResumenMensual(
  movimientos: MovimientoProyeccion[],
  tiposDeCambio: TipoCambioProyeccion[],
  hoy: Date = new Date()
): ResumenMesProyeccion[] {
  const meses = mesesCompletos(hoy);
  const mepPorMes = obtenerMepPorMes(tiposDeCambio);
  return meses.map((mes) => {
    const mep = mepPorMes.get(mes) ?? null;
    let ingresosArs = 0;
    let gastosArs = 0;
    for (const movimiento of movimientos) {
      if (movimiento.fecha.slice(0, 7) !== mes) continue;
      if (movimiento.tipo === "ingreso") ingresosArs += Number(movimiento.monto_ars);
      else gastosArs += Number(movimiento.monto_ars);
    }
    return {
      mes,
      ingresoUsd: mep ? ingresosArs / mep : 0,
      gastoUsd: mep ? gastosArs / mep : 0,
      ahorroUsd: mep ? (ingresosArs - gastosArs) / mep : 0,
      mep,
    };
  });
}

export function calcularAhorroMensualPromedio(
  movimientos: MovimientoProyeccion[],
  tiposDeCambio: TipoCambioProyeccion[],
  hoy: Date = new Date()
) {
  const meses = calcularResumenMensual(movimientos, tiposDeCambio, hoy);
  return meses.reduce((total, mes) => total + mes.ahorroUsd, 0) / meses.length;
}

export type EntradaPalancas = EntradaProyeccion & {
  ingresoMensualPromedioUsd: number;
  gastoMensualPromedioUsd: number;
  proyectoTipicoUsd: number;
  aumentoProyectoPct?: number;
  reduccionGastoPct?: number;
};

export type ResultadoPalanca = {
  clave: "proyecto_extra" | "aumentar_precio" | "reducir_gasto" | "mayor_rendimiento";
  nombre: string;
  meses: number | null;
  mesesGanados: number | null;
};

export function compararPalancas(input: EntradaPalancas) {
  const base = proyectarDepto(input).meses.base;
  const aumento = input.aumentoProyectoPct ?? 0.15;
  const reduccion = input.reduccionGastoPct ?? 0.15;
  const alternativas = [
    { clave: "proyecto_extra" as const, nombre: "Un proyecto más por año", ahorro: input.ahorroMensualPromedioUsd + input.proyectoTipicoUsd / 12, rendimiento: input.rendimientoAnualSupuesto },
    { clave: "aumentar_precio" as const, nombre: `Cobrar ${Math.round(aumento * 100)}% más`, ahorro: input.ahorroMensualPromedioUsd + input.ingresoMensualPromedioUsd * aumento, rendimiento: input.rendimientoAnualSupuesto },
    { clave: "reducir_gasto" as const, nombre: `Gastar ${Math.round(reduccion * 100)}% menos`, ahorro: input.ahorroMensualPromedioUsd + input.gastoMensualPromedioUsd * reduccion, rendimiento: input.rendimientoAnualSupuesto },
    { clave: "mayor_rendimiento" as const, nombre: "Dos puntos más de rendimiento", ahorro: input.ahorroMensualPromedioUsd, rendimiento: input.rendimientoAnualSupuesto + 0.02 },
  ];
  return alternativas.map((alternativa): ResultadoPalanca => {
    const meses = proyectarDepto({ ...input, ahorroMensualPromedioUsd: alternativa.ahorro, rendimientoAnualSupuesto: alternativa.rendimiento }).meses.base;
    return { ...alternativa, meses, mesesGanados: base === null || meses === null ? null : Math.max(0, base - meses) };
  }).map(({ clave, nombre, meses, mesesGanados }) => ({ clave, nombre, meses, mesesGanados }));
}

