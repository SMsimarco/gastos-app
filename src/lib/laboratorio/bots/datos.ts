import type { SupabaseClient } from "@supabase/supabase-js";
import { descripcionCalendario, formatoMacro } from "../diario";
import { armarSenales, recortarDiarios, type DiarioResumido, type EstadisticaDB } from "../memoria";
import { armarFundamentales, resumirMacro, SERIES_PANEL, type FilaMacroPanel } from "../panel";
import { ETFS_UNIVERSO } from "../config";
import type { DatosCompletos, IndicadorTicker } from "./briefing";

const HORAS = 3_600_000;

function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

// Indicadores del universo con el último precio disponible: el intradía del monitor si es más nuevo que
// el último cierre calculado, y si no el cierre.
export async function leerIndicadoresUniverso(supabase: SupabaseClient, universo: string[]): Promise<IndicadorTicker[]> {
  const [indicadores, precios] = await Promise.all([
    supabase.from("lab_indicadores").select("ticker, fecha, datos").in("ticker", universo).order("fecha", { ascending: false }).limit(universo.length * 2),
    supabase.from("lab_precios").select("ticker, ts, precio").eq("tipo", "intradia").in("ticker", universo).order("ts", { ascending: false }).limit(universo.length * 40),
  ]);
  const ultimoIndicador = new Map<string, { fecha: string; datos: Record<string, number | null> }>();
  for (const fila of indicadores.data ?? []) {
    if (!ultimoIndicador.has(fila.ticker as string)) ultimoIndicador.set(fila.ticker as string, { fecha: fila.fecha as string, datos: fila.datos as Record<string, number | null> });
  }
  const ultimoPrecio = new Map<string, { ts: string; precio: number }>();
  for (const fila of precios.data ?? []) {
    if (!ultimoPrecio.has(fila.ticker as string)) ultimoPrecio.set(fila.ticker as string, { ts: fila.ts as string, precio: Number(fila.precio) });
  }
  return universo.flatMap((ticker) => {
    const indicador = ultimoIndicador.get(ticker);
    if (!indicador) return [];
    const intradia = ultimoPrecio.get(ticker);
    const usarIntradia = intradia && intradia.ts.slice(0, 10) > indicador.fecha;
    const datos = indicador.datos;
    return [{
      ticker,
      precio: usarIntradia ? intradia.precio : Number(datos.cierre),
      variacion_dia: datos.variacion_dia ?? null,
      variacion_semana: datos.variacion_semana ?? null,
      variacion_mes: datos.variacion_mes ?? null,
      rsi14: datos.rsi14 ?? null,
      sma50: datos.sma50 ?? null,
      sma200: datos.sma200 ?? null,
      distancia_max52s: datos.distancia_max52s ?? null,
      volatilidad20: datos.volatilidad20 ?? null,
      volumen_relativo: datos.volumen_relativo ?? null,
    }];
  });
}

// Todo lo que reciben los bots con perfil completo: noticias, macro, fundamentales, calendario, diario y señales.
export async function leerDatosCompletos(supabase: SupabaseClient, universo: string[], hoy: string, botId?: string): Promise<DatosCompletos> {
  const ahora = Date.now();
  const empresas = universo.filter((ticker) => !ETFS_UNIVERSO.has(ticker));
  const [noticias, macro, filings, calendario, diario, senales, estadisticas, fundamentales, analistas, sorpresas, insiders, lecciones] = await Promise.all([
    supabase
      .from("lab_noticias")
      .select("resumen, titular, sentimiento, relevancia, tickers, tema")
      .eq("procesada", true)
      .gte("publicado_at", new Date(ahora - 26 * HORAS).toISOString())
      .order("relevancia", { ascending: false })
      .limit(15),
    Promise.all(SERIES_PANEL.map((serie) => supabase.from("lab_macro").select("serie, fecha, valor").eq("serie", serie.id).order("fecha", { ascending: false }).limit(16))),
    supabase.from("lab_filings").select("ticker, formulario, descripcion, fecha").gte("fecha", sumarDias(hoy, -3)).order("fecha", { ascending: false }).limit(8),
    supabase.from("lab_eventos_calendario").select("fecha, tipo, ticker, detalle").gte("fecha", hoy).lte("fecha", sumarDias(hoy, 7)).order("fecha", { ascending: true }).limit(20),
    supabase.from("lab_diario").select("fecha, resumen, puntos_clave, a_mirar, tono").order("fecha", { ascending: false }).limit(5),
    supabase.from("lab_senales").select("ticker, fecha, evento").order("fecha", { ascending: false }).limit(60),
    supabase.from("lab_estadisticas").select("evento, ticker, horizonte, n, media, mediana, pct_positivo, media_base").limit(1000),
    supabase.from("lab_fundamentales").select("ticker, fecha, datos").in("ticker", empresas).order("fecha", { ascending: false }).limit(empresas.length * 3),
    supabase.from("lab_analistas").select("ticker, periodo, strong_buy, buy, hold, sell, strong_sell").in("ticker", empresas).order("periodo", { ascending: false }).limit(empresas.length * 4),
    supabase.from("lab_sorpresas").select("ticker, periodo, sorpresa_pct").in("ticker", empresas).order("periodo", { ascending: false }).limit(empresas.length * 4),
    supabase.from("lab_insiders").select("ticker, codigo, fecha_transaccion, cambio_acciones").in("ticker", empresas).gte("fecha_transaccion", sumarDias(hoy, -90)).limit(2000),
    // Cada bot aprende solo de sus propias decisiones.
    botId
      ? supabase.from("lab_lecciones").select("fecha_decision, ticker, leccion").eq("bot_id", botId).order("creada_at", { ascending: false }).limit(5)
      : Promise.resolve({ data: [] }),
  ]);

  const recientes = sumarDias(hoy, -4);
  const filasMacro = SERIES_PANEL.map((serie, i) =>
    resumirMacro(serie.id, (macro[i].data ?? []).map((fila) => ({ fecha: fila.fecha as string, valor: Number(fila.valor) })))
  ).filter((fila): fila is FilaMacroPanel => fila !== null && fila.fecha >= recientes);

  const fundamentalesPorEmpresa = armarFundamentales({
    empresas,
    fundamentales: (fundamentales.data ?? []) as Array<{ ticker: string; fecha: string; datos: Record<string, number | null> }>,
    analistas: (analistas.data ?? []) as Array<{ ticker: string; periodo: string; strong_buy: number; buy: number; hold: number; sell: number; strong_sell: number }>,
    sorpresas: (sorpresas.data ?? []).map((fila) => ({ ticker: fila.ticker as string, periodo: fila.periodo as string, sorpresa_pct: fila.sorpresa_pct === null ? null : Number(fila.sorpresa_pct) })),
    insiders: (insiders.data ?? []).map((fila) => ({ ticker: fila.ticker as string, codigo: fila.codigo as string, fecha_transaccion: fila.fecha_transaccion as string, cambio_acciones: Number(fila.cambio_acciones) })),
    hoy,
  }).filter((fila) => fila.fechaDatos !== null);

  const filasEstadisticas = (estadisticas.data ?? []).map((fila) => ({
    evento: fila.evento as string,
    ticker: fila.ticker as string,
    horizonte: Number(fila.horizonte),
    n: Number(fila.n),
    media: fila.media === null ? null : Number(fila.media),
    mediana: fila.mediana === null ? null : Number(fila.mediana),
    pct_positivo: fila.pct_positivo === null ? null : Number(fila.pct_positivo),
    media_base: fila.media_base === null ? null : Number(fila.media_base),
  })) as EstadisticaDB[];
  const fechaSenales = (senales.data ?? [])[0]?.fecha as string | undefined;

  return {
    noticias: (noticias.data ?? []).map((fila) => ({
      texto: ((fila.resumen as string | null) ?? (fila.titular as string)),
      sentimiento: fila.sentimiento === null ? null : Number(fila.sentimiento),
      relevancia: fila.relevancia === null ? null : Number(fila.relevancia),
      tickers: (fila.tickers as string[] | null) ?? [],
      tema: (fila.tema as string | null) ?? null,
    })),
    macro: filasMacro.map(formatoMacro),
    fundamentales: fundamentalesPorEmpresa.map((fila) => ({
      ticker: fila.ticker,
      pe: fila.pe,
      margen_neto_pct: fila.margenNeto,
      crecimiento_ingresos_pct: fila.crecimientoIngresos,
      beta: fila.beta,
      analistas: fila.analistas ? `${fila.analistas.compra} de ${fila.analistas.total} recomiendan comprar` : null,
      ultimo_balance_vs_esperado_pct: fila.sorpresa?.pct ?? null,
      directivos_90_dias: fila.insiders ? `${fila.insiders.compras} compras y ${fila.insiders.ventas} ventas` : null,
    })),
    presentaciones_sec: (filings.data ?? []) as DatosCompletos["presentaciones_sec"],
    calendario_proximos_7_dias: (calendario.data ?? []).map((evento) => ({
      fecha: evento.fecha as string,
      descripcion: descripcionCalendario(evento as { fecha: string; tipo: string; ticker: string | null; detalle: Record<string, unknown> }),
    })),
    diario: recortarDiarios((diario.data ?? []) as DiarioResumido[]),
    senales_de_hoy: armarSenales(
      (senales.data ?? []).filter((fila) => fila.fecha === fechaSenales).map((fila) => ({ ticker: fila.ticker as string, evento: fila.evento as string })),
      filasEstadisticas
    ),
    lecciones: (lecciones.data ?? []).map((fila) => ({ fecha: fila.fecha_decision as string, ticker: (fila.ticker as string | null) ?? null, leccion: fila.leccion as string })),
  };
}
