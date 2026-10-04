import { fetchConTimeout } from "./http";

// GDELT DOC 2.0: gratis y sin key, cubre medios de todo el mundo. No publica un límite fijo, pide
// no pasarse de ~1 pedido cada 5 segundos, y en la práctica tarda 20-40 s por pedido y a veces
// responde 429 o corta por timeout (verificado el 2026-10-04). Por eso cada corrida consulta UN
// solo tema, rotando, y no los siete en serie.
const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
export const MINUTOS_POR_TEMA = 10;

export type TemaGlobal = { tema: string; consulta: string };

export const TEMAS_GLOBALES: TemaGlobal[] = [
  { tema: "fed", consulta: '("Federal Reserve" OR "Fed rate" OR "interest rates") sourcelang:english' },
  { tema: "inflacion", consulta: '(inflation OR "consumer prices" OR CPI) sourcelang:english' },
  { tema: "guerra", consulta: '(war OR invasion OR missile OR ceasefire) sourcelang:english' },
  { tema: "petroleo", consulta: '("oil prices" OR OPEC OR "crude oil") sourcelang:english' },
  { tema: "china", consulta: '("China economy" OR "China tariffs" OR "Chinese stocks") sourcelang:english' },
  { tema: "elecciones_eeuu", consulta: '("US election" OR "presidential campaign" OR "U.S. Congress") sourcelang:english' },
  { tema: "argentina", consulta: '(Milei OR "Argentina economy" OR "Argentine peso")' },
];

export type NoticiaGlobalCruda = { tema: string; titular: string; url: string; publicadoAt: string; dominio: string | null };

type ArticuloGdelt = { url?: string; title?: string; seendate?: string; domain?: string };

// "20261003T121500Z" -> ISO
export function fechaGdeltAIso(valor: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(valor);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

export function parsearArticulos(tema: string, articulos: ArticuloGdelt[]): NoticiaGlobalCruda[] {
  return articulos.flatMap((articulo) => {
    const publicadoAt = articulo.seendate ? fechaGdeltAIso(articulo.seendate) : null;
    if (!articulo.url || !articulo.title || !publicadoAt) return [];
    return [{ tema, titular: articulo.title.trim(), url: articulo.url, publicadoAt, dominio: articulo.domain ?? null }];
  });
}

// Tema que le toca a esta corrida: rota cada MINUTOS_POR_TEMA, así los 7 temas se refrescan cada ~70 min.
export function temaDeLaCorrida(ahora: Date): TemaGlobal {
  const turno = Math.floor(ahora.getTime() / (MINUTOS_POR_TEMA * 60_000));
  return TEMAS_GLOBALES[turno % TEMAS_GLOBALES.length];
}

export async function obtenerNoticiasDeTema(
  { tema, consulta }: TemaGlobal,
  opciones: { maxRegistros?: number; ventana?: string; timeoutMs?: number } = {}
): Promise<NoticiaGlobalCruda[]> {
  const { maxRegistros = 10, ventana = "3h", timeoutMs = 50_000 } = opciones;
  const params = new URLSearchParams({
    query: consulta,
    mode: "artlist",
    format: "json",
    maxrecords: String(maxRegistros),
    timespan: ventana,
    sort: "hybridrel",
  });
  const respuesta = await fetchConTimeout(`${GDELT_URL}?${params}`, {}, timeoutMs);
  if (!respuesta.ok) throw new Error(`GDELT respondió HTTP ${respuesta.status}`);
  const texto = await respuesta.text();
  // Sin resultados devuelve `{}`; con una consulta inválida, texto plano en vez de JSON.
  if (!texto.trim().startsWith("{")) {
    if (!texto.trim()) return [];
    throw new Error(`GDELT: ${texto.trim().slice(0, 120)}`);
  }
  const data = JSON.parse(texto) as { articles?: ArticuloGdelt[] };
  return parsearArticulos(tema, data.articles ?? []);
}
