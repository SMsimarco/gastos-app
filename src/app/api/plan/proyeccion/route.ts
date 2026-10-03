import { NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { obtenerConfigPlan } from "@/lib/planData";
import {
  calcularAhorroMensualPromedio,
  calcularResumenMensual,
  compararPalancas,
  obtenerMepPorMes,
  proyectarDepto,
  type MovimientoProyeccion,
  type TipoCambioProyeccion,
} from "@/lib/inversiones/proyeccion";

export async function GET() {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const hoyAr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const hoy = new Date(`${hoyAr}T12:00:00Z`);
  const desde = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 6, 1)).toISOString().slice(0, 10);
  const hasta = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 0)).toISOString().slice(0, 10);

  const [config, { data: bolsillos }, { data: movimientos }, { data: tiposDeCambio }] = await Promise.all([
    obtenerConfigPlan(supabase, user.id),
    supabase.from("bolsillos").select("clave, saldo").in("clave", ["largo_plazo", "por_invertir"]),
    supabase.from("movimientos").select("tipo, monto_ars, fecha, categorias(nombre)").gte("fecha", desde).lte("fecha", hasta).order("fecha"),
    supabase.from("tipo_cambio").select("fecha, mep_venta").not("mep_venta", "is", null).gte("fecha", desde).lte("fecha", hasta).order("fecha"),
  ]);

  const precioObjetivoUsd = Number(config.monto_objetivo_depto_usd ?? 0);
  if (precioObjetivoUsd <= 0) {
    return NextResponse.json({ configurada: false, mensaje: "Configurá el monto objetivo del departamento para ver la proyección." });
  }

  const movimientosBase = (movimientos ?? []).map((item) => ({
    tipo: item.tipo as "gasto" | "ingreso", monto_ars: Number(item.monto_ars), fecha: item.fecha,
  })) satisfies MovimientoProyeccion[];
  const cambios = (tiposDeCambio ?? []).map((item) => ({ fecha: item.fecha, mep_venta: Number(item.mep_venta) })) satisfies TipoCambioProyeccion[];
  const resumenMeses = calcularResumenMensual(movimientosBase, cambios, hoy);
  const ahorroMensualPromedioUsd = calcularAhorroMensualPromedio(movimientosBase, cambios, hoy);
  const gastoMensualPromedioUsd = resumenMeses.reduce((total, mes) => total + mes.gastoUsd, 0) / 6;
  const mepPorMes = obtenerMepPorMes(cambios);
  const ingresosClientesUsd = (movimientos ?? [])
    .filter((item) => {
      const categoria = item.categorias as unknown as { nombre?: string } | null;
      return item.tipo === "ingreso" && categoria?.nombre?.toLocaleLowerCase("es-AR") === "clientes";
    })
    .map((item) => {
      const mep = mepPorMes.get(item.fecha.slice(0, 7));
      return mep ? Number(item.monto_ars) / mep : 0;
    })
    .filter((monto) => monto > 0);
  const pagosClientesUsd = ingresosClientesUsd.slice(-2);
  const proyectoTipicoUsd = pagosClientesUsd.length
    ? pagosClientesUsd.reduce((total, monto) => total + monto, 0) / pagosClientesUsd.length
    : 0;
  const ingresoMensualPromedioUsd = ingresosClientesUsd.reduce((total, monto) => total + monto, 0) / 6;
  const saldoActualUsd = (bolsillos ?? []).reduce((total, bolsillo) => total + Number(bolsillo.saldo), 0);
  const entrada = {
    saldoActualUsd,
    ahorroMensualPromedioUsd,
    rendimientoAnualSupuesto: Number(config.rendimiento_anual_supuesto),
    precioObjetivoUsd,
    fechaBase: hoy,
  };

  return NextResponse.json({
    configurada: true,
    datos: { saldoActualUsd, ahorroMensualPromedioUsd, ingresoMensualPromedioUsd, gastoMensualPromedioUsd, proyectoTipicoUsd, precioObjetivoUsd, rendimientoAnualSupuesto: entrada.rendimientoAnualSupuesto },
    proyeccion: proyectarDepto(entrada),
    palancas: compararPalancas({ ...entrada, ingresoMensualPromedioUsd, gastoMensualPromedioUsd, proyectoTipicoUsd }),
    mesesUsados: resumenMeses,
  });
}
