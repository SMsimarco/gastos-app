import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerNoticias as obtenerNoticiasAlpaca, obtenerNoticiasGenerales, type NoticiaCruda } from "./fuentes/alpaca";
import { obtenerNoticiasDeTema, temaDeLaCorrida, type NoticiaGlobalCruda } from "./fuentes/gdelt";
import { mensajeDeError } from "./fuentes/http";
import { llamarGeminiJson } from "./gemini";
import { costoLlamadaUsd, evaluarPresupuesto, inicioDeMesUtc } from "./presupuesto";
import { temaPorPalabrasClave } from "./temas";

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
  // Flujo general de mercado (sin filtrar por ticker): se queda solo con lo que toca un tema global.
  generales?: NoticiaCruda[];
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
  for (const noticia of params.generales ?? []) {
    if (filas.has(noticia.url)) continue;
    // Las que nombran tickers del universo ya entran como noticias de empresa.
    if (elegirTickers(noticia.tickers, params.universo).ticker) continue;
    const tema = temaPorPalabrasClave(noticia.titular);
    if (!tema) continue;
    filas.set(noticia.url, {
      fuente: noticia.fuente,
      ticker: null,
      tickers: [],
      tema,
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

export type ResultadoRecoleccion = { nuevas: number; vistas: number; errores: Array<{ fuente: string; error: string }> };

// Deduplica por URL: una noticia ya vista no se vuelve a insertar ni a resumir.
async function guardarFilas(supabase: SupabaseClient, filas: FilaNoticia[]): Promise<number> {
  if (filas.length === 0) return 0;
  const { data, error } = await supabase
    .from("lab_noticias")
    .upsert(filas, { onConflict: "url", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`No pude guardar las noticias: ${error.message}`);
  return data?.length ?? 0;
}

// Noticias de Alpaca: por empresa del universo (últimas 6 h) y el flujo general de mercado filtrado
// por los temas globales (últimas 3 h). Cada flujo falla por separado.
export async function recolectarNoticiasAlpaca(supabase: SupabaseClient, universo: string[]): Promise<ResultadoRecoleccion> {
  const errores: ResultadoRecoleccion["errores"] = [];
  const ahora = Date.now();
  const [empresa, generales] = await Promise.allSettled([
    obtenerNoticiasAlpaca(universo, new Date(ahora - 6 * 3_600_000)),
    obtenerNoticiasGenerales(new Date(ahora - 3 * 3_600_000)),
  ]);
  if (empresa.status === "rejected") errores.push({ fuente: "alpaca-empresas", error: mensajeDeError(empresa.reason) });
  if (generales.status === "rejected") errores.push({ fuente: "alpaca-generales", error: mensajeDeError(generales.reason) });
  const filas = filasDeNoticias({
    empresa: empresa.status === "fulfilled" ? empresa.value : [],
    generales: generales.status === "fulfilled" ? generales.value : [],
    globales: [],
    universo,
  });
  try {
    return { nuevas: await guardarFilas(supabase, filas), vistas: filas.length, errores };
  } catch (error) {
    return { nuevas: 0, vistas: filas.length, errores: [...errores, { fuente: "base-de-datos", error: mensajeDeError(error) }] };
  }
}

// Noticias globales (GDELT): el tema que le toca a esta corrida.
export async function recolectarNoticiasGlobales(
  supabase: SupabaseClient,
  universo: string[],
  ahora: Date = new Date()
): Promise<ResultadoRecoleccion & { tema: string }> {
  const tema = temaDeLaCorrida(ahora);
  try {
    const globales = await obtenerNoticiasDeTema(tema);
    const filas = filasDeNoticias({ empresa: [], globales, universo });
    return { tema: tema.tema, nuevas: await guardarFilas(supabase, filas), vistas: filas.length, errores: [] };
  } catch (error) {
    return { tema: tema.tema, nuevas: 0, vistas: 0, errores: [{ fuente: `gdelt:${tema.tema}`, error: mensajeDeError(error) }] };
  }
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
