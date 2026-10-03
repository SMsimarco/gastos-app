import { esperar, fetchConTimeout, mensajeDeError } from "./http";

// GDELT DOC 2.0: gratis y sin key, cubre medios de todo el mundo. No publica un límite fijo,
// pero pide no pasarse de ~1 pedido cada 5 segundos, así que los temas van en serie.
const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
export const PAUSA_ENTRE_PEDIDOS_MS = 5_200;

export const TEMAS_GLOBALES: Array<{ tema: string; consulta: string }> = [
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

async function obtenerTema(tema: string, consulta: string, maxRegistros: number, ventana: string): Promise<NoticiaGlobalCruda[]> {
  const params = new URLSearchParams({
    query: consulta,
    mode: "artlist",
    format: "json",
    maxrecords: String(maxRegistros),
    timespan: ventana,
    sort: "hybridrel",
  });
  const respuesta = await fetchConTimeout(`${GDELT_URL}?${params}`);
  if (!respuesta.ok) throw new Error(`GDELT respondió HTTP ${respuesta.status}`);
  const texto = await respuesta.text();
  // Cuando no hay resultados o la consulta es inválida, GDELT puede devolver texto plano en vez de JSON.
  if (!texto.trim().startsWith("{")) {
    if (!texto.trim()) return [];
    throw new Error(`GDELT: ${texto.trim().slice(0, 120)}`);
  }
  const data = JSON.parse(texto) as { articles?: ArticuloGdelt[] };
  return parsearArticulos(tema, data.articles ?? []);
}

// Recorre los temas en serie; si pasa el presupuesto de tiempo, corta y avisa cuáles quedaron afuera.
export async function obtenerNoticiasGlobales(opciones: { maxRegistros?: number; ventana?: string; tiempoMaxMs?: number } = {}) {
  const { maxRegistros = 6, ventana = "2h", tiempoMaxMs = 40_000 } = opciones;
  const inicio = Date.now();
  const noticias: NoticiaGlobalCruda[] = [];
  const errores: Array<{ tema: string; error: string }> = [];
  const omitidos: string[] = [];
  for (const [indice, { tema, consulta }] of TEMAS_GLOBALES.entries()) {
    if (Date.now() - inicio > tiempoMaxMs) {
      omitidos.push(tema);
      continue;
    }
    if (indice > 0) await esperar(PAUSA_ENTRE_PEDIDOS_MS);
    try {
      noticias.push(...(await obtenerTema(tema, consulta, maxRegistros, ventana)));
    } catch (error) {
      errores.push({ tema, error: mensajeDeError(error) });
    }
  }
  return { noticias, errores, omitidos };
}
