// Temas globales del laboratorio (SIMULADO) y su asignación por palabras clave. Función pura:
// la usan las noticias generales de Alpaca, que no vienen etiquetadas por tema (GDELT sí).
const PATRONES_TEMA: Array<{ tema: string; patron: RegExp }> = [
  { tema: "fed", patron: /\b(fed|federal reserve|fomc|powell|rate (hike|cut)s?|interest rates?)\b/i },
  { tema: "inflacion", patron: /\b(inflation|cpi|ppi|pce|consumer prices)\b/i },
  { tema: "petroleo", patron: /\b(oil|crude|opec|brent|wti)\b/i },
  { tema: "china", patron: /\b(china|chinese|beijing|tariffs?)\b/i },
  { tema: "guerra", patron: /\b(war|invasion|missiles?|ceasefire|airstrikes?|troops)\b/i },
  { tema: "elecciones_eeuu", patron: /\b(election|elections|congress|senate|white house|government shutdown)\b/i },
  { tema: "argentina", patron: /\b(argentina|argentine|milei)\b/i },
];

// Notas de analistas sobre una empresa ("Maintains Buy on Magnolia Oil & Gas") no son noticias de tema.
const EXCLUIR = /\b(price target|maintains|reiterates|initiates coverage|upgrades|downgrades|rating)\b/i;

export function temaPorPalabrasClave(titular: string): string | null {
  if (EXCLUIR.test(titular)) return null;
  return PATRONES_TEMA.find(({ patron }) => patron.test(titular))?.tema ?? null;
}
