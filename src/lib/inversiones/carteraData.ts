import type { SupabaseClient } from "@supabase/supabase-js";
import { compraBloqueadaPorTesis } from "./aprenderActivos";
import { calcularCartera, type TipoOperacion } from "./rendimiento";

export type EntradaOperacion = {
  activoId?: string;
  ticker?: string;
  tipo: TipoOperacion;
  fecha: string;
  cantidad?: number;
  precioUsd: number;
  montoUsd: number;
  comisionUsd?: number;
  nota?: string | null;
};

const numero = (valor: unknown) => Number(valor ?? 0);

export async function registrarOperacion(
  supabase: SupabaseClient,
  usuarioId: string,
  entrada: EntradaOperacion
) {
  if (!entrada.activoId && !entrada.ticker) throw new Error("Falta el activo");
  if (!["compra", "venta", "dividendo"].includes(entrada.tipo)) throw new Error("Tipo de operación inválido");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.fecha)) throw new Error("Fecha inválida");
  if (!Number.isFinite(entrada.montoUsd) || entrada.montoUsd <= 0) throw new Error("El monto debe ser mayor que cero");
  if (!Number.isFinite(entrada.precioUsd) || entrada.precioUsd < 0) throw new Error("El precio no puede ser negativo");

  let consulta = supabase
    .from("activos")
    .select("id, ticker, nombre, tipo, en_politica, bolsillo_clave, tesis")
    .eq("usuario_id", usuarioId)
    .eq("en_politica", true);
  consulta = entrada.activoId
    ? consulta.eq("id", entrada.activoId)
    : consulta.eq("ticker", entrada.ticker!.trim().toUpperCase());
  const { data: activo } = await consulta.maybeSingle();
  if (!activo) throw new Error("Ese activo no está en tu política de inversión");
  const bloqueo = compraBloqueadaPorTesis(activo, entrada.tipo);
  if (bloqueo) throw new Error(bloqueo);

  const cantidad = entrada.tipo === "dividendo"
    ? 0
    : numero(entrada.cantidad) > 0
      ? numero(entrada.cantidad)
      : entrada.precioUsd > 0
        ? entrada.montoUsd / entrada.precioUsd
        : 0;
  if (entrada.tipo !== "dividendo" && cantidad <= 0) throw new Error("No pude calcular la cantidad");

  const { data, error } = await supabase.rpc("registrar_operacion_cartera", {
    p_usuario_id: usuarioId,
    p_activo_id: activo.id,
    p_tipo: entrada.tipo,
    p_fecha: entrada.fecha,
    p_cantidad: cantidad,
    p_precio_usd: entrada.precioUsd,
    p_monto_usd: entrada.montoUsd,
    p_comision_usd: numero(entrada.comisionUsd),
    p_nota: entrada.nota?.trim() || null,
  });
  if (error) throw new Error(error.message);

  const resultado = Array.isArray(data) ? data[0] : data;
  const saldoResultante = numero(resultado?.saldo_resultante);
  return {
    id: resultado?.operacion_id,
    activo,
    cantidad: Math.round(cantidad * 1_000_000) / 1_000_000,
    bolsilloClave: resultado?.bolsillo_clave,
    saldoResultante,
    avisoSaldoNegativo: saldoResultante < 0
      ? `El bolsillo ${resultado?.bolsillo_clave} quedó en US$${saldoResultante.toFixed(2)}. Podés ajustarlo con tu saldo real de ARQ.`
      : null,
  };
}

export async function obtenerCartera(supabase: SupabaseClient, usuarioId: string) {
  const [{ data: activos }, { data: operaciones }, { data: bolsillos }, { data: config }, { data: cotizaciones }] =
    await Promise.all([
      supabase
        .from("activos")
        .select("id, ticker, nombre, tipo, moneda, bolsillo_clave, tasa_anual, en_politica, tesis, toma_ganancia_pct, stop_revision_pct")
        .eq("usuario_id", usuarioId)
        .eq("en_politica", true)
        .order("ticker"),
      supabase
        .from("operaciones")
        .select("activo_id, tipo, fecha, cantidad, precio_usd, monto_usd, comision_usd")
        .eq("usuario_id", usuarioId)
        .order("fecha"),
      supabase.from("bolsillos").select("clave, saldo").eq("usuario_id", usuarioId),
      supabase.from("config_plan").select("inflacion_mensual_pct").eq("usuario_id", usuarioId).maybeSingle(),
      supabase.from("tipo_cambio").select("mep_venta").not("mep_venta", "is", null).order("fecha", { ascending: false }).limit(1),
    ]);

  const tickers = (activos ?? []).filter((activo) => activo.tipo !== "cuenta_remunerada").map((activo) => activo.ticker);
  const { data: precios } = tickers.length > 0
    ? await supabase.from("precios").select("ticker, fecha, cierre_usd, max_52s").in("ticker", tickers).order("fecha")
    : { data: [] };
  const tcReferencia = numero(cotizaciones?.[0]?.mep_venta);

  const resultado = calcularCartera({
    activos: (activos ?? []).map((activo) => ({ ...activo, tasa_anual: activo.tasa_anual === null ? null : numero(activo.tasa_anual) })),
    operaciones: (operaciones ?? []).map((operacion) => ({
      ...operacion,
      cantidad: numero(operacion.cantidad),
      precio_usd: numero(operacion.precio_usd),
      monto_usd: numero(operacion.monto_usd),
      comision_usd: numero(operacion.comision_usd),
    })),
    precios: (precios ?? []).map((precio) => ({ ...precio, cierre_usd: numero(precio.cierre_usd), max_52s: precio.max_52s === null ? null : numero(precio.max_52s) })),
    bolsillos: (bolsillos ?? []).map((bolsillo) => ({ ...bolsillo, saldo: numero(bolsillo.saldo) })),
    inflacionMensualPct: config?.inflacion_mensual_pct === null || config?.inflacion_mensual_pct === undefined
      ? null
      : numero(config.inflacion_mensual_pct),
    tcReferencia: tcReferencia > 0 ? tcReferencia : 1,
    hoy: new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }),
  });

  return { ...resultado, activosDisponibles: activos ?? [], tcReferencia: tcReferencia || null };
}
