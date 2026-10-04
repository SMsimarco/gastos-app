import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaNuevaYork, leerContextoLab, type ContextoLab } from "./config";
import { gastoDelMes, registrarCostoIa } from "./costos";
import { armarHechos, construirPromptDiario, DIARIO_SCHEMA, normalizarDiario } from "./diario";
import { eventosDeHoy, estudiarEventos } from "./eventos";
import { obtenerBarrasDiarias } from "./fuentes/alpaca";
import { mensajeDeError } from "./fuentes/http";
import { llamarGeminiJson } from "./gemini";
import type { Barra } from "./indicadores";
import { resumirMacro, SERIES_PANEL, type FilaMacroPanel } from "./panel";
import { costoLlamadaUsd, evaluarPresupuesto } from "./presupuesto";

// Años de historia para las estadísticas. Con el feed consolidado (SIP) el plan gratis llega a 2016;
// 2600 días alcanzan para ver varios regímenes (la caída de 2020, el mercado bajista de 2022).
const DIAS_HISTORIA = 2_600;
const DIAS_ENTRE_RECALCULOS = 7;
const HORAS = 3_600_000;

export type OpcionesAprendizaje = { forzarEstadisticas?: boolean; forzarDiario?: boolean };

function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

// --- Señales de hoy ---

async function guardarSenales(supabase: SupabaseClient, barras: Record<string, Barra[]>, ultimaRueda: string) {
  const filas: Array<{ ticker: string; fecha: string; evento: string }> = [];
  for (const [ticker, serie] of Object.entries(barras)) {
    const hoy = eventosDeHoy(serie);
    // Solo cuentan los eventos de la última rueda del mercado (un ticker sin datos recientes no aporta).
    if (!hoy || hoy.fecha !== ultimaRueda) continue;
    for (const evento of hoy.eventos) filas.push({ ticker, fecha: ultimaRueda, evento });
  }
  if (filas.length > 0) {
    const { error } = await supabase.from("lab_senales").upsert(filas, { onConflict: "ticker,fecha,evento", ignoreDuplicates: true });
    if (error) throw new Error(`No pude guardar las señales: ${error.message}`);
  }
  return { fecha: ultimaRueda, senales: filas.length };
}

// --- Estadísticas de eventos (se recalculan una vez por semana) ---

async function actualizarEstadisticas(supabase: SupabaseClient, barras: Record<string, Barra[]>, forzar: boolean) {
  const { data: ultima } = await supabase.from("lab_estadisticas").select("calculado_at").order("calculado_at", { ascending: false }).limit(1);
  const ultimoCalculo = ultima?.[0]?.calculado_at ? new Date(ultima[0].calculado_at as string) : null;
  const vigente = ultimoCalculo !== null && Date.now() - ultimoCalculo.getTime() < DIAS_ENTRE_RECALCULOS * 24 * HORAS;
  if (vigente && !forzar) return { recalculadas: false, filas: 0 };

  const { filas, desde, hasta } = estudiarEventos(barras);
  if (filas.length === 0) return { recalculadas: false, filas: 0 };
  const calculadoAt = new Date().toISOString();
  const { error } = await supabase.from("lab_estadisticas").upsert(
    filas.map((fila) => ({
      evento: fila.evento,
      ticker: fila.ticker,
      horizonte: fila.horizonte,
      n: fila.n,
      media: fila.media,
      mediana: fila.mediana,
      pct_positivo: fila.pctPositivo,
      media_base: fila.mediaBase,
      desde,
      hasta,
      calculado_at: calculadoAt,
    })),
    { onConflict: "evento,ticker,horizonte" }
  );
  if (error) throw new Error(`No pude guardar las estadísticas: ${error.message}`);
  return { recalculadas: true, filas: filas.length, desde, hasta };
}

// --- Diario de mercado (IA) ---

type EstadoDiario = "ok" | "ya_existe" | "sin_rueda_hoy" | "sin_presupuesto" | "error";

async function generarDiario(
  supabase: SupabaseClient,
  contexto: ContextoLab,
  hoy: string,
  ultimaRueda: string,
  forzar: boolean
): Promise<{ estado: EstadoDiario; costoUsd?: number; error?: string }> {
  // Solo se escribe si el mercado cerró hoy (no en feriados ni si los datos no llegaron). Con `forzar`
  // se escribe el de la última rueda disponible, útil para probar, para fines de semana y para rellenar.
  if (!forzar && ultimaRueda !== hoy) return { estado: "sin_rueda_hoy" };
  const fecha = forzar ? ultimaRueda : hoy;
  if (!forzar) {
    const { data: existente } = await supabase.from("lab_diario").select("fecha").eq("fecha", fecha).maybeSingle();
    if (existente) return { estado: "ya_existe" };
  }

  const ahora = Date.now();
  const hasta = sumarDias(fecha, 7);
  const [indicadores, macro, noticias, eventos, filings, calendario, senales] = await Promise.all([
    supabase.from("lab_indicadores").select("ticker, fecha, datos").in("ticker", contexto.universo).order("fecha", { ascending: false }).limit(contexto.universo.length * 2),
    Promise.all(SERIES_PANEL.map((serie) => supabase.from("lab_macro").select("serie, fecha, valor").eq("serie", serie.id).order("fecha", { ascending: false }).limit(16))),
    supabase
      .from("lab_noticias")
      .select("resumen, titular, sentimiento, relevancia, tickers, tema")
      .eq("procesada", true)
      .gte("publicado_at", new Date(ahora - 26 * HORAS).toISOString())
      .order("relevancia", { ascending: false })
      .limit(30),
    supabase.from("lab_eventos_mercado").select("tipo, ticker, detalle").gte("ts", new Date(ahora - 16 * HORAS).toISOString()).order("ts", { ascending: false }).limit(20),
    supabase.from("lab_filings").select("ticker, formulario, descripcion, fecha").gte("fecha", sumarDias(fecha, -2)).order("fecha", { ascending: false }).limit(8),
    supabase.from("lab_eventos_calendario").select("fecha, tipo, ticker, detalle").gte("fecha", fecha).lte("fecha", hasta).order("fecha", { ascending: true }).limit(40),
    supabase.from("lab_senales").select("ticker, evento").eq("fecha", ultimaRueda),
  ]);

  const ultimosIndicadores = new Map<string, { ticker: string; cierre: number; variacion_dia: number | null; rsi14: number | null; distancia_max52s: number | null; volumen_relativo: number | null }>();
  for (const fila of indicadores.data ?? []) {
    if (ultimosIndicadores.has(fila.ticker as string)) continue;
    const datos = fila.datos as Record<string, number | null>;
    ultimosIndicadores.set(fila.ticker as string, {
      ticker: fila.ticker as string,
      cierre: Number(datos.cierre),
      variacion_dia: datos.variacion_dia ?? null,
      rsi14: datos.rsi14 ?? null,
      distancia_max52s: datos.distancia_max52s ?? null,
      volumen_relativo: datos.volumen_relativo ?? null,
    });
  }
  const filasMacro = SERIES_PANEL.map((serie, i) =>
    resumirMacro(serie.id, (macro[i].data ?? []).map((fila) => ({ fecha: fila.fecha as string, valor: Number(fila.valor) })))
  ).filter((fila): fila is FilaMacroPanel => fila !== null);

  const hechos = armarHechos({
    fecha,
    indicadores: [...ultimosIndicadores.values()],
    macro: filasMacro,
    noticias: (noticias.data ?? []).map((fila) => ({
      resumen: (fila.resumen as string | null) ?? null,
      titular: fila.titular as string,
      sentimiento: fila.sentimiento === null ? null : Number(fila.sentimiento),
      relevancia: fila.relevancia === null ? null : Number(fila.relevancia),
      tickers: (fila.tickers as string[] | null) ?? [],
      tema: (fila.tema as string | null) ?? null,
    })),
    eventos: (eventos.data ?? []) as Array<{ tipo: string; ticker: string | null; detalle: Record<string, unknown> }>,
    filings: (filings.data ?? []) as Array<{ ticker: string; formulario: string; descripcion: string | null; fecha: string }>,
    calendario: (calendario.data ?? []) as Array<{ fecha: string; tipo: string; ticker: string | null; detalle: Record<string, unknown> }>,
    senales: (senales.data ?? []) as Array<{ ticker: string; evento: string }>,
  });

  const prompt = construirPromptDiario(hechos);
  const costoEstimadoUsd = costoLlamadaUsd(contexto.modeloDecision, Math.ceil(prompt.length / 3), 900);
  const presupuesto = evaluarPresupuesto({ gastadoMesUsd: await gastoDelMes(supabase), topeUsd: contexto.topeIaUsd, costoEstimadoUsd });
  if (!presupuesto.permitido) return { estado: "sin_presupuesto" };

  try {
    // Si el modelo principal está saturado (503/429) se prueba el de resumen una sola vez: sin reintentos en loop.
    const modelos = [...new Set([contexto.modeloDecision, contexto.modeloResumen])];
    let respuesta: Awaited<ReturnType<typeof llamarGeminiJson<unknown>>> | null = null;
    let modeloUsado = modelos[0];
    let ultimoError: unknown = null;
    for (const modelo of modelos) {
      try {
        respuesta = await llamarGeminiJson<unknown>(modelo, prompt, DIARIO_SCHEMA);
        modeloUsado = modelo;
        break;
      } catch (errorModelo) {
        ultimoError = errorModelo;
      }
    }
    if (!respuesta) throw ultimoError ?? new Error("Ningún modelo respondió");
    const { data, tokensEntrada, tokensSalida } = respuesta;
    const costoUsd = await registrarCostoIa(supabase, { tipo: "diario_mercado", modelo: modeloUsado, tokensEntrada, tokensSalida, detalle: { fecha } });
    const diario = normalizarDiario(data);
    if (!diario) return { estado: "error", costoUsd, error: "La IA devolvió un diario sin resumen" };
    const { error } = await supabase.from("lab_diario").upsert(
      {
        fecha,
        resumen: diario.resumen,
        puntos_clave: diario.puntos_clave,
        a_mirar: diario.a_mirar,
        tono: diario.tono,
        hechos,
        modelo: modeloUsado,
        tokens_entrada: tokensEntrada,
        tokens_salida: tokensSalida,
        costo_usd: costoUsd,
      },
      { onConflict: "fecha" }
    );
    if (error) return { estado: "error", costoUsd, error: error.message };
    return { estado: "ok", costoUsd };
  } catch (error) {
    // No se reintenta en loop: la próxima corrida programada lo vuelve a intentar.
    return { estado: "error", error: mensajeDeError(error) };
  }
}

// --- Tarea diaria ---

export async function ejecutarAprendizaje(supabase: SupabaseClient, opciones: OpcionesAprendizaje = {}) {
  const contexto = await leerContextoLab(supabase);
  const hoy = fechaNuevaYork(new Date());
  const barras = await obtenerBarrasDiarias(contexto.universo, DIAS_HISTORIA);
  const ultimaRueda = Object.values(barras)
    .map((serie) => serie.at(-1)?.fecha ?? "")
    .reduce((maxima, fecha) => (fecha > maxima ? fecha : maxima), "");
  if (!ultimaRueda) throw new Error("Alpaca no devolvió barras diarias");

  // Cada paso es independiente: si uno falla, los otros igual se guardan. El diario va al final
  // porque lee las señales de hoy.
  const [senales, estadisticas] = await Promise.allSettled([
    guardarSenales(supabase, barras, ultimaRueda),
    actualizarEstadisticas(supabase, barras, Boolean(opciones.forzarEstadisticas)),
  ]);
  const [diario] = await Promise.allSettled([generarDiario(supabase, contexto, hoy, ultimaRueda, Boolean(opciones.forzarDiario))]);
  const comoDetalle = <T,>(resultado: PromiseSettledResult<T>) =>
    resultado.status === "fulfilled" ? resultado.value : { error: mensajeDeError(resultado.reason) };
  return { ultimaRueda, senales: comoDetalle(senales), estadisticas: comoDetalle(estadisticas), diario: comoDetalle(diario) };
}
