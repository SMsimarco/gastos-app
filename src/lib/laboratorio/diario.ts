// Diario de mercado del laboratorio (SIMULADO). La IA escribe una nota por rueda, pero SOLO con
// hechos que arma el código: movimientos, macro, noticias, calendario y señales ya calculados. La IA
// interpreta y resume; no calcula ni trae datos propios.
import { EVENTOS } from "./eventos";
import type { FilaMacroPanel } from "./panel";

export type HechosDelDia = {
  fecha: string;
  mercado: Array<{ ticker: string; cierre: number; variacion_dia: number | null; rsi14: number | null; distancia_max52s: number | null; volumen_relativo: number | null }>;
  macro: Array<{ nombre: string; valor: string; variacion: string; al: string }>;
  noticias: Array<{ texto: string; sentimiento: number | null; relevancia: number | null; tickers: string[]; tema: string | null }>;
  eventos_del_monitor: Array<{ tipo: string; ticker: string | null; detalle: Record<string, unknown> }>;
  presentaciones_sec: Array<{ ticker: string; formulario: string; descripcion: string | null; fecha: string }>;
  calendario_proximos_7_dias: Array<{ fecha: string; descripcion: string }>;
  senales_de_hoy: Array<{ ticker: string; evento: string }>;
};

type EntradaHechos = {
  fecha: string;
  indicadores: Array<{ ticker: string; cierre: number; variacion_dia: number | null; rsi14: number | null; distancia_max52s: number | null; volumen_relativo: number | null }>;
  macro: FilaMacroPanel[];
  noticias: Array<{ resumen: string | null; titular: string; sentimiento: number | null; relevancia: number | null; tickers: string[]; tema: string | null }>;
  eventos: Array<{ tipo: string; ticker: string | null; detalle: Record<string, unknown> }>;
  filings: Array<{ ticker: string; formulario: string; descripcion: string | null; fecha: string }>;
  calendario: Array<{ fecha: string; tipo: string; ticker: string | null; detalle: Record<string, unknown> }>;
  senales: Array<{ ticker: string; evento: string }>;
};

function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

export function descripcionCalendario(evento: EntradaHechos["calendario"][number]): string {
  switch (evento.tipo) {
    case "fed":
      return "Reunión de la Fed (decisión de tasas)";
    case "macro":
      return String(evento.detalle.descripcion ?? "Publicación macro de EE.UU.");
    case "dividendo":
      return `Fecha ex-dividendo de ${evento.ticker}`;
    default:
      return `Balance de ${evento.ticker}`;
  }
}

export function formatoMacro(fila: FilaMacroPanel): { nombre: string; valor: string; variacion: string; al: string } {
  const unidad = fila.unidad === "%" ? "%" : fila.unidad === "pb" ? " pb" : "";
  const variacion =
    fila.variacion === null
      ? "sin dato previo"
      : fila.tipoVariacion === "pct"
        ? `${fila.variacion > 0 ? "+" : ""}${fila.variacion}%`
        : fila.tipoVariacion === "interanual"
          ? `${fila.variacion}% interanual`
          : `${fila.variacion > 0 ? "+" : ""}${fila.variacion} ${fila.unidad === "pb" ? "pb" : "pp"}`;
  return { nombre: fila.nombre, valor: `${fila.valor}${unidad}`, variacion, al: fila.fecha };
}

// Todo con topes de cantidad: el diario no puede inflar tokens.
export function armarHechos(entrada: EntradaHechos): HechosDelDia {
  const referencia = ["VOO", "QQQ"];
  const porMovimiento = [...entrada.indicadores].sort((a, b) => Math.abs(b.variacion_dia ?? 0) - Math.abs(a.variacion_dia ?? 0));
  const elegidos = new Map(porMovimiento.slice(0, 8).map((fila) => [fila.ticker, fila]));
  for (const ticker of referencia) {
    const fila = entrada.indicadores.find((item) => item.ticker === ticker);
    if (fila) elegidos.set(ticker, fila);
  }
  const hasta = sumarDias(entrada.fecha, 7);
  const recientes = sumarDias(entrada.fecha, -4);

  return {
    fecha: entrada.fecha,
    mercado: [...elegidos.values()],
    macro: entrada.macro.filter((fila) => fila.fecha >= recientes).map(formatoMacro),
    noticias: [...entrada.noticias]
      .sort((a, b) => (b.relevancia ?? 0) - (a.relevancia ?? 0))
      .slice(0, 10)
      .map((noticia) => ({ texto: noticia.resumen ?? noticia.titular, sentimiento: noticia.sentimiento, relevancia: noticia.relevancia, tickers: noticia.tickers, tema: noticia.tema })),
    eventos_del_monitor: entrada.eventos.slice(0, 8),
    presentaciones_sec: entrada.filings.slice(0, 8),
    calendario_proximos_7_dias: entrada.calendario
      .filter((evento) => evento.fecha >= entrada.fecha && evento.fecha <= hasta)
      .slice(0, 12)
      .map((evento) => ({ fecha: evento.fecha, descripcion: descripcionCalendario(evento) })),
    senales_de_hoy: entrada.senales.map((senal) => ({ ticker: senal.ticker, evento: EVENTOS[senal.evento] ?? senal.evento })),
  };
}

export const DIARIO_SCHEMA = {
  type: "OBJECT",
  properties: {
    resumen: { type: "STRING" },
    puntos_clave: { type: "ARRAY", items: { type: "STRING" } },
    a_mirar: { type: "ARRAY", items: { type: "STRING" } },
    tono: { type: "STRING", enum: ["positivo", "neutral", "negativo", "mixto"] },
  },
  required: ["resumen", "puntos_clave", "a_mirar", "tono"],
};

export function construirPromptDiario(hechos: HechosDelDia): string {
  return `Sos el analista de un laboratorio de inversión SIMULADO (plata ficticia). Escribí el diario de mercado de la rueda del ${hechos.fecha}, en español rioplatense, para que lo lean los bots y el dueño del laboratorio.

Reglas:
- Usá SOLO los datos de abajo. No inventes cifras, precios, causas ni noticias.
- Podés conectar hechos (por ejemplo una suba de un ticker con una noticia que lo nombra), pero si los datos no explican un movimiento, decí "sin causa clara en los datos".
- No des recomendaciones de compra o venta ni predicciones: describí qué pasó y qué conviene mirar.
- No calcules: los números ya vienen hechos.

Devolvé:
- resumen: 4 a 7 líneas, máximo 900 caracteres.
- puntos_clave: de 3 a 5 frases cortas (máximo 160 caracteres cada una).
- a_mirar: de 0 a 3 cosas concretas para los próximos días, tomadas del calendario o de las señales.
- tono: positivo, neutral, negativo o mixto, según cómo se comportó el mercado.

Datos de la rueda:
${JSON.stringify(hechos)}`;
}

export type DiarioGenerado = { resumen: string; puntos_clave: string[]; a_mirar: string[]; tono: "positivo" | "neutral" | "negativo" | "mixto" };

function listaDeTextos(valor: unknown, maximo: number, largo: number): string[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, maximo)
    .map((item) => item.trim().slice(0, largo));
}

// Valida lo que devolvió la IA: acota largos y cantidades, y rechaza una respuesta sin resumen.
export function normalizarDiario(respuesta: unknown): DiarioGenerado | null {
  if (!respuesta || typeof respuesta !== "object") return null;
  const objeto = respuesta as Record<string, unknown>;
  if (typeof objeto.resumen !== "string" || !objeto.resumen.trim()) return null;
  const tonos = ["positivo", "neutral", "negativo", "mixto"] as const;
  return {
    resumen: objeto.resumen.trim().slice(0, 1_200),
    puntos_clave: listaDeTextos(objeto.puntos_clave, 5, 220),
    a_mirar: listaDeTextos(objeto.a_mirar, 3, 220),
    tono: tonos.find((tono) => tono === objeto.tono) ?? "neutral",
  };
}
