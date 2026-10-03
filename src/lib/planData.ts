import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calcularGastoMensual,
  calcularReparto,
  type ConfigReparto,
  type ResultadoReparto,
} from "./inversiones/reparto";

export type ConfigPlanRow = {
  usuario_id: string;
  pct_gastos: number;
  pct_largo_plazo: number;
  pct_aprender: number;
  emergencia_primero: boolean;
  meses_emergencia: number;
  gasto_mensual_manual: number | null;
  minimo_compra_usd: number;
  fecha_objetivo_depto: string | null;
  monto_objetivo_depto_usd: number | null;
  anios_transicion: number;
  inflacion_mensual_pct: number | null;
};

const CONFIG_DEFAULT: Omit<ConfigPlanRow, "usuario_id"> = {
  pct_gastos: 25,
  pct_largo_plazo: 65,
  pct_aprender: 10,
  emergencia_primero: true,
  meses_emergencia: 3,
  gasto_mensual_manual: null,
  minimo_compra_usd: 100,
  fecha_objetivo_depto: null,
  monto_objetivo_depto_usd: null,
  anios_transicion: 3,
  inflacion_mensual_pct: null,
};

export async function obtenerConfigPlan(
  supabase: SupabaseClient,
  usuarioId: string
): Promise<ConfigPlanRow> {
  const { data } = await supabase.from("config_plan").select("*").eq("usuario_id", usuarioId).single();
  return data ? (data as ConfigPlanRow) : { usuario_id: usuarioId, ...CONFIG_DEFAULT };
}

export type GastoMensual = { valor: number | null; fuente: "calculado" | "manual" };

export async function obtenerGastoMensualConFuente(
  supabase: SupabaseClient,
  usuarioId: string
): Promise<GastoMensual> {
  const config = await obtenerConfigPlan(supabase, usuarioId);
  const ahora = new Date();
  const desde = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - 3, 1));
  const finMesAnterior = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 0));

  const { data: movimientos } = await supabase
    .from("movimientos")
    .select("tipo, monto_ars, fecha")
    .eq("usuario_id", usuarioId)
    .eq("tipo", "gasto")
    .gte("fecha", desde.toISOString().slice(0, 10))
    .lte("fecha", finMesAnterior.toISOString().slice(0, 10));

  const calculado = calcularGastoMensual(movimientos ?? [], ahora);
  if (calculado !== null) return { valor: calculado, fuente: "calculado" };
  return { valor: config.gasto_mensual_manual, fuente: "manual" };
}

export async function obtenerUltimoMep(supabase: SupabaseClient): Promise<number | null> {
  const { data } = await supabase
    .from("tipo_cambio")
    .select("mep_venta")
    .not("mep_venta", "is", null)
    .order("fecha", { ascending: false })
    .limit(1);
  return data?.[0]?.mep_venta ? Number(data[0].mep_venta) : null;
}

export type RepartoRow = {
  id: string;
  monto_ars: number;
  tc_referencia: number;
  detalle: ResultadoReparto;
  estado: "pendiente" | "aplicado" | "descartado";
};

function configParaCalculo(config: ConfigPlanRow): ConfigReparto {
  return {
    pctGastos: Number(config.pct_gastos),
    pctLargoPlazo: Number(config.pct_largo_plazo),
    pctAprender: Number(config.pct_aprender),
    emergenciaPrimero: config.emergencia_primero,
    mesesEmergencia: Number(config.meses_emergencia),
    minimoCompraUsd: Number(config.minimo_compra_usd),
  };
}

export async function calcularRepartoParaUsuario(
  supabase: SupabaseClient,
  usuarioId: string,
  montoIngresoArs: number,
  tcReferencia?: number
): Promise<{ detalle: ResultadoReparto; tcReferencia: number } | null> {
  const [config, gastoMensual, tcGuardado, { data: bolsillos }] = await Promise.all([
    obtenerConfigPlan(supabase, usuarioId),
    obtenerGastoMensualConFuente(supabase, usuarioId),
    tcReferencia ? Promise.resolve(tcReferencia) : obtenerUltimoMep(supabase),
    supabase.from("bolsillos").select("clave, saldo").eq("usuario_id", usuarioId),
  ]);

  if (!tcGuardado || gastoMensual.valor === null) return null;
  const saldo = (clave: string) => Number(bolsillos?.find((bolsillo) => bolsillo.clave === clave)?.saldo ?? 0);
  const detalle = calcularReparto({
    montoIngresoArs,
    saldos: {
      gastos: saldo("gastos"),
      emergencia: saldo("emergencia"),
      porInvertir: saldo("por_invertir"),
    },
    gastoMensualArs: gastoMensual.valor,
    tcReferencia: tcGuardado,
    config: configParaCalculo(config),
  });

  return { detalle, tcReferencia: tcGuardado };
}

export async function generarRepartoParaIngreso(
  supabase: SupabaseClient,
  usuarioId: string,
  ingresoId: string | null,
  montoIngresoArs: number
): Promise<RepartoRow | null> {
  if (ingresoId) {
    const { data: existente } = await supabase
      .from("repartos")
      .select("id, monto_ars, tc_referencia, detalle, estado")
      .eq("ingreso_id", ingresoId)
      .maybeSingle();
    if (existente) return existente as RepartoRow;
  }

  const calculado = await calcularRepartoParaUsuario(supabase, usuarioId, montoIngresoArs);
  if (!calculado) return null;

  await supabase
    .from("bolsillos")
    .update({ meta: calculado.detalle.metaEmergenciaUsd })
    .eq("usuario_id", usuarioId)
    .eq("clave", "emergencia");

  const { data: reparto, error } = await supabase
    .from("repartos")
    .insert({
      usuario_id: usuarioId,
      ingreso_id: ingresoId,
      monto_ars: montoIngresoArs,
      tc_referencia: calculado.tcReferencia,
      detalle: calculado.detalle,
      estado: "pendiente",
    })
    .select("id, monto_ars, tc_referencia, detalle, estado")
    .single();

  if (error || !reparto) return null;
  return reparto as RepartoRow;
}

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
  if (detalle.largo_plazo > 0) partes.push(`VOO US$${detalle.largo_plazo.toFixed(2)}`);
  if (detalle.aprender > 0) partes.push(`Aprender US$${detalle.aprender.toFixed(2)}`);
  if (detalle.por_invertir > 0) partes.push(`Por invertir US$${detalle.por_invertir.toFixed(2)}`);
  return partes.join(" · ");
}

export async function aplicarRepartoUsuario(
  supabase: SupabaseClient,
  usuarioId: string,
  repartoId: string,
  tcUsado: number
) {
  if (!Number.isFinite(tcUsado) || tcUsado <= 0) throw new Error("tc_usado inválido");
  const { data: reparto } = await supabase
    .from("repartos")
    .select("id, monto_ars, estado")
    .eq("id", repartoId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (!reparto) throw new Error("No encontrado");
  if (reparto.estado !== "pendiente") throw new Error("Este reparto ya no está pendiente");

  const calculado = await calcularRepartoParaUsuario(supabase, usuarioId, Number(reparto.monto_ars), tcUsado);
  if (!calculado) throw new Error("No pude recalcular el reparto con esa cotización");
  const { error } = await supabase.rpc("aplicar_reparto", {
    p_usuario_id: usuarioId,
    p_reparto_id: reparto.id,
    p_tc_usado: tcUsado,
    p_detalle: calculado.detalle,
  });
  if (error) throw new Error(error.message);

  const [{ data: repartoActualizado }, { data: bolsillos }] = await Promise.all([
    supabase.from("repartos").select("*").eq("id", reparto.id).single(),
    supabase.from("bolsillos").select("id, clave, nombre, moneda, saldo, meta, orden").eq("usuario_id", usuarioId).order("orden"),
  ]);
  return { reparto: repartoActualizado, bolsillos: bolsillos ?? [] };
}

export async function descartarRepartoUsuario(
  supabase: SupabaseClient,
  usuarioId: string,
  repartoId: string
) {
  const { data: reparto } = await supabase
    .from("repartos")
    .select("id, estado")
    .eq("id", repartoId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (!reparto) throw new Error("No encontrado");
  if (reparto.estado !== "pendiente") throw new Error("Este reparto ya no está pendiente");
  const { error } = await supabase
    .from("repartos")
    .update({ estado: "descartado" })
    .eq("id", repartoId)
    .eq("usuario_id", usuarioId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
