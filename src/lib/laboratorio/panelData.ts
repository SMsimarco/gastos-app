import type { SupabaseClient } from "@supabase/supabase-js";
import { ETFS_UNIVERSO, UNIVERSO_DEFAULT, fechaNuevaYork } from "./config";
import { armarComparacion, type ComparacionPanel } from "./bots/comparacion";
import { armarPresupuestoPanel, type PresupuestoPanel, type SnapshotGrafico } from "./bots/grafico";
import { DIAS_EXPERIMENTO, armarPanelBots, type LaboratorioBotsPanel } from "./bots/panelBots";
import { inicioDeMesUtc } from "./presupuesto";
import { EVENTOS } from "./eventos";
import { armarSenales, type EstadisticaDB, type SenalConMemoria } from "./memoria";
import {
  armarFundamentales,
  resumirMacro,
  SERIES_PANEL,
  ultimaEjecucionPorTarea,
  variacionDelDia,
  type EstadoFuente,
  type FilaFundamentalPanel,
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

export type EventoCalendarioPanel = { id: string; tipo: "balance" | "fed" | "macro" | "dividendo"; ticker: string | null; fecha: string; detalle: Record<string, unknown> };

export type DiarioPanel = { fecha: string; resumen: string; puntos_clave: string[]; a_mirar: string[]; tono: string };

export type EstadisticaPanel = {
  evento: string;
  etiqueta: string;
  horizonte: number;
  n: number;
  media: number | null;
  mediana: number | null;
  pctPositivo: number | null;
  mediaBase: number | null;
};

export type AprendizajePanel = {
  diario: DiarioPanel[];
  senales: SenalConMemoria[];
  fechaSenales: string | null;
  estadisticas: EstadisticaPanel[];
  historia: { desde: string; hasta: string } | null;
};

export type FilingPanel = { id: string; ticker: string; fecha: string; formulario: string; descripcion: string | null; url: string };

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
  fundamentales: FilaFundamentalPanel[];
  filings: FilingPanel[];
  aprendizaje: AprendizajePanel;
  bots: LaboratorioBotsPanel;
  comparacion: ComparacionPanel;
  grafico: { snapshots: SnapshotGrafico[]; botsPorId: Record<string, "A" | "B" | "C"> };
  presupuesto: PresupuestoPanel;
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
  const idsMacro = SERIES_PANEL.map((serie) => serie.id);
  const empresas = universo.filter((ticker) => !ETFS_UNIVERSO.has(ticker));
  const hace90Dias = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

  const [precios, indicadores, macro, noticias, calendario, eventos, ejecuciones, fundamentales, analistas, sorpresas, insiders, filings, diario, estadisticas, senales, configBots, filasBots, snapshotsBots, corridasBots, leccionesBots, cierresBots, operacionesBots, costosMes] = await Promise.all([
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
    supabase.from("lab_fundamentales").select("ticker, fecha, datos").in("ticker", empresas).order("fecha", { ascending: false }).limit(empresas.length * 3),
    supabase.from("lab_analistas").select("ticker, periodo, strong_buy, buy, hold, sell, strong_sell").in("ticker", empresas).order("periodo", { ascending: false }).limit(empresas.length * 4),
    supabase.from("lab_sorpresas").select("ticker, periodo, sorpresa_pct").in("ticker", empresas).order("periodo", { ascending: false }).limit(empresas.length * 4),
    supabase.from("lab_insiders").select("ticker, codigo, fecha_transaccion, cambio_acciones").in("ticker", empresas).gte("fecha_transaccion", hace90Dias).limit(2000),
    supabase.from("lab_filings").select("id, ticker, fecha, formulario, descripcion, url").order("fecha", { ascending: false }).limit(15),
    supabase.from("lab_diario").select("fecha, resumen, puntos_clave, a_mirar, tono").order("fecha", { ascending: false }).limit(5),
    supabase.from("lab_estadisticas").select("evento, ticker, horizonte, n, media, mediana, pct_positivo, media_base, desde, hasta").limit(1000),
    supabase.from("lab_senales").select("ticker, fecha, evento").order("fecha", { ascending: false }).limit(60),
    supabase.from("lab_config").select("activo, fecha_inicio, capital_inicial_usd, max_costo_ia_mensual_usd").eq("usuario_id", usuarioId).maybeSingle(),
    supabase.from("lab_bots").select("id, clave, nombre, perfil_info, reactivo, pausado, motivo_pausa").eq("usuario_id", usuarioId),
    supabase.from("lab_snapshots").select("bot_id, ts, tipo, valor_usd, efectivo_usd, costo_ia_acumulado_usd, posiciones").eq("usuario_id", usuarioId).order("ts", { ascending: false }).limit(400),
    supabase.from("lab_corridas").select("id, bot_id, ts, estado, disparador, modelo, error, respuesta_ia").eq("usuario_id", usuarioId).order("ts", { ascending: false }).limit(40),
    supabase.from("lab_lecciones").select("bot_id, fecha_decision, ticker, accion, resultado_pct, voo_pct, veredicto, leccion").eq("usuario_id", usuarioId).order("creada_at", { ascending: false }).limit(30),
    supabase.from("lab_snapshots").select("bot_id, ts, valor_usd").eq("usuario_id", usuarioId).eq("tipo", "cierre").order("ts", { ascending: true }).limit(3000),
    supabase.from("lab_decisiones").select("bot_id, accion, ticker, precio_ejecucion, estado_orden").eq("usuario_id", usuarioId).not("orden_alpaca_id", "is", null).in("accion", ["comprar", "vender"]).limit(2000),
    supabase.from("lab_costos_ia").select("tipo, costo_usd, detalle").gte("ts", inicioDeMesUtc(new Date())).limit(5000),
  ]);

  // Decisiones de las corridas recientes (el diario de cada bot muestra las últimas).
  const idsCorridas = (corridasBots.data ?? []).map((corrida) => corrida.id as string);
  const { data: decisionesBots } = idsCorridas.length > 0
    ? await supabase.from("lab_decisiones").select("corrida_id, ticker, accion, monto_propuesto_usd, monto_aprobado_usd, razon_ia, ajuste_riesgo, estado_orden, precio_ejecucion").eq("usuario_id", usuarioId).in("corrida_id", idsCorridas)
    : { data: [] };


  // Estadísticas: todo el universo ('*') para la tabla, y las filas completas para ligar cada señal de hoy.
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
  const ordenEventos = Object.keys(EVENTOS);
  const estadisticasUniverso: EstadisticaPanel[] = filasEstadisticas
    .filter((fila) => fila.ticker === "*" && fila.horizonte !== 1)
    .sort((a, b) => ordenEventos.indexOf(a.evento) - ordenEventos.indexOf(b.evento) || a.horizonte - b.horizonte)
    .map((fila) => ({ evento: fila.evento, etiqueta: EVENTOS[fila.evento] ?? fila.evento, horizonte: fila.horizonte, n: fila.n, media: fila.media, mediana: fila.mediana, pctPositivo: fila.pct_positivo, mediaBase: fila.media_base }));
  const fechaSenales = (senales.data ?? [])[0]?.fecha as string | undefined;
  const senalesDeHoy = (senales.data ?? []).filter((fila) => fila.fecha === fechaSenales).map((fila) => ({ ticker: fila.ticker as string, evento: fila.evento as string }));
  const historia = (estadisticas.data ?? [])[0] ? { desde: String((estadisticas.data ?? [])[0].desde), hasta: String((estadisticas.data ?? [])[0].hasta) } : null;

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

  // Comparación entre los bots y contra el benchmark VOO, con precios actuales del universo.
  const botsPorId: Record<string, "A" | "B" | "C"> = {};
  for (const fila of filasBots.data ?? []) botsPorId[fila.id as string] = fila.clave as "A" | "B" | "C";
  const preciosActuales: Record<string, number> = {};
  for (const [ticker, indicador] of ultimosIndicadores) preciosActuales[ticker] = indicador.cierre;
  for (const [ticker, intradia] of ultimoPrecio) preciosActuales[ticker] = intradia.valor;
  const capitalLab = Number((configBots.data as { capital_inicial_usd?: number } | null)?.capital_inicial_usd ?? 1_000);
  const comparacion = armarComparacion({
    capitalUsd: capitalLab,
    diasTotales: DIAS_EXPERIMENTO,
    bots: (filasBots.data ?? []).map((fila) => ({ id: fila.id as string, clave: fila.clave as "A" | "B" | "C", nombre: fila.nombre as string })),
    cierres: (cierresBots.data ?? []) as Array<{ bot_id: string | null; ts: string; valor_usd: number }>,
    ultimos: (snapshotsBots.data ?? []) as Array<{ bot_id: string | null; ts: string; valor_usd: number; costo_ia_acumulado_usd: number }>,
    operaciones: ((operacionesBots.data ?? []) as Array<{ bot_id: string; accion: string; ticker: string; precio_ejecucion: number | null; estado_orden: string }>).filter((fila) => !String(fila.estado_orden).startsWith("error")),
    precios: preciosActuales,
  });

  const topeIa = Number((configBots.data as { max_costo_ia_mensual_usd?: number } | null)?.max_costo_ia_mensual_usd ?? 10);
  const presupuesto = armarPresupuestoPanel({
    costos: (costosMes.data ?? []) as Array<{ tipo: string; costo_usd: number; detalle: Record<string, unknown> | null }>,
    topeUsd: topeIa,
    botsPorId,
  });
  // Para el gráfico se mandan los snapshots crudos (cierres e intradía) y la pantalla arma cada rango.
  const snapshotsGrafico: SnapshotGrafico[] = [
    ...((cierresBots.data ?? []) as Array<{ bot_id: string | null; ts: string; valor_usd: number }>).map((fila) => ({ bot_id: fila.bot_id, ts: fila.ts, tipo: "cierre" as const, valor_usd: Number(fila.valor_usd) })),
    ...((snapshotsBots.data ?? []) as Array<{ bot_id: string | null; ts: string; tipo: "intradia" | "cierre"; valor_usd: number }>).filter((fila) => fila.tipo === "intradia").map((fila) => ({ bot_id: fila.bot_id, ts: fila.ts, tipo: "intradia" as const, valor_usd: Number(fila.valor_usd) })),
  ];

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
    fundamentales: armarFundamentales({
      empresas,
      fundamentales: (fundamentales.data ?? []) as Array<{ ticker: string; fecha: string; datos: Record<string, number | null> }>,
      analistas: (analistas.data ?? []) as Array<{ ticker: string; periodo: string; strong_buy: number; buy: number; hold: number; sell: number; strong_sell: number }>,
      sorpresas: (sorpresas.data ?? []).map((fila) => ({ ticker: fila.ticker as string, periodo: fila.periodo as string, sorpresa_pct: fila.sorpresa_pct === null ? null : Number(fila.sorpresa_pct) })),
      insiders: (insiders.data ?? []).map((fila) => ({
        ticker: fila.ticker as string,
        codigo: fila.codigo as string,
        fecha_transaccion: fila.fecha_transaccion as string,
        cambio_acciones: Number(fila.cambio_acciones),
      })),
      hoy,
    }),
    filings: (filings.data ?? []) as FilingPanel[],
    comparacion,
    grafico: { snapshots: snapshotsGrafico, botsPorId },
    presupuesto,
    bots: armarPanelBots({
      config: configBots.data as { activo: boolean; fecha_inicio: string | null; capital_inicial_usd: number } | null,
      bots: (filasBots.data ?? []) as Parameters<typeof armarPanelBots>[0]["bots"],
      snapshots: (snapshotsBots.data ?? []) as Parameters<typeof armarPanelBots>[0]["snapshots"],
      corridas: (corridasBots.data ?? []) as Parameters<typeof armarPanelBots>[0]["corridas"],
      decisiones: (decisionesBots ?? []) as Parameters<typeof armarPanelBots>[0]["decisiones"],
      lecciones: (leccionesBots.data ?? []) as NonNullable<Parameters<typeof armarPanelBots>[0]["lecciones"]>,
      hoy,
    }),
    aprendizaje: {
      diario: (diario.data ?? []) as DiarioPanel[],
      senales: armarSenales(senalesDeHoy, filasEstadisticas),
      fechaSenales: fechaSenales ?? null,
      estadisticas: estadisticasUniverso,
      historia,
    },
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
