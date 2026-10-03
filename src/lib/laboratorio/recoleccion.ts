import type { SupabaseClient } from "@supabase/supabase-js";
import { ETFS_UNIVERSO, fechaNuevaYork, leerContextoLab } from "./config";
import { obtenerBarrasDiarias, obtenerReloj, obtenerSnapshots } from "./fuentes/alpaca";
import { reunionesFedEntre } from "./fuentes/fed";
import { obtenerBalancesProgramados } from "./fuentes/finnhub";
import { obtenerSerieFred, SERIES_MACRO } from "./fuentes/fred";
import { mensajeDeError } from "./fuentes/http";
import { calcularIndicadores } from "./indicadores";
import { CONFIG_MONITOR_DEFAULT, detectarEventos } from "./monitor";
import { recolectarNoticias, resumirNoticiasPendientes } from "./noticias";

export type TareaLab = "monitor" | "noticias" | "macro";

// Cada corrida deja registro (también si falla): nunca se reintenta en loop, y el panel puede
// avisar qué fuente no respondió.
export async function registrarEjecucion(
  supabase: SupabaseClient,
  tarea: TareaLab,
  ok: boolean,
  detalle: Record<string, unknown>,
  error?: string
) {
  await supabase.from("lab_ejecuciones").insert({ tarea, ok, detalle, error: error ?? null });
}

const HORAS = 3_600_000;

// --- Monitor (cada 15 min, solo con el mercado abierto) ---

export async function ejecutarMonitor(supabase: SupabaseClient) {
  const reloj = await obtenerReloj();
  // El reloj de Alpaca decide: cubre fines de semana, feriados y medias ruedas.
  if (!reloj.abierto) return { omitido: "mercado_cerrado", proximaApertura: reloj.proximaApertura };

  const contexto = await leerContextoLab(supabase);
  const ahora = new Date(reloj.ahora);
  const fechaMercado = fechaNuevaYork(ahora);

  const snapshots = await obtenerSnapshots(contexto.universo);
  if (snapshots.length > 0) {
    const { error } = await supabase.from("lab_precios").upsert(
      snapshots.map((snap) => ({
        ticker: snap.ticker,
        ts: snap.ts,
        precio: snap.precio,
        volumen: snap.volumenDia,
        tipo: "intradia",
      })),
      { onConflict: "ticker,ts,tipo" }
    );
    if (error) throw new Error(`No pude guardar los precios: ${error.message}`);
  }

  const precios: Record<string, number> = {};
  const referencias: Record<string, number> = {};
  for (const snap of snapshots) {
    precios[snap.ticker] = snap.precio;
    // Mientras no haya bots, la referencia es el cierre anterior; en la parte B será el precio de la última decisión.
    if (snap.cierreAnterior) referencias[snap.ticker] = snap.cierreAnterior;
  }

  const [vixFilas, noticias, balancesHoy, claves, disparos] = await Promise.all([
    supabase.from("lab_macro").select("fecha, valor").eq("serie", "VIXCLS").order("fecha", { ascending: false }).limit(2),
    supabase
      .from("lab_noticias")
      .select("id, titular, ticker, tickers, relevancia")
      .eq("procesada", true)
      .gte("publicado_at", new Date(ahora.getTime() - 2 * HORAS).toISOString())
      .gte("relevancia", CONFIG_MONITOR_DEFAULT.umbralRelevancia),
    supabase.from("lab_eventos_calendario").select("ticker").eq("tipo", "balance").eq("fecha", fechaMercado),
    supabase.from("lab_eventos_mercado").select("clave").gte("ts", new Date(ahora.getTime() - 48 * HORAS).toISOString()),
    supabase
      .from("lab_eventos_mercado")
      .select("ts")
      .eq("disparo_decision", true)
      // La rueda dura menos de 7 horas: 10 horas atrás equivale a "hoy" mientras el mercado está abierto.
      .gte("ts", new Date(ahora.getTime() - 10 * HORAS).toISOString())
      .order("ts", { ascending: false }),
  ]);

  const vix =
    vixFilas.data && vixFilas.data.length === 2
      ? { actual: Number(vixFilas.data[0].valor), anterior: Number(vixFilas.data[1].valor), fecha: vixFilas.data[0].fecha as string }
      : null;

  const eventos = detectarEventos({
    ahora,
    fechaMercado,
    universo: contexto.universo,
    precios,
    referencias,
    vix,
    noticiasNuevas: (noticias.data ?? []).map((noticia) => ({
      id: noticia.id as string,
      titular: noticia.titular as string,
      ticker: noticia.ticker as string | null,
      tickers: (noticia.tickers as string[] | null) ?? [],
      relevancia: noticia.relevancia === null ? null : Number(noticia.relevancia),
    })),
    tickersConBalanceHoy: (balancesHoy.data ?? []).map((fila) => fila.ticker as string),
    posiciones: [], // todavía no hay bots (parte B)
    clavesRegistradas: new Set((claves.data ?? []).map((fila) => fila.clave as string)),
    disparosHoy: disparos.data?.length ?? 0,
    ultimoDisparo: disparos.data?.[0] ? new Date(disparos.data[0].ts as string) : null,
    config: { ...CONFIG_MONITOR_DEFAULT, ...contexto.monitor },
  });

  if (eventos.length > 0) {
    const { error } = await supabase.from("lab_eventos_mercado").upsert(
      eventos.map((evento) => ({
        ts: ahora.toISOString(),
        clave: evento.clave,
        tipo: evento.tipo,
        ticker: evento.ticker,
        detalle: evento.detalle,
        disparo_decision: evento.disparaDecision,
      })),
      { onConflict: "clave", ignoreDuplicates: true }
    );
    if (error) throw new Error(`No pude guardar los eventos: ${error.message}`);
  }

  return { precios: snapshots.length, eventos: eventos.length, dispararian: eventos.filter((evento) => evento.disparaDecision).length };
}

// --- Noticias (cada 30 min) ---

export async function ejecutarNoticias(supabase: SupabaseClient) {
  const contexto = await leerContextoLab(supabase);
  const recoleccion = await recolectarNoticias(supabase, contexto.universo);
  const resumen = await resumirNoticiasPendientes(supabase, {
    universo: contexto.universo,
    modelo: contexto.modeloResumen,
    topeIaUsd: contexto.topeIaUsd,
  });
  return { recoleccion, resumen };
}

// --- Diaria: indicadores, macro y calendario (después del cierre) ---

async function guardarIndicadores(supabase: SupabaseClient, universo: string[]) {
  const barras = await obtenerBarrasDiarias(universo, 400);
  const filas: Array<{ ticker: string; fecha: string; datos: unknown }> = [];
  const cierres: Array<{ ticker: string; ts: string; precio: number; volumen: number; tipo: string }> = [];
  const sinDatos: string[] = [];
  for (const ticker of universo) {
    const indicadores = calcularIndicadores(barras[ticker] ?? []);
    if (!indicadores) {
      sinDatos.push(ticker);
      continue;
    }
    filas.push({ ticker, fecha: indicadores.fecha, datos: indicadores });
    cierres.push({ ticker, ts: `${indicadores.fecha}T21:00:00Z`, precio: indicadores.cierre, volumen: indicadores.volumen, tipo: "cierre" });
  }
  if (filas.length > 0) {
    const { error } = await supabase.from("lab_indicadores").upsert(filas, { onConflict: "ticker,fecha" });
    if (error) throw new Error(`No pude guardar los indicadores: ${error.message}`);
    const { error: errorCierres } = await supabase.from("lab_precios").upsert(cierres, { onConflict: "ticker,ts,tipo" });
    if (errorCierres) throw new Error(`No pude guardar los cierres: ${errorCierres.message}`);
  }
  return { tickers: filas.length, sinDatos };
}

async function guardarMacro(supabase: SupabaseClient) {
  const errores: Array<{ serie: string; error: string }> = [];
  let observaciones = 0;
  for (const serie of SERIES_MACRO) {
    try {
      const datos = await obtenerSerieFred(serie.id, serie.observaciones);
      if (datos.length === 0) continue;
      const { error } = await supabase
        .from("lab_macro")
        .upsert(datos.map((dato) => ({ serie: serie.id, fecha: dato.fecha, valor: dato.valor })), { onConflict: "serie,fecha" });
      if (error) throw new Error(error.message);
      observaciones += datos.length;
    } catch (error) {
      errores.push({ serie: serie.id, error: mensajeDeError(error) });
    }
  }
  return { observaciones, errores };
}

async function guardarCalendario(supabase: SupabaseClient, universo: string[], hoy: string) {
  const hasta = new Date(Date.parse(`${hoy}T00:00:00Z`) + 45 * 24 * HORAS).toISOString().slice(0, 10);
  const hastaFed = new Date(Date.parse(`${hoy}T00:00:00Z`) + 120 * 24 * HORAS).toISOString().slice(0, 10);
  const errores: Array<{ ticker: string; error: string }> = [];
  let balances = 0;

  const empresas = universo.filter((ticker) => !ETFS_UNIVERSO.has(ticker));
  const resultados = await Promise.allSettled(empresas.map((ticker) => obtenerBalancesProgramados(ticker, hoy, hasta)));
  for (const [indice, resultado] of resultados.entries()) {
    const ticker = empresas[indice];
    if (resultado.status === "rejected") {
      errores.push({ ticker, error: mensajeDeError(resultado.reason) });
      continue; // se conserva lo que había de ese ticker
    }
    await supabase.from("lab_eventos_calendario").delete().eq("tipo", "balance").eq("ticker", ticker).gte("fecha", hoy);
    if (resultado.value.length > 0) {
      const { error } = await supabase
        .from("lab_eventos_calendario")
        .insert(resultado.value.map((balance) => ({ tipo: "balance", ticker, fecha: balance.fecha, detalle: balance.detalle })));
      if (error) errores.push({ ticker, error: error.message });
      else balances += resultado.value.length;
    }
  }

  const reunionesFed = reunionesFedEntre(hoy, hastaFed);
  await supabase.from("lab_eventos_calendario").delete().eq("tipo", "fed").gte("fecha", hoy);
  if (reunionesFed.length > 0) {
    await supabase
      .from("lab_eventos_calendario")
      .insert(reunionesFed.map((fecha) => ({ tipo: "fed", ticker: null, fecha, detalle: { descripcion: "Reunión del FOMC (decisión de tasas)" } })));
  }
  return { balances, reunionesFed: reunionesFed.length, errores };
}

export async function ejecutarMacro(supabase: SupabaseClient) {
  const contexto = await leerContextoLab(supabase);
  const hoy = fechaNuevaYork(new Date());
  // Cada bloque es independiente: si una fuente falla, las otras igual se guardan.
  const [indicadores, macro, calendario] = await Promise.allSettled([
    guardarIndicadores(supabase, contexto.universo),
    guardarMacro(supabase),
    guardarCalendario(supabase, contexto.universo, hoy),
  ]);
  const comoDetalle = <T,>(resultado: PromiseSettledResult<T>) =>
    resultado.status === "fulfilled" ? resultado.value : { error: mensajeDeError(resultado.reason) };
  return {
    indicadores: comoDetalle(indicadores),
    macro: comoDetalle(macro),
    calendario: comoDetalle(calendario),
  };
}

// ¿Alguna parte del resultado informa un error? (fuente caída, IA que falló, etc.)
export function hayErrores(valor: unknown): boolean {
  if (!valor || typeof valor !== "object") return false;
  const objeto = valor as Record<string, unknown>;
  if (typeof objeto.error === "string" && objeto.error) return true;
  if (Array.isArray(objeto.errores) && objeto.errores.length > 0) return true;
  if (objeto.estado === "error") return true;
  return Object.values(objeto).some((hijo) => hayErrores(hijo));
}

// Corre una tarea, deja el registro en lab_ejecuciones y arma la respuesta del endpoint.
// No reintenta: si algo falla, queda el error y la próxima corrida programada lo vuelve a intentar.
export async function ejecutarTareaLab(
  supabase: SupabaseClient,
  tarea: TareaLab,
  ejecutar: (supabase: SupabaseClient) => Promise<Record<string, unknown>>
): Promise<{ status: number; cuerpo: Record<string, unknown> }> {
  try {
    const resultado = await ejecutar(supabase);
    if ("omitido" in resultado) return { status: 200, cuerpo: { ok: true, tarea, ...resultado } };
    const ok = !hayErrores(resultado);
    await registrarEjecucion(supabase, tarea, ok, resultado);
    return { status: 200, cuerpo: { ok, tarea, ...resultado } };
  } catch (error) {
    const mensaje = mensajeDeError(error);
    await registrarEjecucion(supabase, tarea, false, {}, mensaje).catch(() => undefined);
    return { status: 500, cuerpo: { ok: false, tarea, error: mensaje } };
  }
}
