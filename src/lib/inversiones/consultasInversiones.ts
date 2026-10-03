import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsultaFinancieraExtraida } from "@/lib/gemini";
import { redactarRespuestaDesdeHechos } from "@/lib/gemini";
import { obtenerConfigPlan, obtenerGastoMensualConFuente } from "@/lib/planData";
import { obtenerCartera } from "./carteraData";
import { generarSugerencias, type EstadoInversiones } from "./sugerencias";

export type TipoConsultaInversion = "consulta_inversiones" | "consulta_plan" | "pedir_sugerencia";

const numero = (valor: unknown) => Number(valor ?? 0);
const usd = (valor: number) => valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ars = (valor: number) => Math.round(valor).toLocaleString("es-AR");

export async function obtenerContextoInversiones(supabase: SupabaseClient, usuarioId: string) {
  const [cartera, config, gastoMensual, { data: bolsillos }, { data: repartoPendiente }] = await Promise.all([
    obtenerCartera(supabase, usuarioId), obtenerConfigPlan(supabase, usuarioId), obtenerGastoMensualConFuente(supabase, usuarioId),
    supabase.from("bolsillos").select("clave, nombre, moneda, saldo, meta").eq("usuario_id", usuarioId),
    supabase.from("repartos").select("id, monto_ars, tc_referencia, detalle, created_at").eq("usuario_id", usuarioId).eq("estado", "pendiente").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const activosPolitica = cartera.activosDisponibles;
  const tickers = activosPolitica.filter((activo) => activo.tipo !== "cuenta_remunerada").map((activo) => activo.ticker);
  const { data: precios } = tickers.length
    ? await supabase.from("precios").select("ticker, fecha, cierre_usd, max_52s").in("ticker", tickers).order("fecha", { ascending: false })
    : { data: [] };
  const ultimoPrecio = new Map<string, { cierre_usd: number; max_52s: number | null }>();
  for (const precio of precios ?? []) {
    if (!ultimoPrecio.has(precio.ticker)) ultimoPrecio.set(precio.ticker, {
      cierre_usd: numero(precio.cierre_usd), max_52s: precio.max_52s === null ? null : numero(precio.max_52s),
    });
  }
  const bolsillo = (clave: string) => bolsillos?.find((item) => item.clave === clave);
  const emergencia = bolsillo("emergencia");
  const porInvertir = bolsillo("por_invertir");
  const aprender = bolsillo("aprender");
  const metaCalculada = gastoMensual.valor !== null && cartera.tcReferencia
    ? (numero(config.meses_emergencia) * gastoMensual.valor) / cartera.tcReferencia : 0;
  const metaEmergenciaUsd = numero(emergencia?.meta) || metaCalculada;
  const activosEstado = activosPolitica.filter((activo) => activo.tipo !== "cuenta_remunerada").map((activo) => {
    const rendimiento = cartera.activos.find((item) => item.id === activo.id);
    const precio = ultimoPrecio.get(activo.ticker);
    return {
      ticker: activo.ticker, bolsilloClave: activo.bolsillo_clave, gananciaPct: numero(rendimiento?.gananciaPct),
      precioActualUsd: rendimiento?.precioActualUsd ?? precio?.cierre_usd ?? null, max52sUsd: precio?.max_52s ?? null,
      tomaGananciaPct: activo.toma_ganancia_pct === null ? null : numero(activo.toma_ganancia_pct),
      stopRevisionPct: activo.stop_revision_pct === null ? null : numero(activo.stop_revision_pct),
    };
  });
  const idsAprender = new Set(activosPolitica.filter((activo) => activo.bolsillo_clave === "aprender").map((activo) => activo.id));
  const valorAprenderUsd = cartera.activos.filter((activo) => idsAprender.has(activo.id)).reduce((total, activo) => total + activo.valorActualUsd, numero(aprender?.saldo));
  const estado: EstadoInversiones = {
    hoy: new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }),
    emergencia: { saldoUsd: numero(emergencia?.saldo), metaUsd: metaEmergenciaUsd }, porInvertirUsd: numero(porInvertir?.saldo),
    minimoCompraUsd: numero(config.minimo_compra_usd), activos: activosEstado, fechaObjetivoDepto: config.fecha_objetivo_depto,
    aniosTransicion: numero(config.anios_transicion), valorAprenderUsd,
    valorTotalCarteraUsd: cartera.total.valorUsd + numero(aprender?.saldo) + numero(porInvertir?.saldo),
    pctAprenderObjetivo: numero(config.pct_aprender),
  };
  return { cartera, config, gastoMensual, bolsillos: bolsillos ?? [], repartoPendiente, activosPolitica, emergencia, metaEmergenciaUsd, estado };
}

export async function responderConsultaInversiones(
  supabase: SupabaseClient,
  usuarioId: string,
  tipo: TipoConsultaInversion,
  consulta: ConsultaFinancieraExtraida
): Promise<string> {
  const { cartera, config, gastoMensual, bolsillos, repartoPendiente, activosPolitica, emergencia, metaEmergenciaUsd, estado } =
    await obtenerContextoInversiones(supabase, usuarioId);

  const tickerConsultado = consulta.ticker?.toUpperCase() ?? null;
  const activoConsultado = tickerConsultado
    ? activosPolitica.find((activo) => activo.ticker === tickerConsultado) ?? null
    : null;
  const fueraDePolitica = Boolean(tickerConsultado && !activoConsultado);
  const rendimientoConsultado = activoConsultado
    ? cartera.activos.find((activo) => activo.id === activoConsultado.id)
      ?? cartera.cuentas.find((activo) => activo.id === activoConsultado.id)
      ?? null
    : null;

  const sugerencias = tipo === "pedir_sugerencia" && !fueraDePolitica ? generarSugerencias(estado) : [];
  let respuestaBase: string;
  if (fueraDePolitica) {
    respuestaBase = `${tickerConsultado} no está en los activos de tu plan, así que no puedo sugerirte comprarlo ni desaconsejarlo como inversión.`;
  } else if (tipo === "pedir_sugerencia") {
    respuestaBase = sugerencias.length > 0
      ? sugerencias.map((sugerencia) => sugerencia.mensaje).join("\n")
      : "No hay una acción pendiente según las reglas de tu plan.";
  } else if (tipo === "consulta_inversiones" && rendimientoConsultado) {
    respuestaBase = "gananciaPct" in rendimientoConsultado
      ? `${activoConsultado!.ticker}: tenés ${rendimientoConsultado.cantidad} unidades, invertiste US$${usd(rendimientoConsultado.invertidoUsd)}, hoy valen US$${usd(rendimientoConsultado.valorActualUsd)} y la ganancia es US$${usd(rendimientoConsultado.gananciaUsd)} (${rendimientoConsultado.gananciaPct.toFixed(2)}%).`
      : `${activoConsultado!.ticker}: el saldo es ${rendimientoConsultado.moneda === "ARS" ? "$" : "US$"}${rendimientoConsultado.moneda === "ARS" ? ars(rendimientoConsultado.saldo) : usd(rendimientoConsultado.saldo)} y el rendimiento estimado del mes es ${rendimientoConsultado.moneda === "ARS" ? "$" : "US$"}${rendimientoConsultado.moneda === "ARS" ? ars(rendimientoConsultado.rendimientoMes) : usd(rendimientoConsultado.rendimientoMes)}.`;
  } else if (tipo === "consulta_inversiones") {
    respuestaBase = `Tu cartera vale US$${usd(cartera.total.valorUsd)}. El total invertido es US$${usd(cartera.total.invertidoUsd)} y la ganancia acumulada es US$${usd(cartera.total.gananciaUsd)} (${cartera.total.gananciaPct.toFixed(2)}%).`;
  } else if (/emergencia/i.test(consulta.pregunta)) {
    const faltante = Math.max(0, metaEmergenciaUsd - numero(emergencia?.saldo));
    respuestaBase = faltante > 0
      ? `Al fondo de emergencia le faltan US$${usd(faltante)} para llegar a la meta de US$${usd(metaEmergenciaUsd)}.`
      : `El fondo de emergencia alcanzó la meta de US$${usd(metaEmergenciaUsd)}.`;
  } else if (/depto|departamento/i.test(consulta.pregunta)) {
    respuestaBase = config.fecha_objetivo_depto || config.monto_objetivo_depto_usd
      ? `Tu objetivo de departamento tiene fecha ${config.fecha_objetivo_depto ?? "sin fecha cargada"} y monto US$${config.monto_objetivo_depto_usd === null ? "sin monto cargado" : usd(numero(config.monto_objetivo_depto_usd))}.`
      : "Todavía no configuraste una fecha ni un monto objetivo para el departamento.";
  } else {
    respuestaBase = bolsillos.map((item) => `${item.nombre}: ${item.moneda === "ARS" ? "$" : "US$"}${item.moneda === "ARS" ? ars(numero(item.saldo)) : usd(numero(item.saldo))}`).join(" · ");
  }

  const hechos: Record<string, unknown> = fueraDePolitica ? {
    ticker_consultado: tickerConsultado,
    fuera_de_politica: true,
    motivo: "El ticker consultado no está en activos.en_politica del usuario.",
    activos_en_politica: activosPolitica.map((activo) => activo.ticker),
  } : {
    fecha: estado.hoy,
    ticker_consultado: tickerConsultado,
    fuera_de_politica: fueraDePolitica,
    activos_en_politica: activosPolitica.map((activo) => activo.ticker),
    activo_consultado: activoConsultado ? {
      ticker: activoConsultado.ticker,
      nombre: activoConsultado.nombre,
      tipo: activoConsultado.tipo,
      rendimiento: rendimientoConsultado,
    } : null,
    cartera: {
      total: cartera.total,
      benchmark: cartera.benchmark,
      activos: cartera.activos,
      cuentas_remuneradas: cartera.cuentas,
    },
    plan: {
      bolsillos: bolsillos.map((item) => ({ ...item, saldo: numero(item.saldo), meta: item.meta === null ? null : numero(item.meta) })),
      meta_emergencia_usd: metaEmergenciaUsd,
      gasto_mensual_ars: gastoMensual.valor,
      gasto_mensual_fuente: gastoMensual.fuente,
      minimo_compra_usd: numero(config.minimo_compra_usd),
      fecha_objetivo_depto: config.fecha_objetivo_depto,
      monto_objetivo_depto_usd: config.monto_objetivo_depto_usd,
      anios_transicion: numero(config.anios_transicion),
      porcentaje_aprender: numero(config.pct_aprender),
      reparto_pendiente: repartoPendiente,
    },
    sugerencias,
    respuesta_base: respuestaBase,
  };

  return redactarRespuestaDesdeHechos({
    pregunta: consulta.pregunta,
    hechos,
    esSugerencia: tipo === "pedir_sugerencia",
    respuestaBase,
  });
}
