// Arma el EstadoAprender de un usuario leyendo (solo lectura) las tablas lab_* del laboratorio, su cartera y su
// historial de mediciones. No escribe nada y no usa las decisiones de los bots del laboratorio.
import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerContextoInversiones } from "./consultasInversiones";
import { PESOS_DEFAULT, type DatosMercado, type EstadoAprender, type NoticiaUsada, type PesosAprender } from "./aprender";
import { calcularHistorialCriterios, type ResultadoMedido } from "./aprenderHistorial";

const numero = (valor: unknown): number | null => (valor === null || valor === undefined || valor === "" || !Number.isFinite(Number(valor)) ? null : Number(valor));
const DIAS_NOTICIAS = 7;
const MAX_NOTICIAS_USADAS = 3;

type Fila = Record<string, unknown>;

function primeroPorTicker(filas: Fila[] | null, columnaOrden: string): Map<string, Fila> {
  const mapa = new Map<string, Fila>();
  for (const fila of [...(filas ?? [])].sort((a, b) => String(b[columnaOrden]).localeCompare(String(a[columnaOrden])))) {
    const ticker = String(fila.ticker);
    if (!mapa.has(ticker)) mapa.set(ticker, fila);
  }
  return mapa;
}

export function pesosDeConfig(config: Partial<Record<string, unknown>>): PesosAprender {
  const peso = (clave: string, defecto: number) => numero(config[clave]) ?? defecto;
  return { valuacion: peso("peso_valuacion", PESOS_DEFAULT.valuacion), momento: peso("peso_momento", PESOS_DEFAULT.momento), calidad: peso("peso_calidad", PESOS_DEFAULT.calidad), noticias: peso("peso_noticias", PESOS_DEFAULT.noticias) };
}

// Datos de mercado de un conjunto de tickers, desde el laboratorio. Los tickers que el laboratorio no sigue
// vuelven con todo en null (la evaluación los excluye por falta de precio).
export async function cargarDatosMercado(supabase: SupabaseClient, tickers: string[], hoy: string): Promise<Map<string, DatosMercado>> {
  const unicos = [...new Set(tickers)];
  const desdeNoticias = new Date(Date.parse(`${hoy}T00:00:00Z`) - DIAS_NOTICIAS * 86_400_000).toISOString();
  const [cierres, intradia, indicadores, fundamentales, noticias, balances, promedios] = await Promise.all([
    supabase.from("lab_precios").select("ticker, ts, precio").eq("tipo", "cierre").in("ticker", unicos).order("ts", { ascending: false }).limit(unicos.length * 3),
    supabase.from("lab_precios").select("ticker, ts, precio").eq("tipo", "intradia").in("ticker", unicos).order("ts", { ascending: false }).limit(unicos.length * 4),
    supabase.from("lab_indicadores").select("ticker, fecha, datos").in("ticker", unicos).order("fecha", { ascending: false }).limit(unicos.length * 3),
    supabase.from("lab_fundamentales").select("ticker, fecha, datos").in("ticker", unicos).order("fecha", { ascending: false }).limit(unicos.length * 3),
    supabase.from("lab_noticias").select("fuente, ticker, tickers, titular, url, publicado_at, sentimiento, relevancia").gte("publicado_at", desdeNoticias).order("publicado_at", { ascending: false }).limit(600),
    supabase.from("lab_eventos_calendario").select("ticker, fecha").eq("tipo", "balance").gte("fecha", hoy).in("ticker", unicos).order("fecha"),
    supabase.from("aprender_pe_promedio").select("ticker, promedio_5a, fecha").in("ticker", unicos),
  ]);

  const ultimoPrecio = primeroPorTicker([...(cierres.data ?? []), ...(intradia.data ?? [])], "ts");
  const ultimoIndicador = primeroPorTicker(indicadores.data, "fecha");
  const ultimoFundamental = primeroPorTicker(fundamentales.data, "fecha");
  const proximoBalance = new Map<string, string>();
  for (const balance of balances.data ?? []) if (balance.ticker && !proximoBalance.has(balance.ticker)) proximoBalance.set(balance.ticker, String(balance.fecha));
  const promedioPe = new Map((promedios.data ?? []).map((fila) => [String(fila.ticker), fila]));

  const resultado = new Map<string, DatosMercado>();
  for (const ticker of unicos) {
    const precio = ultimoPrecio.get(ticker);
    const indicador = ultimoIndicador.get(ticker);
    const indicadorDatos = (indicador?.datos ?? {}) as Fila;
    const fundamental = ultimoFundamental.get(ticker);
    const fundamentalDatos = (fundamental?.datos ?? {}) as Fila;
    const propias = (noticias.data ?? []).filter((noticia) => noticia.ticker === ticker || (Array.isArray(noticia.tickers) && noticia.tickers.includes(ticker)));
    const conSentimiento = propias.filter((noticia) => numero(noticia.sentimiento) !== null);
    const sentimiento = conSentimiento.length ? conSentimiento.reduce((total, noticia) => total + Number(noticia.sentimiento), 0) / conSentimiento.length : null;
    const usadas: NoticiaUsada[] = [...propias]
      .sort((a, b) => (numero(b.relevancia) ?? 0) - (numero(a.relevancia) ?? 0) || String(b.publicado_at).localeCompare(String(a.publicado_at)))
      .slice(0, MAX_NOTICIAS_USADAS)
      .map((noticia) => ({ titular: String(noticia.titular), url: String(noticia.url), fuente: String(noticia.fuente), publicadoAt: String(noticia.publicado_at) }));
    const pe = promedioPe.get(ticker);
    resultado.set(ticker, {
      ticker,
      precio: precio ? { valor: Number(precio.precio), fecha: String(precio.ts).slice(0, 10), fuente: "Alpaca" } : null,
      indicadores: indicador
        ? { fecha: String(indicador.fecha), cierre: numero(indicadorDatos.cierre), sma200: numero(indicadorDatos.sma200), distanciaMax52s: numero(indicadorDatos.distancia_max52s), volatilidad20: numero(indicadorDatos.volatilidad20) }
        : null,
      fundamentales: fundamental
        ? { fecha: String(fundamental.fecha), pe: numero(fundamentalDatos.pe), crecimientoIngresos: numero(fundamentalDatos.crecimiento_ingresos), margenNeto: numero(fundamentalDatos.margen_neto) }
        : null,
      peProm5a: pe ? { valor: Number(pe.promedio_5a), fecha: String(pe.fecha) } : null,
      noticias: { sentimiento: sentimiento === null ? null : Math.round(sentimiento * 100) / 100, cantidad: conSentimiento.length, usadas, fechaUltima: propias[0] ? String(propias[0].publicado_at).slice(0, 10) : null },
      proximoBalance: proximoBalance.get(ticker) ?? null,
    });
  }
  return resultado;
}

export async function cargarHistorialAprender(supabase: SupabaseClient, usuarioId: string) {
  const { data } = await supabase.from("aprender_resultados").select("ticker, semanas, gano_a_voo, aportes").eq("usuario_id", usuarioId);
  const resultados: ResultadoMedido[] = (data ?? []).map((fila) => ({ ticker: String(fila.ticker), semanas: Number(fila.semanas), ganoAVoo: Boolean(fila.gano_a_voo), aportes: (fila.aportes ?? {}) as ResultadoMedido["aportes"] }));
  return { resultados, porCriterio: calcularHistorialCriterios(resultados) };
}

export async function cargarEstadoAprender(supabase: SupabaseClient, usuarioId: string) {
  const contexto = await obtenerContextoInversiones(supabase, usuarioId);
  const hoy = contexto.estado.hoy;
  const activosAprender = contexto.activosPolitica.filter((activo) => activo.bolsillo_clave === "aprender" && activo.tipo !== "cuenta_remunerada");
  const tickers = [...activosAprender.map((activo) => activo.ticker), "VOO"];
  const [datos, historial] = await Promise.all([cargarDatosMercado(supabase, tickers, hoy), cargarHistorialAprender(supabase, usuarioId)]);
  const bolsilloAprender = contexto.bolsillos.find((bolsillo) => bolsillo.clave === "aprender");

  const estado: EstadoAprender = {
    hoy,
    saldoAprenderUsd: Number(bolsilloAprender?.saldo ?? 0),
    minimoCompraUsd: Number(contexto.config.minimo_compra_usd),
    pesos: pesosDeConfig(contexto.config as unknown as Record<string, unknown>),
    activos: activosAprender.map((activo) => {
      const rendimiento = contexto.cartera.activos.find((item) => item.id === activo.id);
      return {
        ticker: activo.ticker,
        tesis: activo.tesis ?? "",
        tomaGananciaPct: activo.toma_ganancia_pct === null ? null : Number(activo.toma_ganancia_pct),
        stopRevisionPct: activo.stop_revision_pct === null ? null : Number(activo.stop_revision_pct),
        gananciaPct: Number(rendimiento?.gananciaPct ?? 0),
        valorPosicionUsd: Number(rendimiento?.valorActualUsd ?? 0),
      };
    }),
    datos: Object.fromEntries(activosAprender.map((activo) => [activo.ticker, datos.get(activo.ticker)!])),
    voo: datos.get("VOO") ?? null,
    historial: historial.porCriterio,
  };
  return { estado, contexto, historial };
}
