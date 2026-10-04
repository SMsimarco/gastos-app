// Decisión de los bots del laboratorio (SIMULADO). La IA SÍ decide acá, porque ese es el experimento, pero
// el código pone los límites: lo que devuelve se valida estrictamente y después pasa por el gestor de
// riesgo antes de ejecutar nada. Funciones puras (el pedido a Gemini vive en ejecutar.ts).
import type { Accion, Confianza, Propuesta } from "./riesgo";

export const ESTRATEGIA_DEFAULT =
  "Inversor paciente de mediano plazo. Buscás superar a VOO con pocas operaciones: comprás cuando varios datos apuntan en la misma dirección y vendés cuando cambia la tesis o necesitás reducir riesgo. Preferís diversificar entre varias posiciones antes que concentrar. Si no hay una razón clara, no operás.";

// Los tres bots arrancan con la misma estrategia: lo único que cambia es la información que reciben.
export const BOTS_POR_DEFECTO = [
  { clave: "A", nombre: "Bot A: completo y reactivo", perfil_info: "completo", reactivo: true, alpaca_cuenta: "A" },
  { clave: "B", nombre: "Bot B: completo, una vez por día", perfil_info: "completo", reactivo: false, alpaca_cuenta: "B" },
  { clave: "C", nombre: "Bot C: solo precios", perfil_info: "solo_precios", reactivo: false, alpaca_cuenta: "C" },
] as const;

export const DECISION_SCHEMA = {
  type: "OBJECT",
  properties: {
    acciones: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          ticker: { type: "STRING" },
          accion: { type: "STRING", enum: ["comprar", "vender", "mantener"] },
          monto_usd: { type: "NUMBER" },
          razon: { type: "STRING" },
          confianza: { type: "STRING", enum: ["alta", "media", "baja"] },
        },
        required: ["ticker", "accion", "monto_usd", "razon", "confianza"],
      },
    },
    resumen_mercado: { type: "STRING" },
  },
  required: ["acciones", "resumen_mercado"],
};

export function construirPromptDecision(briefing: Record<string, unknown>, estrategia: string): string {
  return `Sos un bot de un experimento de inversión SIMULADO: paper trading con plata ficticia (US$1.000 de capital). Tu objetivo es superar a comprar VOO y no hacer nada, DESPUÉS de descontar lo que cuesta cada decisión tuya con IA. Respondé en español rioplatense.

ESTRATEGIA: ${estrategia}

Reglas:
- Decidí SOLO con los datos del briefing. No inventes datos, precios, noticias ni causas.
- "Mantener todo" es una respuesta válida y muchas veces la mejor: operar de más tiene costo y riesgo. Si no hay una razón clara, devolvé una lista vacía de acciones o acciones "mantener".
- Solo podés operar tickers de "universo". Sin margen, sin ventas en corto y sin apalancamiento.
- Los montos son en dólares. Respetá los "limites": el sistema los hace cumplir y recorta todo lo que se pase.
- Las compras no pueden usar el efectivo de ventas del mismo día.
- No hagas cuentas: los porcentajes, medias y rendimientos ya vienen calculados.
- "razon": una o dos frases que citen los datos concretos del briefing en los que te basás.

Devolvé "acciones" (lista de {ticker, accion: comprar|vender|mantener, monto_usd, razon, confianza: alta|media|baja}) y "resumen_mercado" (2 a 3 líneas sobre cómo ves el mercado hoy).

BRIEFING:
${JSON.stringify(briefing)}`;
}

export type DecisionIA = { propuestas: Propuesta[]; resumenMercado: string; descartadasPorExceso: number };

const MAX_ACCIONES = 10;
const ACCIONES: Accion[] = ["comprar", "vender", "mantener"];
const CONFIANZAS: Confianza[] = ["alta", "media", "baja"];

// Valida lo que devolvió la IA. Una respuesta que no es un objeto, o sin lista de acciones, es inválida
// (null); una lista vacía es válida: significa "mantener todo".
export function normalizarDecision(respuesta: unknown): DecisionIA | null {
  if (!respuesta || typeof respuesta !== "object") return null;
  const objeto = respuesta as Record<string, unknown>;
  if (!Array.isArray(objeto.acciones)) return null;

  const propuestas: Propuesta[] = [];
  for (const item of objeto.acciones as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const fila = item as Record<string, unknown>;
    const ticker = typeof fila.ticker === "string" ? fila.ticker.trim().toUpperCase() : "";
    const accion = ACCIONES.find((valor) => valor === fila.accion);
    if (!ticker || !accion) continue;
    const monto = Number(fila.monto_usd);
    propuestas.push({
      ticker,
      accion,
      montoUsd: Number.isFinite(monto) && monto > 0 ? Math.round(monto * 100) / 100 : 0,
      razon: typeof fila.razon === "string" ? fila.razon.trim().slice(0, 500) : "",
      confianza: CONFIANZAS.find((valor) => valor === fila.confianza) ?? "baja",
    });
  }
  return {
    propuestas: propuestas.slice(0, MAX_ACCIONES),
    descartadasPorExceso: Math.max(0, propuestas.length - MAX_ACCIONES),
    resumenMercado: typeof objeto.resumen_mercado === "string" ? objeto.resumen_mercado.trim().slice(0, 700) : "",
  };
}
