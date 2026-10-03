import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerNoticias as obtenerNoticiasAlpaca, type NoticiaCruda } from "./fuentes/alpaca";
import { obtenerNoticiasGlobales, type NoticiaGlobalCruda } from "./fuentes/gdelt";
import { mensajeDeError } from "./fuentes/http";
import { llamarGeminiJson } from "./gemini";
import { costoLlamadaUsd, evaluarPresupuesto, inicioDeMesUtc } from "./presupuesto";

export const MAX_NOTICIAS_POR_LOTE = 40;
const HORAS_MAX_PENDIENTE = 48;

export type FilaNoticia = {
  fuente: string;
  ticker: string | null;
  tickers: string[];
  tema: string | null;
  titular: string;
  url: string;
  publicado_at: string;
};

// Una noticia de empresa puede nombrar varios tickers: el principal es el primero del universo
// que aparece; `tickers` guarda todos los del universo.
export function elegirTickers(tickersDeLaFuente: string[], universo: string[]): { ticker: string | null; tickers: string[] } {
  const enUniverso = new Set(universo);
  const afectados = [...new Set(tickersDeLaFuente.map((ticker) => ticker.toUpperCase()))].filter((ticker) => enUniverso.has(ticker));
  return { ticker: afectados[0] ?? null, tickers: afectados };
}

export function filasDeNoticias(params: {
  empresa: NoticiaCruda[];
  globales: NoticiaGlobalCruda[];
  universo: string[];
}): FilaNoticia[] {
  const filas = new Map<string, FilaNoticia>();
  for (const noticia of params.empresa) {
    const { ticker, tickers } = elegirTickers(noticia.tickers, params.universo);
    if (!ticker) continue; // la nota nombra tickers fuera del universo
    filas.set(noticia.url, {
      fuente: noticia.fuente,
      ticker,
      tickers,
      tema: null,
      titular: noticia.titular,
      url: noticia.url,
      publicado_at: noticia.publicadoAt,
    });
  }
  for (const noticia of params.globales) {
    if (filas.has(noticia.url)) continue;
    filas.set(noticia.url, {
      fuente: `gdelt:${noticia.dominio ?? "desconocido"}`,
      ticker: null,
      tickers: [],
      tema: noticia.tema,
      titular: noticia.titular,
      url: noticia.url,
      publicado_at: noticia.publicadoAt,
    });
  }
  return [...filas.values()];
}

// --- Resumen en lote con el modelo barato ---

export type NoticiaPendiente = { id: string; titular: string; ticker: string | null; tickers: string[]; tema: string | null };

export const RESUMEN_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      indice: { type: "INTEGER" },
      resumen: { type: "STRING" },
      sentimiento: { type: "NUMBER" },
      relevancia: { type: "NUMBER" },
      tickers: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["indice", "resumen", "sentimiento", "relevancia", "tickers"],
  },
};

export function construirPromptResumen(noticias: NoticiaPendiente[], universo: string[]): string {
  const items = noticias.map((noticia, indice) => ({
    indice,
    titular: noticia.titular,
    tema: noticia.tema,
    tickers_de_la_fuente: noticia.tickers,
  }));
  return `Sos un analista que resume noticias financieras para un laboratorio de inversión simulado. Respondé en español rioplatense.
Universo de tickers: ${universo.join(", ")}.

Para CADA noticia devolvé:
- indice: el mismo número que recibiste.
- resumen: una sola línea, máximo 160 caracteres, solo con lo que dice el titular. No inventes datos ni cifras.
- sentimiento: de -1 (muy negativo) a 1 (muy positivo) para los tickers afectados o, si es una noticia global, para el mercado de acciones de EE.UU. 0 si es neutral.
- relevancia: de 0 a 1. Usá 0.8 o más SOLO si la noticia probablemente mueva el precio de algún ticker del universo; las noticias generales o repetidas valen menos de 0.4.
- tickers: los tickers del universo afectados (puede ser una lista vacía). Nunca uses tickers fuera del universo.
No calcules montos ni porcentajes.

Noticias:
${JSON.stringify(items)}`;
}

export type ResumenNoticia = { resumen: string; sentimiento: number; relevancia: number; tickers: string[] };

function acotar(valor: unknown, minimo: number, maximo: number): number | null {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  return Math.min(maximo, Math.max(minimo, numero));
}

// Valida lo que devolvió la IA: descarta índices desconocidos, acota rangos y filtra tickers.
export function normalizarResumenes(respuesta: unknown, cantidad: number, universo: string[]): Map<number, ResumenNoticia> {
  const resultado = new Map<number, ResumenNoticia>();
  if (!Array.isArray(respuesta)) return resultado;
  const enUniverso = new Set(universo);
  for (const item of respuesta as Array<Record<string, unknown>>) {
    const indice = Number(item?.indice);
    const sentimiento = acotar(item?.sentimiento, -1, 1);
    const relevancia = acotar(item?.relevancia, 0, 1);
    if (!Number.isInteger(indice) || indice < 0 || indice >= cantidad || sentimiento === null || relevancia === null) continue;
    if (typeof item.resumen !== "string" || !item.resumen.trim()) continue;
    resultado.set(indice, {
      resumen: item.resumen.trim().slice(0, 240),
      sentimiento: Math.round(sentimiento * 100) / 100,
      relevancia: Math.round(relevancia * 100) / 100,
      tickers: Array.isArray(item.tickers)
        ? [...new Set((item.tickers as unknown[]).map((ticker) => String(ticker).toUpperCase()))].filter((ticker) => enUniverso.has(ticker))
        : [],
    });
  }
  return resultado;
}

// --- Recolección y resumen (con base de datos) ---

export type ResultadoRecoleccion = {
  nuevas: number;
  vistas: number;
  errores: Array<{ fuente: string; error: string }>;
  temasOmitidos: string[];
};

export async function recolectarNoticias(supabase: SupabaseClient, universo: string[]): Promise<ResultadoRecoleccion> {
  const errores: ResultadoRecoleccion["errores"] = [];
  let empresa: NoticiaCruda[] = [];
  let globales: NoticiaGlobalCruda[] = [];
  let temasOmitidos: string[] = [];

  // Las dos fuentes son independientes: si una falla, la otra sigue y el error queda registrado.
  const [alpaca, gdelt] = await Promise.allSettled([
    obtenerNoticiasAlpaca(universo, new Date(Date.now() - 6 * 3_600_000)),
    obtenerNoticiasGlobales(),
  ]);
  if (alpaca.status === "fulfilled") empresa = alpaca.value;
  else errores.push({ fuente: "alpaca-noticias", error: mensajeDeError(alpaca.reason) });
  if (gdelt.status === "fulfilled") {
    globales = gdelt.value.noticias;
    temasOmitidos = gdelt.value.omitidos;
    for (const fallo of gdelt.value.errores) errores.push({ fuente: `gdelt:${fallo.tema}`, error: fallo.error });
  } else {
    errores.push({ fuente: "gdelt", error: mensajeDeError(gdelt.reason) });
  }

  const filas = filasDeNoticias({ empresa, globales, universo });
  let nuevas = 0;
  if (filas.length > 0) {
    // Deduplica por URL: una noticia ya vista no se vuelve a insertar ni a resumir.
    const { data, error } = await supabase
      .from("lab_noticias")
      .upsert(filas, { onConflict: "url", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`No pude guardar las noticias: ${error.message}`);
    nuevas = data?.length ?? 0;
  }
  return { nuevas, vistas: filas.length, errores, temasOmitidos };
}

export type ResultadoResumen = {
  estado: "ok" | "sin_pendientes" | "sin_presupuesto" | "error";
  resumidas: number;
  costoUsd: number;
  error?: string;
};

export async function resumirNoticiasPendientes(
  supabase: SupabaseClient,
  params: { universo: string[]; modelo: string; topeIaUsd: number }
): Promise<ResultadoResumen> {
  const desde = new Date(Date.now() - HORAS_MAX_PENDIENTE * 3_600_000).toISOString();
  const { data: pendientes, error } = await supabase
    .from("lab_noticias")
    .select("id, titular, ticker, tickers, tema")
    .eq("procesada", false)
    .gte("publicado_at", desde)
    .order("publicado_at", { ascending: false })
    .limit(MAX_NOTICIAS_POR_LOTE);
  if (error) return { estado: "error", resumidas: 0, costoUsd: 0, error: error.message };
  const lote = (pendientes ?? []) as NoticiaPendiente[];
  if (lote.length === 0) return { estado: "sin_pendientes", resumidas: 0, costoUsd: 0 };

  const { data: costos } = await supabase.from("lab_costos_ia").select("costo_usd").gte("ts", inicioDeMesUtc(new Date()));
  const gastadoMesUsd = (costos ?? []).reduce((total, fila) => total + Number(fila.costo_usd), 0);
  const prompt = construirPromptResumen(lote, params.universo);
  // Estimación gruesa previa (~3 caracteres por token; ~90 tokens de salida por noticia).
  const costoEstimadoUsd = costoLlamadaUsd(params.modelo, Math.ceil(prompt.length / 3), lote.length * 90);
  const presupuesto = evaluarPresupuesto({ gastadoMesUsd, topeUsd: params.topeIaUsd, costoEstimadoUsd });
  if (!presupuesto.permitido) return { estado: "sin_presupuesto", resumidas: 0, costoUsd: 0 };

  try {
    const { data, tokensEntrada, tokensSalida } = await llamarGeminiJson<unknown>(params.modelo, prompt, RESUMEN_SCHEMA);
    const costoUsd = costoLlamadaUsd(params.modelo, tokensEntrada, tokensSalida);
    // El costo se registra aunque después falle algo: ya se gastó.
    await supabase.from("lab_costos_ia").insert({
      tipo: "resumen_noticias",
      modelo: params.modelo,
      tokens_entrada: tokensEntrada,
      tokens_salida: tokensSalida,
      costo_usd: costoUsd,
      detalle: { noticias: lote.length },
    });

    const resumenes = normalizarResumenes(data, lote.length, params.universo);
    let resumidas = 0;
    for (const [indice, resumen] of resumenes) {
      const noticia = lote[indice];
      const { error: errorUpdate } = await supabase
        .from("lab_noticias")
        .update({
          resumen: resumen.resumen,
          sentimiento: resumen.sentimiento,
          relevancia: resumen.relevancia,
          tickers: resumen.tickers.length > 0 ? resumen.tickers : noticia.tickers,
          procesada: true,
        })
        .eq("id", noticia.id);
      if (!errorUpdate) resumidas += 1;
    }
    return { estado: "ok", resumidas, costoUsd };
  } catch (errorIa) {
    // No se reintenta en loop: las noticias quedan pendientes para la próxima corrida.
    return { estado: "error", resumidas: 0, costoUsd: 0, error: mensajeDeError(errorIa) };
  }
}
