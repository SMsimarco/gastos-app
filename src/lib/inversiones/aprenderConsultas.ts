// Consultas sobre aprender ("¿qué hago con lo de aprender?", "¿por qué me sugerís MSFT?", "¿por qué no NVDA?",
// "¿qué tiene que pasar para que compre KO?"). Se detectan por palabras clave antes del flujo normal de consultas de
// inversiones; el código arma los hechos con las mismas fichas de aprender.ts y Gemini solo redacta.
import type { SupabaseClient } from "@supabase/supabase-js";
import { explicarTicker, type ResultadoAprender } from "./aprender";
import { obtenerPanelAprender } from "./aprenderPanel";
import { redactarConIA } from "./aprenderRedaccion";
import { redactarAvisoAprender, redactarFaltaAprender, redactarNoEstaEnLista, redactarPorQueNo, redactarPorQueSugerido } from "./aprenderTextos";
import { DISCLAIMER_FINANCIERO } from "./avisos";

export type ConsultaAprender = { tipo: "estado" } | { tipo: "por_que" | "por_que_no" | "que_pasa"; ticker: string };

const PALABRAS_QUE_NO_SON_TICKER = new Set(["VOO", "USD", "ARS", "ARQ", "MEP", "ETF", "IA", "EL", "LA", "SI", "NO", "ME", "TE"]);

function buscarTicker(pregunta: string, tickerExtraido?: string | null): string | null {
  if (tickerExtraido && /^[A-Za-z][A-Za-z0-9.]{0,9}$/.test(tickerExtraido)) return tickerExtraido.toUpperCase();
  const candidatos = [...pregunta.matchAll(/\b[A-Z][A-Z0-9.]{1,5}\b/g)].map((coincidencia) => coincidencia[0]).filter((token) => !PALABRAS_QUE_NO_SON_TICKER.has(token));
  return candidatos[0] ?? null;
}

// Devuelve null si la pregunta no es sobre aprender (sigue el flujo normal).
export function interpretarConsultaAprender(pregunta: string, tickerExtraido?: string | null): ConsultaAprender | null {
  const texto = pregunta.trim();
  const ticker = buscarTicker(texto, tickerExtraido);
  if (/qu[eé]\s+(tiene|tendr[ií]a|debe|deber[ií]a)\w*\s+(que\s+)?(pasar|cambiar|ocurrir)/i.test(texto) && ticker) return { tipo: "que_pasa", ticker };
  if (/por\s*qu[eé]\s+no\b/i.test(texto) && ticker) return { tipo: "por_que_no", ticker };
  if (/por\s*qu[eé].*(sugier|suger[ií]s|recomend|propon)/i.test(texto) && ticker) return { tipo: "por_que", ticker };
  if (/\baprender\b/i.test(texto)) return { tipo: "estado" };
  return null;
}

type Fichas = Pick<ResultadoAprender, "candidatos" | "excluidos">;

export function respuestaPorTicker(fichas: Fichas, tipo: "por_que" | "por_que_no" | "que_pasa", ticker: string): string {
  const explicacion = explicarTicker(fichas, ticker);
  if (explicacion.estado === "no_esta") return redactarNoEstaEnLista(ticker);
  if (explicacion.estado === "excluido") return redactarPorQueNo(ticker, explicacion.excluido);
  if (tipo === "por_que_no") return `${ticker} sí está entre las opciones de hoy, con ${Math.round(explicacion.candidato.puntaje)} puntos sobre 100.\n${redactarPorQueSugerido(explicacion.candidato)}`;
  if (tipo === "que_pasa") return `${ticker} ya es una de las opciones de hoy. Si querés evaluarlo igual que antes de comprar, acá está su ficha:\n${redactarPorQueSugerido(explicacion.candidato)}`;
  return redactarPorQueSugerido(explicacion.candidato);
}

export async function responderConsultaAprender(supabase: SupabaseClient, usuarioId: string, pregunta: string, tickerExtraido?: string | null): Promise<string | null> {
  const consulta = interpretarConsultaAprender(pregunta, tickerExtraido);
  if (!consulta) return null;
  const panel = await obtenerPanelAprender(supabase, usuarioId);
  const resultado: ResultadoAprender = { puedeComprar: panel.puedeComprar, saldoUsd: panel.saldoUsd, faltaUsd: panel.faltaUsd, candidatos: panel.candidatos, excluidos: panel.excluidos, voo: panel.voo, opcionEsperar: panel.opcionEsperar, alertas: panel.alertas, advertencias: panel.advertencias };

  // Bajo el mínimo no hay nada para elegir: solo se dice cuánto falta (sin IA, para que no agregue recomendaciones).
  if (!panel.puedeComprar) {
    const lineas = [redactarFaltaAprender(resultado).split("\n")[0]];
    if ("ticker" in consulta) lineas.push(`Por eso todavía no evalúo ${consulta.ticker}: cuando llegues al mínimo te muestro las opciones con su ficha.`);
    for (const alerta of panel.alertas) lineas.push(alerta.mensaje);
    lineas.push(DISCLAIMER_FINANCIERO);
    return lineas.join("\n");
  }

  let base: string;
  if (consulta.tipo === "estado") {
    const partes = [redactarAvisoAprender(resultado)];
    const rendimiento = panel.rendimiento;
    if (rendimiento && rendimiento.veredicto !== "sin_datos" && rendimiento.gananciaPct !== null && rendimiento.siVooPct !== null) {
      partes.splice(partes.length - 1, 0, `Hasta hoy aprender rinde ${rendimiento.gananciaPct >= 0 ? "+" : "−"}${Math.abs(Math.round(rendimiento.gananciaPct))}% y lo mismo puesto en VOO habría rendido ${rendimiento.siVooPct >= 0 ? "+" : "−"}${Math.abs(Math.round(rendimiento.siVooPct))}%.`);
    }
    for (const alerta of panel.alertas) partes.splice(partes.length - 1, 0, alerta.mensaje);
    base = partes.join("\n");
    return redactarConIA(base, { saldoUsd: Math.round(panel.saldoUsd), candidatos: panel.candidatos.map((c) => ({ ticker: c.ticker, puntaje: Math.round(c.puntaje), porQueSi: c.porQueSi, porQueNo: c.porQueNo, balanceEnDias: c.balanceEnDias })), opcionEsperar: panel.opcionEsperar.motivo, texto_base: base }, { maxLargo: 1500 });
  }
  base = respuestaPorTicker(resultado, consulta.tipo, consulta.ticker);
  // Las fichas ya traen todos los números y el descargo: Gemini no puede cambiarlas, así que se responden tal cual.
  return base.includes(DISCLAIMER_FINANCIERO) ? base : `${base}\n${DISCLAIMER_FINANCIERO}`;
}
