// Acceso a datos del plan de ahorro. El cálculo del reparto en sí vive en
// plan.ts (función pura); acá solo se junta lo que necesita ese cálculo.
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularReparto, calcularGastoMensual, type ConfigPlan, type ResultadoReparto } from "./plan";

export type ConfigPlanRow = {
  usuario_id: string;
  meses_emergencia: number;
  meses_cobertura_gastos: number;
  pct_depto: number;
  gasto_mensual_manual: number | null;
  umbral_compra_usd: number;
};

export async function obtenerConfigPlan(supabase: SupabaseClient, usuarioId: string): Promise<ConfigPlanRow> {
  const { data } = await supabase.from("config_plan").select("*").eq("usuario_id", usuarioId).single();
  if (data) return data;
  // Fallback por si el trigger no corrió (no debería pasar, pero no bloqueamos el flujo).
  return {
    usuario_id: usuarioId,
    meses_emergencia: 3,
    meses_cobertura_gastos: 1.5,
    pct_depto: 85,
    gasto_mensual_manual: null,
    umbral_compra_usd: 100,
  };
}

export type GastoMensual = { valor: number | null; fuente: "calculado" | "manual" };

// "calculado" = promedio real de los últimos 3 meses completos.
// "manual" = no hay (o no alcanza) datos reales, se usó gasto_mensual_manual.
export async function obtenerGastoMensualConFuente(
  supabase: SupabaseClient,
  usuarioId: string
): Promise<GastoMensual> {
  const config = await obtenerConfigPlan(supabase, usuarioId);

  const hoyISO = new Date().toISOString().slice(0, 10);
  const desde = new Date();
  desde.setUTCMonth(desde.getUTCMonth() - 4); // margen: 3 meses completos + el actual

  const { data: movimientos } = await supabase
    .from("movimientos")
    .select("tipo, monto_ars, fecha")
    .eq("usuario_id", usuarioId)
    .eq("tipo", "gasto")
    .gte("fecha", desde.toISOString().slice(0, 10))
    .lte("fecha", hoyISO);

  const calculado = calcularGastoMensual(movimientos ?? []);
  if (calculado !== null) return { valor: calculado, fuente: "calculado" };
  return { valor: config.gasto_mensual_manual ?? null, fuente: "manual" };
}

export async function obtenerGastoMensualArs(supabase: SupabaseClient, usuarioId: string): Promise<number | null> {
  const { valor } = await obtenerGastoMensualConFuente(supabase, usuarioId);
  return valor;
}

export async function obtenerUltimoMep(supabase: SupabaseClient): Promise<number | null> {
  const { data } = await supabase
    .from("tipo_cambio")
    .select("mep_venta")
    .not("mep_venta", "is", null)
    .order("fecha", { ascending: false })
    .limit(1);
  return data && data.length > 0 ? data[0].mep_venta : null;
}

export type RepartoRow = {
  id: string;
  monto_ars: number;
  tc_referencia: number;
  detalle: ResultadoReparto;
  estado: "pendiente" | "aplicado" | "descartado";
};

// Arma y guarda el reparto pendiente para un monto a repartir: el ingreso
// recién capturado (ingresoId) o, para el simulador manual de "cuánta plata
// tengo disponible ahora", sin ingreso asociado (ingresoId = null).
// Devuelve null si falta algún dato imprescindible (MEP o gasto mensual) —
// en ese caso no se genera reparto (el ingreso, si lo hay, igual queda registrado).
export async function generarRepartoParaIngreso(
  supabase: SupabaseClient,
  usuarioId: string,
  ingresoId: string | null,
  montoIngresoArs: number
): Promise<RepartoRow | null> {
  const [config, tcReferencia, gastoMensualArs] = await Promise.all([
    obtenerConfigPlan(supabase, usuarioId),
    obtenerUltimoMep(supabase),
    obtenerGastoMensualArs(supabase, usuarioId),
  ]);

  if (!tcReferencia || !gastoMensualArs) return null;

  const { data: bolsillos } = await supabase
    .from("bolsillos")
    .select("clave, saldo")
    .eq("usuario_id", usuarioId)
    .in("clave", ["gastos", "emergencia"]);

  const saldoGastos = bolsillos?.find((b) => b.clave === "gastos")?.saldo ?? 0;
  const saldoEmergencia = bolsillos?.find((b) => b.clave === "emergencia")?.saldo ?? 0;

  const configCalculo: ConfigPlan = {
    mesesEmergencia: config.meses_emergencia,
    mesesCoberturaGastos: config.meses_cobertura_gastos,
    pctDepto: config.pct_depto,
    umbralCompraUsd: config.umbral_compra_usd,
  };

  const detalle = calcularReparto({
    montoIngresoArs,
    saldos: { gastos: saldoGastos, emergencia: saldoEmergencia },
    gastoMensualArs,
    tcReferencia,
    config: configCalculo,
  });

  const { data: reparto, error } = await supabase
    .from("repartos")
    .insert({
      usuario_id: usuarioId,
      ingreso_id: ingresoId,
      monto_ars: montoIngresoArs,
      tc_referencia: tcReferencia,
      detalle,
      estado: "pendiente",
    })
    .select("id, monto_ars, tc_referencia, detalle, estado")
    .single();

  if (error || !reparto) return null;
  return reparto as RepartoRow;
}

// Si el ingreso editado/borrado tiene un reparto: lo descarta si estaba
// pendiente, y avisa (sin revertir nada) si ya estaba aplicado.
export async function manejarRepartoDeIngresoEditado(
  supabase: SupabaseClient,
  ingresoId: string
): Promise<{ avisoRepartoAplicado: boolean }> {
  const { data: reparto } = await supabase
    .from("repartos")
    .select("id, estado")
    .eq("ingreso_id", ingresoId)
    .maybeSingle();

  if (!reparto) return { avisoRepartoAplicado: false };

  if (reparto.estado === "pendiente") {
    await supabase.from("repartos").update({ estado: "descartado" }).eq("id", reparto.id);
    return { avisoRepartoAplicado: false };
  }

  return { avisoRepartoAplicado: reparto.estado === "aplicado" };
}

export function resumenRepartoTexto(detalle: ResultadoReparto): string {
  const partes = [`Gastos $${Math.round(detalle.gastos).toLocaleString("es-AR")}`];
  if (detalle.emergencia > 0) partes.push(`Emergencia US$${detalle.emergencia.toFixed(2)}`);
  if (detalle.depto > 0) partes.push(`Depto US$${detalle.depto.toFixed(2)}`);
  if (detalle.aprender > 0) partes.push(`Aprender US$${detalle.aprender.toFixed(2)}`);
  return partes.join(" · ");
}
