// fetch con timeout para las fuentes externas del laboratorio: una fuente lenta no tiene que
// colgar toda la corrida.
export async function fetchConTimeout(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  return fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
}

export async function esperar(ms: number): Promise<void> {
  await new Promise((resolver) => setTimeout(resolver, ms));
}

export function mensajeDeError(error: unknown): string {
  return error instanceof Error ? error.message : "Error desconocido";
}
