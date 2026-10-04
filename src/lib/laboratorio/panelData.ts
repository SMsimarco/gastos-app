import type { SupabaseClient } from "@supabase/supabase-js";
import { UNIVERSO_DEFAULT, fechaNuevaYork } from "./config";
import { SERIES_MACRO } from "./fuentes/fred";
import {
  resumirMacro,
  ultimaEjecucionPorTarea,
  variacionDelDia,
  type EstadoFuente,
  type FilaIndicadoresPanel,
  type FilaMacroPanel,
} from "./panel";
import type { TareaLab } from "./recoleccion";

export type FilaPrecioPanel = {
  ticker: string;
  precio: number | null;
  ts: string | null;
  variacionDia: number | null;
  rsi14: number | null;
  distanciaMax52s: number | null;
  tendencia: "sobre_sma50" | "bajo_sma50" | null;
};

export type NoticiaPanel = {
  id: string;
  titular: string;
  resumen: string | null;
  url: string;
  fuente: string;
  ticker: string | null;
  tickers: string[];
  tema: string | null;
  publicadoAt: string;
  sentimiento: number | null;
  relevancia: number | null;
};

export type EventoCalendarioPanel = { id: string; tipo: "balance" | "fed"; ticker: string | null; fecha: string; detalle: Record<string, unknown> };

export type EventoMercadoPanel = {
  id: string;
  ts: string;
  tipo: string;
  ticker: string | null;
  detalle: Record<string, unknown>;
  disparoDecision: boolean;
};

export type PanelEnVivo = {
  generadoAt: string;
  universo: string[];
  precios: FilaPrecioPanel[];
  macro: FilaMacroPanel[];
  noticias: NoticiaPanel[];
  calendario: EventoCalendarioPanel[];
  eventos: EventoMercadoPanel[];
  fuentes: EstadoFuente[];
};

async function obtenerUniverso(supabase: SupabaseClient, usuarioId: string): Promise<string[]> {
  const { data } = await supabase.from("lab_config").select("universo").eq("usuario_id", usuarioId).maybeSingle();
  if (data?.universo?.length) return data.universo as string[];
  // Primera vez que el usuario abre la pestaña: se crea su configuración con los valores por defecto.
  await supabase.from("lab_config").upsert({ usuario_id: usuarioId }, { onConflict: "usuario_id", ignoreDuplicates: true });
  return UNIVERSO_DEFAULT;
}

// Todo se lee con el cliente del usuario (RLS): las tablas de mercado son de lectura para cualquier
// usuario logueado y no se mezclan con nada del plan real.
export async function obtenerPanelEnVivo(supabase: SupabaseClient, usuarioId: string): Promise<PanelEnVivo> {
  const universo = await obtenerUniverso(supabase, usuarioId);
  const hoy = fechaNuevaYork(new Date());
  const idsMacro = SERIES_MACRO.map((serie) => serie.id);

  const [precios, indicadores, macro, noticias, calendario, eventos, ejecuciones] = await Promise.all([
    supabase.from("lab_precios").select("ticker, ts, precio").eq("tipo", "intradia").in("ticker", universo).order("ts", { ascending: false }).limit(universo.length * 40),
    supabase.from("lab_indicadores").select("ticker, fecha, datos").in("ticker", universo).order("fecha", { ascending: false }).limit(universo.length * 2),
    // Una consulta por serie: con un solo límite global, las series diarias desplazan a las mensuales (CPI, desempleo).
    Promise.all(
      idsMacro.map((serie) => supabase.from("lab_macro").select("serie, fecha, valor").eq("serie", serie).order("fecha", { ascending: false }).limit(16))
    ),
    supabase
      .from("lab_noticias")
      .select("id, titular, resumen, url, fuente, ticker, tickers, tema, publicado_at, sentimiento, relevancia")
      .order("publicado_at", { ascending: false })
      .limit(25),
    supabase.from("lab_eventos_calendario").select("id, tipo, ticker, fecha, detalle").gte("fecha", hoy).order("fecha", { ascending: true }).limit(25),
    supabase.from("lab_eventos_mercado").select("id, ts, tipo, ticker, detalle, disparo_decision").order("ts", { ascending: false }).limit(30),
    supabase.from("lab_ejecuciones").select("tarea, ts, ok, error").order("ts", { ascending: false }).limit(60),
  ]);

  // Último precio intradía y última fila de indicadores de cada ticker.
  const ultimoPrecio = new Map<string, { valor: number; ts: string }>();
  for (const fila of precios.data ?? []) {
    if (!ultimoPrecio.has(fila.ticker)) ultimoPrecio.set(fila.ticker, { valor: Number(fila.precio), ts: fila.ts as string });
  }
  const ultimosIndicadores = new Map<string, FilaIndicadoresPanel>();
  for (const fila of indicadores.data ?? []) {
    if (!ultimosIndicadores.has(fila.ticker)) {
      ultimosIndicadores.set(fila.ticker, { ...(fila.datos as Omit<FilaIndicadoresPanel, "fecha">), fecha: fila.fecha as string });
    }
  }

  const filasPrecios: FilaPrecioPanel[] = universo.map((ticker) => {
    const intradia = ultimoPrecio.get(ticker);
    const ind = ultimosIndicadores.get(ticker);
    // Sin precio intradía (mercado cerrado hace días o monitor sin correr) se usa el último cierre.
    const precio = intradia?.valor ?? ind?.cierre ?? null;
    return {
      ticker,
      precio,
      ts: intradia?.ts ?? null,
      variacionDia: intradia && ind ? variacionDelDia(intradia, ind) : (ind?.variacion_dia ?? null),
      rsi14: ind?.rsi14 ?? null,
      distanciaMax52s: ind?.distancia_max52s ?? null,
      tendencia: precio !== null && ind?.sma50 ? (precio >= ind.sma50 ? "sobre_sma50" : "bajo_sma50") : null,
    };
  });

  const macroPorSerie = new Map<string, Array<{ fecha: string; valor: number }>>();
  for (const fila of macro.flatMap((consulta) => consulta.data ?? [])) {
    macroPorSerie.set(fila.serie, [...(macroPorSerie.get(fila.serie) ?? []), { fecha: fila.fecha as string, valor: Number(fila.valor) }]);
  }
  const filasMacro = idsMacro
    .map((id) => resumirMacro(id, macroPorSerie.get(id) ?? []))
    .filter((fila): fila is FilaMacroPanel => fila !== null);

  return {
    generadoAt: new Date().toISOString(),
    universo,
    precios: filasPrecios,
    macro: filasMacro,
    noticias: (noticias.data ?? []).map((fila) => ({
      id: fila.id as string,
      titular: fila.titular as string,
      resumen: (fila.resumen as string | null) ?? null,
      url: fila.url as string,
      fuente: fila.fuente as string,
      ticker: (fila.ticker as string | null) ?? null,
      tickers: (fila.tickers as string[] | null) ?? [],
      tema: (fila.tema as string | null) ?? null,
      publicadoAt: fila.publicado_at as string,
      sentimiento: fila.sentimiento === null ? null : Number(fila.sentimiento),
      relevancia: fila.relevancia === null ? null : Number(fila.relevancia),
    })),
    calendario: (calendario.data ?? []) as EventoCalendarioPanel[],
    eventos: (eventos.data ?? []).map((fila) => ({
      id: fila.id as string,
      ts: fila.ts as string,
      tipo: fila.tipo as string,
      ticker: (fila.ticker as string | null) ?? null,
      detalle: (fila.detalle as Record<string, unknown>) ?? {},
      disparoDecision: Boolean(fila.disparo_decision),
    })),
    fuentes: ultimaEjecucionPorTarea(
      (ejecuciones.data ?? []).map((fila) => ({
        tarea: fila.tarea as TareaLab,
        ts: fila.ts as string,
        ok: Boolean(fila.ok),
        error: (fila.error as string | null) ?? null,
      }))
    ),
  };
}
