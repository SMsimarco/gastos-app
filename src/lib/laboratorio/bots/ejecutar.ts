import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaNuevaYork, leerContextoLab, minutosNuevaYork, type ContextoLab } from "../config";
import { gastoDelMes, registrarCostoIa } from "../costos";
import { obtenerReloj, obtenerSnapshots } from "../fuentes/alpaca";
import { esperar, mensajeDeError } from "../fuentes/http";
import { llamarGeminiJson } from "../gemini";
import { costoLlamadaUsd, evaluarPresupuesto } from "../presupuesto";
import { enviarOrdenPaper, obtenerCuentaPaper, obtenerOrdenPaper, obtenerPosicionesPaper, type CuentaBot, type PosicionPaper } from "./alpacaPaper";
import { armarBriefing } from "./briefing";
import { leerDatosCompletos, leerIndicadoresUniverso } from "./datos";
import { construirPromptDecision, DECISION_SCHEMA, normalizarDecision } from "./decidir";
import { aplicarRiesgo, type DecisionRiesgo, type EstadoRiesgo, type LimitesRiesgo } from "./riesgo";

export type FilaBot = {
  id: string;
  usuario_id: string;
  clave: "A" | "B" | "C";
  nombre: string;
  perfil_info: "completo" | "solo_precios";
  reactivo: boolean;
  alpaca_cuenta: CuentaBot;
  estrategia_prompt: string;
  pausado: boolean;
};

export type FilaConfig = {
  usuario_id: string;
  activo: boolean;
  fecha_inicio: string | null;
  capital_inicial_usd: number;
  universo: string[];
  max_pct_por_posicion: number;
  min_pct_efectivo: number;
  max_operaciones_por_dia: number;
  drawdown_pausa_pct: number;
  voo_precio_inicio: number | null;
  voo_cantidad: number | null;
};

export type OpcionesDecision = {
  disparador: "diaria" | "evento";
  evento?: { id: string | null; tipo: string; ticker: string | null; detalle: Record<string, unknown> } | null;
  // Solo para pruebas: arma briefing, llama a la IA y aplica el riesgo, pero NO envía órdenes ni toca el benchmark.
  simular?: boolean;
  // Ignora la ventana horaria de la decisión diaria (el mercado igual tiene que estar abierto).
  ignorarVentana?: boolean;
  clave?: "A" | "B" | "C";
};

// La decisión diaria corre una hora después de la apertura (10:30 en Nueva York); la ventana cubre los
// reintentos del cron y sigue el cambio de horario de EE.UU.
const VENTANA_DIARIA_NY = { desde: 10 * 60 + 15, hasta: 12 * 60 + 30 };
const ESTADOS_FINALES = new Set(["filled", "canceled", "rejected", "expired", "done_for_day"]);

function limitesDe(config: FilaConfig): LimitesRiesgo {
  return {
    universo: config.universo,
    maxPctPorPosicion: Number(config.max_pct_por_posicion),
    minPctEfectivo: Number(config.min_pct_efectivo),
    maxOperacionesPorDia: Number(config.max_operaciones_por_dia),
    drawdownPausaPct: Number(config.drawdown_pausa_pct),
  };
}

export type ResultadoBot = {
  clave: string;
  estado: string;
  aprobadas?: number;
  ordenes?: number;
  costoUsd?: number;
  pausado?: string | null;
  error?: string;
};

// --- Órdenes ---

export async function enviarOrdenes(cuenta: CuentaBot, decisiones: DecisionRiesgo[], posiciones: PosicionPaper[], esperaMs = 1_200) {
  const resultados = new Map<DecisionRiesgo, { id: string | null; estado: string; precio: number | null; cantidad: number | null }>();
  // Ventas primero, por prolijidad; las compras no dependen de su efectivo (lo garantiza el gestor de riesgo).
  const aEjecutar = decisiones.filter((decision) => decision.aprobada && decision.accion !== "mantener").sort((a, b) => (a.accion === "vender" ? -1 : 1) - (b.accion === "vender" ? -1 : 1));
  for (const decision of aEjecutar) {
    try {
      const posicion = posiciones.find((item) => item.ticker === decision.ticker);
      let orden = await enviarOrdenPaper(cuenta, {
        ticker: decision.ticker,
        lado: decision.accion === "comprar" ? "buy" : "sell",
        ...(decision.ventaTotal && posicion ? { cantidad: posicion.cantidad } : { monto: decision.montoAprobadoUsd }),
      });
      // Una orden a mercado suele ejecutarse enseguida; si no, el cierre del día la concilia.
      for (let intento = 0; intento < 3 && !ESTADOS_FINALES.has(orden.estado); intento++) {
        await esperar(esperaMs);
        orden = await obtenerOrdenPaper(cuenta, orden.id);
      }
      resultados.set(decision, { id: orden.id, estado: orden.estado, precio: orden.precioPromedio, cantidad: orden.cantidadEjecutada });
    } catch (error) {
      resultados.set(decision, { id: null, estado: `error: ${mensajeDeError(error).slice(0, 200)}`, precio: null, cantidad: null });
    }
  }
  return resultados;
}

// --- Una corrida de un bot ---

async function correrBot(supabase: SupabaseClient, contexto: ContextoLab, config: FilaConfig, bot: FilaBot, opciones: OpcionesDecision): Promise<ResultadoBot> {
  const ahora = new Date();
  const hoy = fechaNuevaYork(ahora);
  const simular = Boolean(opciones.simular);

  // Idempotencia: una sola decisión diaria por bot y por día (los reintentos del cron la saltean).
  if (opciones.disparador === "diaria" && !simular) {
    const { data: ultima } = await supabase.from("lab_corridas").select("ts, estado").eq("usuario_id", bot.usuario_id).eq("bot_id", bot.id).eq("disparador", "diaria").neq("estado", "simulada").order("ts", { ascending: false }).limit(1);
    const previa = ultima?.[0];
    if (previa && fechaNuevaYork(new Date(previa.ts as string)) === hoy && ["ok", "sin_cambios", "sin_presupuesto"].includes(previa.estado as string)) {
      return { clave: bot.clave, estado: "ya_corrio_hoy" };
    }
  }

  const registrarCorrida = async (campos: { estado: string; briefing?: unknown; respuesta?: unknown; modelo?: string; tokensEntrada?: number; tokensSalida?: number; costoUsd?: number; error?: string }) => {
    const { data, error } = await supabase
      .from("lab_corridas")
      .insert({
        bot_id: bot.id,
        usuario_id: bot.usuario_id,
        disparador: opciones.disparador,
        evento_id: opciones.evento?.id ?? null,
        briefing: campos.briefing ?? {},
        respuesta_ia: campos.respuesta ?? null,
        modelo: campos.modelo ?? null,
        tokens_entrada: campos.tokensEntrada ?? 0,
        tokens_salida: campos.tokensSalida ?? 0,
        costo_usd: campos.costoUsd ?? 0,
        estado: campos.estado,
        error: campos.error ?? null,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No pude registrar la corrida: ${error?.message}`);
    return data.id as string;
  };

  // 1) Estado real de la cuenta paper del bot.
  let cuenta: Awaited<ReturnType<typeof obtenerCuentaPaper>>;
  let posiciones: PosicionPaper[];
  try {
    [cuenta, posiciones] = await Promise.all([obtenerCuentaPaper(bot.alpaca_cuenta), obtenerPosicionesPaper(bot.alpaca_cuenta)]);
    if (cuenta.bloqueada || cuenta.estado !== "ACTIVE") throw new Error(`La cuenta paper ${bot.alpaca_cuenta} está ${cuenta.estado}${cuenta.bloqueada ? " y bloqueada" : ""}`);
  } catch (error) {
    await registrarCorrida({ estado: "error", error: mensajeDeError(error) });
    return { clave: bot.clave, estado: "error", error: mensajeDeError(error) };
  }

  // 2) Datos para el briefing (el perfil solo_precios nunca lee noticias, macro ni memoria).
  const indicadores = await leerIndicadoresUniverso(supabase, config.universo);
  const completos = bot.perfil_info === "completo" ? await leerDatosCompletos(supabase, config.universo, hoy) : undefined;
  const [{ data: decisionesHoy }, { data: snapshots }] = await Promise.all([
    supabase.from("lab_decisiones").select("created_at, orden_alpaca_id").eq("usuario_id", bot.usuario_id).eq("bot_id", bot.id).not("orden_alpaca_id", "is", null).gte("created_at", new Date(ahora.getTime() - 30 * 3_600_000).toISOString()),
    supabase.from("lab_snapshots").select("valor_usd").eq("usuario_id", bot.usuario_id).eq("bot_id", bot.id).order("valor_usd", { ascending: false }).limit(1),
  ]);
  const operacionesHoy = (decisionesHoy ?? []).filter((fila) => fechaNuevaYork(new Date(fila.created_at as string)) === hoy).length;
  const capital = Number(config.capital_inicial_usd);
  const pico = Math.max(capital, Number(snapshots?.[0]?.valor_usd ?? 0), cuenta.equity);
  const diasDesdeInicio = config.fecha_inicio ? Math.max(0, Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${config.fecha_inicio}T00:00:00Z`)) / 86_400_000)) : null;
  const horaNy = `${String(Math.floor(minutosNuevaYork(ahora) / 60)).padStart(2, "0")}:${String(minutosNuevaYork(ahora) % 60).padStart(2, "0")}`;

  const { briefing, recortes } = armarBriefing(bot.perfil_info, {
    fecha: hoy,
    horaNuevaYork: horaNy,
    disparador: opciones.disparador,
    evento: opciones.evento ? { tipo: opciones.evento.tipo, ticker: opciones.evento.ticker, detalle: opciones.evento.detalle } : null,
    portafolio: {
      valorTotalUsd: cuenta.equity,
      efectivoUsd: cuenta.efectivo,
      capitalInicialUsd: capital,
      posiciones: posiciones.map((posicion) => ({ ticker: posicion.ticker, cantidad: posicion.cantidad, valorUsd: posicion.valorMercado, costoPromedio: posicion.costoPromedio, pnlPct: posicion.pnlPct })),
      operacionesHoy,
      diasDesdeInicio,
    },
    limites: { maxPctPorPosicion: Number(config.max_pct_por_posicion), minPctEfectivo: Number(config.min_pct_efectivo), maxOperacionesPorDia: Number(config.max_operaciones_por_dia) },
    indicadores,
    completos,
  });
  const briefingGuardado = { ...briefing, recortes_por_tamano: recortes };

  // 3) Presupuesto de IA: con el tope alcanzado el bot no llama a la IA.
  const prompt = construirPromptDecision(briefing, bot.estrategia_prompt);
  const estimado = costoLlamadaUsd(contexto.modeloDecision, Math.ceil(prompt.length / 3), 2_000);
  const presupuesto = evaluarPresupuesto({ gastadoMesUsd: await gastoDelMes(supabase), topeUsd: contexto.topeIaUsd, costoEstimadoUsd: estimado });
  if (!presupuesto.permitido) {
    await registrarCorrida({ estado: "sin_presupuesto", briefing: briefingGuardado });
    return { clave: bot.clave, estado: "sin_presupuesto" };
  }

  // 4) La IA decide. Si falla no se opera ese día (no se cambia de modelo: los tres bots usan el mismo).
  let respuesta: Awaited<ReturnType<typeof llamarGeminiJson<unknown>>>;
  try {
    respuesta = await llamarGeminiJson<unknown>(contexto.modeloDecision, prompt, DECISION_SCHEMA);
  } catch (error) {
    await registrarCorrida({ estado: "error", briefing: briefingGuardado, modelo: contexto.modeloDecision, error: mensajeDeError(error) });
    return { clave: bot.clave, estado: "error", error: mensajeDeError(error) };
  }
  const costoUsd = await registrarCostoIa(supabase, { tipo: "decision_bot", modelo: contexto.modeloDecision, tokensEntrada: respuesta.tokensEntrada, tokensSalida: respuesta.tokensSalida, detalle: { bot: bot.clave, disparador: opciones.disparador } });
  const decision = normalizarDecision(respuesta.data);
  const datosCorrida = { modelo: contexto.modeloDecision, tokensEntrada: respuesta.tokensEntrada, tokensSalida: respuesta.tokensSalida, costoUsd };
  if (!decision) {
    await registrarCorrida({ estado: "error", briefing: briefingGuardado, respuesta: respuesta.data, ...datosCorrida, error: "La IA devolvió una respuesta que no cumple el formato" });
    return { clave: bot.clave, estado: "error", costoUsd, error: "Respuesta inválida de la IA" };
  }

  // 5) El gestor de riesgo valida; recién después se ejecuta.
  const estadoRiesgo: EstadoRiesgo = {
    valorTotalUsd: cuenta.equity,
    efectivoUsd: cuenta.efectivo,
    posiciones: posiciones.map((posicion) => ({ ticker: posicion.ticker, valorUsd: posicion.valorMercado })),
    operacionesHoy,
    picoUsd: pico,
  };
  const { decisiones, pausar } = aplicarRiesgo(decision.propuestas, estadoRiesgo, limitesDe(config));
  const ordenes = simular ? new Map() : await enviarOrdenes(bot.alpaca_cuenta, decisiones, posiciones);
  const aprobadas = decisiones.filter((item) => item.aprobada && item.accion !== "mantener");

  const corridaId = await registrarCorrida({
    estado: simular ? "simulada" : aprobadas.length > 0 ? "ok" : "sin_cambios",
    briefing: briefingGuardado,
    respuesta: { resumen_mercado: decision.resumenMercado, propuestas: decision.propuestas, descartadas_por_exceso: decision.descartadasPorExceso },
    ...datosCorrida,
  });
  if (decisiones.length > 0) {
    const { error } = await supabase.from("lab_decisiones").insert(
      decisiones.map((item) => {
        const orden = ordenes.get(item);
        return {
          corrida_id: corridaId,
          bot_id: bot.id,
          usuario_id: bot.usuario_id,
          ticker: item.ticker,
          accion: item.accion,
          monto_propuesto_usd: item.montoPropuestoUsd,
          monto_aprobado_usd: item.montoAprobadoUsd,
          razon_ia: item.razon,
          confianza: item.confianza,
          ajuste_riesgo: item.ajuste,
          orden_alpaca_id: orden?.id ?? null,
          estado_orden: simular ? (item.aprobada && item.accion !== "mantener" ? "simulada" : "sin_orden") : orden ? orden.estado : item.aprobada ? "sin_orden" : "descartada",
          precio_ejecucion: orden?.precio ?? null,
          cantidad_ejecutada: orden?.cantidad ?? null,
        };
      })
    );
    if (error) throw new Error(`No pude registrar las decisiones: ${error.message}`);
  }

  // 6) Drawdown: el bot queda pausado y el motivo a la vista.
  if (pausar && !simular) {
    await supabase.from("lab_bots").update({ pausado: true, motivo_pausa: pausar.motivo }).eq("id", bot.id).eq("usuario_id", bot.usuario_id);
  }
  return { clave: bot.clave, estado: simular ? "simulada" : aprobadas.length > 0 ? "ok" : "sin_cambios", aprobadas: aprobadas.length, ordenes: ordenes.size, costoUsd, pausado: pausar?.motivo ?? null };
}

// --- Todas las corridas ---

export async function ejecutarDecisiones(supabase: SupabaseClient, opciones: OpcionesDecision) {
  const simular = Boolean(opciones.simular);
  const ahora = new Date();

  if (!simular) {
    const reloj = await obtenerReloj();
    if (!reloj.abierto) return { omitido: "mercado_cerrado", proximaApertura: reloj.proximaApertura };
    if (opciones.disparador === "diaria" && !opciones.ignorarVentana) {
      const minutos = minutosNuevaYork(ahora);
      if (minutos < VENTANA_DIARIA_NY.desde || minutos > VENTANA_DIARIA_NY.hasta) return { omitido: "fuera_de_la_ventana_horaria", minutosNuevaYork: minutos };
    }
  }

  const contexto = await leerContextoLab(supabase);
  const { data: configs } = await supabase
    .from("lab_config")
    .select("usuario_id, activo, fecha_inicio, capital_inicial_usd, universo, max_pct_por_posicion, min_pct_efectivo, max_operaciones_por_dia, drawdown_pausa_pct, voo_precio_inicio, voo_cantidad")
    .eq("activo", true);
  const activas = (configs ?? []) as FilaConfig[];
  if (!simular && activas.length === 0) return { omitido: "laboratorio_inactivo" };
  // En simulación se usa cualquier configuración existente aunque el laboratorio no esté activado.
  const lista = simular && activas.length === 0
    ? ((await supabase.from("lab_config").select("usuario_id, activo, fecha_inicio, capital_inicial_usd, universo, max_pct_por_posicion, min_pct_efectivo, max_operaciones_por_dia, drawdown_pausa_pct, voo_precio_inicio, voo_cantidad").limit(1)).data ?? []) as FilaConfig[]
    : activas;

  const resultados: ResultadoBot[] = [];
  for (const config of lista) {
    // Benchmark: el "VOO" virtual se compra la primera vez que corre una decisión.
    if (!simular && !config.voo_precio_inicio) {
      const [voo] = await obtenerSnapshots(["VOO"]);
      if (voo) {
        const cantidad = Number(config.capital_inicial_usd) / voo.precio;
        await supabase.from("lab_config").update({ voo_precio_inicio: voo.precio, voo_cantidad: cantidad, inicio_real: ahora.toISOString() }).eq("usuario_id", config.usuario_id);
      }
    }
    let consulta = supabase.from("lab_bots").select("id, usuario_id, clave, nombre, perfil_info, reactivo, alpaca_cuenta, estrategia_prompt, pausado").eq("usuario_id", config.usuario_id);
    if (!simular) consulta = consulta.eq("pausado", false);
    if (opciones.disparador === "evento") consulta = consulta.eq("reactivo", true);
    if (opciones.clave) consulta = consulta.eq("clave", opciones.clave);
    const { data: bots } = await consulta;
    const corridas = await Promise.allSettled(((bots ?? []) as FilaBot[]).map((bot) => correrBot(supabase, contexto, config, bot, opciones)));
    for (const [indice, corrida] of corridas.entries()) {
      const bot = ((bots ?? []) as FilaBot[])[indice];
      resultados.push(corrida.status === "fulfilled" ? corrida.value : { clave: bot.clave, estado: "error", error: mensajeDeError(corrida.reason) });
    }
  }
  return { simulada: simular, disparador: opciones.disparador, bots: resultados };
}

