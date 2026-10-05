// Validación de los activos de la lista de aprender (alta y edición). Pura y con tests: las rutas solo la llaman.
export type EntradaActivoAprender = { ticker?: unknown; tesis?: unknown; tomaGananciaPct?: unknown; stopRevisionPct?: unknown; nombre?: unknown };

export type ActivoAprenderValidado = { ticker: string; tesis: string; nombre: string; toma_ganancia_pct: number | null; stop_revision_pct: number | null };

export const MIN_LARGO_TESIS = 15;
export const TESIS_PENDIENTE = "PENDIENTE: escribir mi tesis";

// Una tesis cargada con el texto de relleno todavía no es una tesis: la UI la marca hasta que se escriba la propia.
export const tesisPendiente = (tesis: string | null | undefined) => !tesis || tesis.trim().toUpperCase().startsWith("PENDIENTE");
const ETFS_CONOCIDOS = new Set(["VOO", "QQQ", "VTI", "SCHD", "SPY", "IVV"]);

export const tipoDeTicker = (ticker: string): "etf" | "accion" => (ETFS_CONOCIDOS.has(ticker) ? "etf" : "accion");

function porcentajeOpcional(valor: unknown, nombre: string): { valor: number | null; error?: string } {
  if (valor === null || valor === undefined || valor === "") return { valor: null };
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0 || numero > 1000) return { valor: null, error: `${nombre} debe ser un número mayor que 0` };
  return { valor: numero };
}

// `requerirTicker` es false al editar (el ticker no se cambia: se quita y se vuelve a agregar).
export function validarActivoAprender(entrada: EntradaActivoAprender, requerirTicker = true): { ok: true; datos: ActivoAprenderValidado } | { ok: false; error: string } {
  const ticker = typeof entrada.ticker === "string" ? entrada.ticker.trim().toUpperCase() : "";
  if (requerirTicker && !/^[A-Z][A-Z0-9.]{0,9}$/.test(ticker)) return { ok: false, error: "El ticker no es válido (por ejemplo MSFT o KO)" };
  const tesis = typeof entrada.tesis === "string" ? entrada.tesis.trim() : "";
  if (tesis.length < MIN_LARGO_TESIS || tesisPendiente(tesis)) return { ok: false, error: `Escribí tu tesis: por qué querés este activo (mínimo ${MIN_LARGO_TESIS} caracteres)` };
  const toma = porcentajeOpcional(entrada.tomaGananciaPct, "La toma de ganancia");
  if (toma.error) return { ok: false, error: toma.error };
  const stop = porcentajeOpcional(entrada.stopRevisionPct, "El umbral de revisión");
  if (stop.error) return { ok: false, error: stop.error };
  if (toma.valor === null && stop.valor === null) return { ok: false, error: "Definí al menos una toma de ganancia o un umbral de revisión" };
  const nombre = typeof entrada.nombre === "string" && entrada.nombre.trim() ? entrada.nombre.trim().slice(0, 80) : ticker;
  return { ok: true, datos: { ticker, tesis, nombre, toma_ganancia_pct: toma.valor, stop_revision_pct: stop.valor } };
}

export function mensajeFueraDeLaboratorio(ticker: string): string {
  return `${ticker} no está en los datos del laboratorio, así que no hay con qué evaluarlo. Para sumarlo habría que agregarlo al universo del laboratorio, y eso también cambia lo que pueden operar los bots: es una decisión aparte.`;
}

// Pesos del puntaje: enteros entre 0 y 100 que suman 100.
export function validarPesos(entrada: Record<string, unknown>): { ok: true; pesos: { peso_valuacion: number; peso_momento: number; peso_calidad: number; peso_noticias: number } } | { ok: false; error: string } {
  const valores = [entrada.valuacion, entrada.momento, entrada.calidad, entrada.noticias].map(Number);
  if (!valores.every((valor) => Number.isInteger(valor) && valor >= 0 && valor <= 100)) return { ok: false, error: "Los pesos deben ser enteros entre 0 y 100" };
  if (valores.reduce((total, valor) => total + valor, 0) !== 100) return { ok: false, error: "Los pesos deben sumar 100" };
  return { ok: true, pesos: { peso_valuacion: valores[0], peso_momento: valores[1], peso_calidad: valores[2], peso_noticias: valores[3] } };
}
