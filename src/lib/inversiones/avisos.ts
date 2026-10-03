import type { Sugerencia } from "./sugerencias";

export const DISCLAIMER_FINANCIERO = "Sugerencia según tu plan, no asesoramiento financiero.";
export const TIPOS_MERCADO = new Set(["voo_bajo_maximo", "objetivo_ganancia", "revisar_tesis"]);

export type CandidatoAviso = {
  clave: string;
  mensaje: string;
  categoria: "mercado" | "emergencia" | "reparto";
  soloUnaVez?: boolean;
};

export function candidatosDesdeSugerencias(sugerencias: Sugerencia[]): CandidatoAviso[] {
  return sugerencias
    .filter((item) => TIPOS_MERCADO.has(item.tipo))
    .map((item) => ({ clave: `mercado:${item.tipo}:${String(item.datos.ticker ?? "general")}`, mensaje: item.mensaje, categoria: "mercado" }));
}

export function seleccionarAvisos(
  candidatos: CandidatoAviso[],
  clavesEnviadasHoy: Set<string>,
  clavesEnviadasHistoricas: Set<string>
) {
  const resultado: CandidatoAviso[] = [];
  let mercadoElegido = [...clavesEnviadasHoy].some((clave) => clave.startsWith("mercado:"));
  for (const candidato of candidatos) {
    if (clavesEnviadasHoy.has(candidato.clave)) continue;
    if (candidato.soloUnaVez && clavesEnviadasHistoricas.has(candidato.clave)) continue;
    if (candidato.categoria === "mercado") {
      if (mercadoElegido) continue;
      mercadoElegido = true;
    }
    resultado.push(candidato);
  }
  return resultado;
}

export function esDomingoEnArgentina(fecha: Date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short" }).format(fecha) === "Sun";
}

