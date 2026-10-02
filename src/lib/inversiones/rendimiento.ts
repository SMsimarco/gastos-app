export type TipoActivo = "etf" | "accion" | "cuenta_remunerada";
export type TipoOperacion = "compra" | "venta" | "dividendo";

export type ActivoRendimiento = {
  id: string;
  ticker: string;
  nombre: string;
  tipo: TipoActivo;
  moneda: "ARS" | "USD";
  bolsillo_clave: string;
  tasa_anual: number | null;
};

export type OperacionRendimiento = {
  activo_id: string;
  tipo: TipoOperacion;
  fecha: string;
  cantidad: number;
  precio_usd: number;
  monto_usd: number;
  comision_usd: number;
};

export type PrecioRendimiento = {
  ticker: string;
  fecha: string;
  cierre_usd: number;
  max_52s?: number | null;
};

export type BolsilloRendimiento = { clave: string; saldo: number };

export type RendimientoActivo = {
  id: string;
  ticker: string;
  nombre: string;
  cantidad: number;
  costoPromedioUsd: number;
  invertidoUsd: number;
  valorActualUsd: number;
  gananciaUsd: number;
  gananciaPct: number;
  dividendosUsd: number;
  diasDesdePrimeraCompra: number | null;
  precioActualUsd: number | null;
  fechaPrecio: string | null;
  precioDesactualizado: boolean;
};

export type RendimientoCuenta = {
  id: string;
  ticker: string;
  nombre: string;
  moneda: "ARS" | "USD";
  saldo: number;
  tasaAnualPct: number;
  rendimientoMes: number;
  rendimientoAnio: number;
  tasaRealAnualPct: number | null;
  rendimientoRealMes: number | null;
  valorUsd: number;
};

const redondear = (valor: number, decimales = 2) => {
  const factor = 10 ** decimales;
  return Math.round((valor + Number.EPSILON) * factor) / factor;
};

function diasEntre(desde: string, hasta: string) {
  return Math.max(0, Math.floor((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000));
}

function diasHabilesTranscurridos(desde: string, hasta: string) {
  let cantidad = 0;
  const cursor = new Date(`${desde}T00:00:00Z`);
  const fin = new Date(`${hasta}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= fin) {
    const dia = cursor.getUTCDay();
    if (dia !== 0 && dia !== 6) cantidad++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cantidad;
}

function precioEnFecha(precios: PrecioRendimiento[], ticker: string, fecha: string) {
  return precios
    .filter((precio) => precio.ticker === ticker && precio.fecha <= fecha)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))[0] ?? null;
}

export function calcularCartera(input: {
  activos: ActivoRendimiento[];
  operaciones: OperacionRendimiento[];
  precios: PrecioRendimiento[];
  bolsillos: BolsilloRendimiento[];
  inflacionMensualPct: number | null;
  tcReferencia: number;
  hoy: string;
}) {
  const activosMercado = input.activos.filter((activo) => activo.tipo !== "cuenta_remunerada");
  const cuentas = input.activos.filter((activo) => activo.tipo === "cuenta_remunerada");

  const rendimientos: RendimientoActivo[] = activosMercado.map((activo) => {
    const operaciones = input.operaciones
      .filter((operacion) => operacion.activo_id === activo.id)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    let cantidad = 0;
    let costoBase = 0;
    let compras = 0;
    let ventas = 0;
    let dividendos = 0;

    for (const operacion of operaciones) {
      if (operacion.tipo === "compra") {
        cantidad += operacion.cantidad;
        const costo = operacion.monto_usd + operacion.comision_usd;
        costoBase += costo;
        compras += costo;
      } else if (operacion.tipo === "venta") {
        const costoPromedio = cantidad > 0 ? costoBase / cantidad : 0;
        const cantidadVendida = Math.min(cantidad, operacion.cantidad);
        costoBase -= costoPromedio * cantidadVendida;
        cantidad -= cantidadVendida;
        ventas += operacion.monto_usd - operacion.comision_usd;
      } else {
        dividendos += operacion.monto_usd - operacion.comision_usd;
      }
    }

    const ultimoPrecio = precioEnFecha(input.precios, activo.ticker, input.hoy);
    const valorActual = ultimoPrecio ? cantidad * ultimoPrecio.cierre_usd : 0;
    const ganancia = valorActual + ventas + dividendos - compras;
    const primeraCompra = operaciones.find((operacion) => operacion.tipo === "compra")?.fecha ?? null;

    return {
      id: activo.id,
      ticker: activo.ticker,
      nombre: activo.nombre,
      cantidad: redondear(cantidad, 6),
      costoPromedioUsd: redondear(cantidad > 0 ? costoBase / cantidad : 0),
      invertidoUsd: redondear(costoBase),
      valorActualUsd: redondear(valorActual),
      gananciaUsd: redondear(ganancia),
      gananciaPct: redondear(compras > 0 ? (ganancia / compras) * 100 : 0),
      dividendosUsd: redondear(dividendos),
      diasDesdePrimeraCompra: primeraCompra ? diasEntre(primeraCompra, input.hoy) : null,
      precioActualUsd: ultimoPrecio ? redondear(ultimoPrecio.cierre_usd) : null,
      fechaPrecio: ultimoPrecio?.fecha ?? null,
      precioDesactualizado: !ultimoPrecio || diasHabilesTranscurridos(ultimoPrecio.fecha, input.hoy) > 1,
    };
  });

  const rendimientosCuentas: RendimientoCuenta[] = cuentas.map((cuenta) => {
    const saldo = Number(input.bolsillos.find((bolsillo) => bolsillo.clave === cuenta.bolsillo_clave)?.saldo ?? 0);
    const tasa = Number(cuenta.tasa_anual ?? 0);
    const tasaReal = cuenta.moneda === "ARS" && input.inflacionMensualPct !== null
      ? tasa - input.inflacionMensualPct * 12
      : null;
    return {
      id: cuenta.id,
      ticker: cuenta.ticker,
      nombre: cuenta.nombre,
      moneda: cuenta.moneda,
      saldo: redondear(saldo),
      tasaAnualPct: redondear(tasa),
      rendimientoMes: redondear((saldo * tasa) / 100 / 12),
      rendimientoAnio: redondear((saldo * tasa) / 100),
      tasaRealAnualPct: tasaReal === null ? null : redondear(tasaReal),
      rendimientoRealMes: tasaReal === null ? null : redondear((saldo * tasaReal) / 100 / 12),
      valorUsd: redondear(cuenta.moneda === "ARS" ? saldo / input.tcReferencia : saldo),
    };
  });

  const ultimoVoo = precioEnFecha(input.precios, "VOO", input.hoy);
  let unidadesVoo = 0;
  for (const operacion of input.operaciones) {
    const activo = activosMercado.find((item) => item.id === operacion.activo_id);
    if (!activo || operacion.tipo === "dividendo") continue;
    const precioVoo = precioEnFecha(input.precios, "VOO", operacion.fecha);
    if (!precioVoo) continue;
    const flujo = operacion.tipo === "compra"
      ? operacion.monto_usd + operacion.comision_usd
      : -(operacion.monto_usd - operacion.comision_usd);
    unidadesVoo += flujo / precioVoo.cierre_usd;
  }

  const valorMercado = rendimientos.reduce((total, activo) => total + activo.valorActualUsd, 0);
  const valorCuentas = rendimientosCuentas.reduce((total, cuenta) => total + cuenta.valorUsd, 0);
  const invertidoMercado = rendimientos.reduce((total, activo) => total + activo.invertidoUsd, 0);
  const gananciaMercado = rendimientos.reduce((total, activo) => total + activo.gananciaUsd, 0);
  const valorBenchmark = ultimoVoo ? unidadesVoo * ultimoVoo.cierre_usd : 0;
  const diferenciaBenchmark = valorBenchmark - valorMercado;

  const fechas = [...new Set(input.precios.map((precio) => precio.fecha).filter((fecha) => fecha <= input.hoy))].sort();
  const historial = fechas.map((fecha) => {
    let valor = 0;
    for (const activo of activosMercado) {
      const cantidad = input.operaciones
        .filter((operacion) => operacion.activo_id === activo.id && operacion.fecha <= fecha)
        .reduce((total, operacion) => total + (operacion.tipo === "compra" ? operacion.cantidad : operacion.tipo === "venta" ? -operacion.cantidad : 0), 0);
      const precio = precioEnFecha(input.precios, activo.ticker, fecha);
      if (precio) valor += Math.max(0, cantidad) * precio.cierre_usd;
    }
    return { fecha, valorUsd: redondear(valor) };
  }).filter((punto) => punto.valorUsd > 0);

  return {
    activos: rendimientos,
    cuentas: rendimientosCuentas,
    total: {
      valorUsd: redondear(valorMercado + valorCuentas),
      invertidoUsd: redondear(invertidoMercado + valorCuentas),
      gananciaUsd: redondear(gananciaMercado),
      gananciaPct: redondear(invertidoMercado > 0 ? (gananciaMercado / invertidoMercado) * 100 : 0),
    },
    benchmark: {
      valorVooUsd: redondear(valorBenchmark),
      diferenciaUsd: redondear(diferenciaBenchmark),
      diferenciaPct: redondear(valorMercado > 0 ? (diferenciaBenchmark / valorMercado) * 100 : 0),
      hubieraSidoMejorVoo: diferenciaBenchmark > 0,
    },
    historial,
  };
}
