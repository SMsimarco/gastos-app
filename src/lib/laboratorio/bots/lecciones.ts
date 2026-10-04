// Lecciones de los bots del laboratorio (SIMULADO, capa 3 del aprendizaje). Funciones puras: el código mide
// el resultado de una decisión pasada (nada de esto lo calcula la IA) y la IA solo redacta qué se aprende,
// con una advertencia obligatoria: un solo caso de pocas ruedas puede ser suerte, no una regla.
import type { Barra } from "../indicadores";

export const HORIZONTE_LECCION = 5; // ruedas después de la decisión
export const UMBRAL_VEREDICTO_PCT = 1; // puntos de diferencia contra VOO para decir que acertó o erró

export type Veredicto = "acerto" | "erro" | "neutral";

export type Evaluacion = {
  fechaEvaluacion: string;
  resultadoPct: number; // lo que hizo el precio del ticker desde la ejecución hasta el horizonte
  vooPct: number; // VOO entre las mismas fechas
  excesoPct: number; // lo que aportó la decisión contra VOO
  veredicto: Veredicto;
};

const redondear = (valor: number) => Math.round(valor * 100) / 100;

// Mide una decisión ejecutada a `horizonte` ruedas. Devuelve null si todavía no pasaron esas ruedas o si
// faltan las barras necesarias (nunca se inventa un dato).
//  - Compra: aportó lo que el ticker rindió de más (o de menos) que VOO.
//  - Venta: aportó lo que VOO rindió de más que el ticker vendido (evitar una caída suma; perder una suba resta).
export function evaluarDecision(params: {
  accion: "comprar" | "vender";
  precioEjecucion: number;
  fechaDecision: string;
  barras: Barra[];
  barrasVoo: Barra[];
  horizonte?: number;
}): Evaluacion | null {
  const horizonte = params.horizonte ?? HORIZONTE_LECCION;
  const indice = params.barras.findIndex((barra) => barra.fecha >= params.fechaDecision);
  if (indice < 0 || params.barras[indice].fecha !== params.fechaDecision) return null;
  const final = params.barras[indice + horizonte];
  if (!final || !(params.precioEjecucion > 0)) return null;

  const baseVoo = params.barrasVoo.find((barra) => barra.fecha === params.fechaDecision);
  const finalVoo = params.barrasVoo.find((barra) => barra.fecha === final.fecha);
  if (!baseVoo || !finalVoo || !(baseVoo.cierre > 0)) return null;

  const resultadoPct = (final.cierre / params.precioEjecucion - 1) * 100;
  const vooPct = (finalVoo.cierre / baseVoo.cierre - 1) * 100;
  const excesoPct = params.accion === "comprar" ? resultadoPct - vooPct : vooPct - resultadoPct;
  return {
    fechaEvaluacion: final.fecha,
    resultadoPct: redondear(resultadoPct),
    vooPct: redondear(vooPct),
    excesoPct: redondear(excesoPct),
    veredicto: excesoPct >= UMBRAL_VEREDICTO_PCT ? "acerto" : excesoPct <= -UMBRAL_VEREDICTO_PCT ? "erro" : "neutral",
  };
}

export type CasoLeccion = {
  ticker: string;
  accion: "comprar" | "vender";
  fechaDecision: string;
  montoUsd: number;
  razonOriginal: string;
  horizonte: number;
  evaluacion: Evaluacion;
};

export const LECCIONES_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: { indice: { type: "INTEGER" }, leccion: { type: "STRING" } },
    required: ["indice", "leccion"],
  },
};

export function construirPromptLecciones(casos: CasoLeccion[]): string {
  const items = casos.map((caso, indice) => ({
    indice,
    ticker: caso.ticker,
    accion: caso.accion,
    fecha_decision: caso.fechaDecision,
    monto_usd: caso.montoUsd,
    razon_original: caso.razonOriginal,
    ruedas_transcurridas: caso.horizonte,
    el_ticker_rindio_pct: caso.evaluacion.resultadoPct,
    voo_rindio_pct: caso.evaluacion.vooPct,
    aporte_de_la_decision_vs_voo_pct: caso.evaluacion.excesoPct,
    veredicto: caso.evaluacion.veredicto,
  }));
  return `Sos un bot de un experimento de inversión SIMULADO (paper trading) que revisa decisiones suyas del pasado para aprender. Respondé en español rioplatense.

Para CADA caso escribí una lección de 1 a 2 frases (máximo 300 caracteres) con: qué esperabas (la razón original), qué pasó (con los números que te doy, sin cambiarlos) y qué conviene ajustar o repetir.

Reglas:
- Es UN solo caso de pocas ruedas: puede ser suerte o mala suerte. No lo presentes como una regla general ni exageres: usá expresiones como "en este caso" o "habrá que ver si se repite".
- No inventes causas ni datos que no estén en el caso. Si el veredicto es "neutral", decí que no hubo diferencia relevante contra VOO.
- En una compra, aportó lo que el ticker rindió de más o de menos que VOO. En una venta, aportó lo que VOO rindió de más que el ticker vendido (evitar una caída suma; perderse una suba resta).
- No hagas cuentas nuevas: los porcentajes ya vienen calculados.

Casos:
${JSON.stringify(items)}`;
}

// Valida lo que devolvió la IA: descarta índices desconocidos y textos vacíos, y acota el largo.
export function normalizarLecciones(respuesta: unknown, cantidad: number): Map<number, string> {
  const resultado = new Map<number, string>();
  if (!Array.isArray(respuesta)) return resultado;
  for (const item of respuesta as Array<Record<string, unknown>>) {
    const indice = Number(item?.indice);
    if (!Number.isInteger(indice) || indice < 0 || indice >= cantidad || resultado.has(indice)) continue;
    if (typeof item.leccion !== "string" || !item.leccion.trim()) continue;
    resultado.set(indice, item.leccion.trim().slice(0, 400));
  }
  return resultado;
}
