// Lo que aprende el asesor de aprender (Fase 7): funciones PURAS que miden cada sugerencia contra VOO, calculan
// qué criterios acertaron más y proponen cambios de pesos. Nunca cambian nada solas: la propuesta la acepta el usuario.
import { MIN_CASOS_HISTORIAL, type CriterioClave, type HistorialCriterio, type PesosAprender } from "./aprender";

export const SEMANAS_MEDICION = [1, 4, 12] as const;
export const CRITERIOS_PUNTUABLES = ["valuacion", "momento", "calidad", "noticias"] as const satisfies readonly CriterioClave[];
const PASO_PESO = 5;
const PESO_MINIMO = 5;
const DIFERENCIA_CLARA = 0.2; // un criterio acertó claramente más o menos si se aparta 20 puntos porcentuales del promedio

export type ResultadoMedido = { ticker: string; semanas: number; ganoAVoo: boolean; aportes: Partial<Record<CriterioClave, number>> };

export const redondear2 = (valor: number) => Math.round(valor * 100) / 100;

export function rendimientoPct(precioInicial: number, precioFinal: number): number {
  return precioInicial > 0 ? redondear2((precioFinal / precioInicial - 1) * 100) : 0;
}

// Fecha (YYYY-MM-DD) en que se cumple una medición, sumando semanas a la fecha de la sugerencia.
export function fechaDeMedicion(fechaSugerencia: string, semanas: number): string {
  return new Date(Date.parse(`${fechaSugerencia}T00:00:00Z`) + semanas * 7 * 86_400_000).toISOString().slice(0, 10);
}

// Un caso por (sugerencia, ticker) y horizonte: cuenta solo los casos donde ese criterio SUMÓ (aporte > 0),
// y de esos cuántos le ganaron a VOO. "valuación: 6 de 10" = de 10 sugeridas por valuación, 6 le ganaron.
export function calcularHistorialCriterios(resultados: ResultadoMedido[], semanas = 4): Partial<Record<CriterioClave, HistorialCriterio>> {
  const salida: Partial<Record<CriterioClave, HistorialCriterio>> = {};
  for (const criterio of CRITERIOS_PUNTUABLES) {
    const casos = resultados.filter((resultado) => resultado.semanas === semanas && (resultado.aportes[criterio] ?? 0) > 0);
    if (casos.length > 0) salida[criterio] = { casos: casos.length, aciertos: casos.filter((caso) => caso.ganoAVoo).length };
  }
  return salida;
}

export type EvidenciaCriterio = {
  criterio: CriterioClave;
  casos: number;
  aciertos: number;
  tasaPct: number;
  promedioPct: number;
  veredicto: "acerto_mas" | "acerto_menos" | "normal";
};

export type PropuestaPesos = { pesosPropuestos: PesosAprender; evidencia: EvidenciaCriterio[] };

// Propone mover PASO_PESO puntos hacia el criterio que más acertó (desde el que más falló, o desde el de mayor peso
// que no acertó más), solo con 30 casos o más por criterio y una diferencia clara contra el promedio.
// Devuelve null si no hay nada que proponer.
export function proponerCambioPesos(pesos: PesosAprender, historial: Partial<Record<CriterioClave, HistorialCriterio>>): PropuestaPesos | null {
  const conCasos = CRITERIOS_PUNTUABLES.flatMap((criterio) => {
    const dato = historial[criterio];
    return dato && dato.casos >= MIN_CASOS_HISTORIAL ? [{ criterio, ...dato }] : [];
  });
  if (conCasos.length < 2) return null;
  const totalCasos = conCasos.reduce((total, fila) => total + fila.casos, 0);
  const promedio = conCasos.reduce((total, fila) => total + fila.aciertos, 0) / totalCasos;
  const evidencia: EvidenciaCriterio[] = conCasos.map((fila) => {
    const tasa = fila.aciertos / fila.casos;
    return {
      criterio: fila.criterio,
      casos: fila.casos,
      aciertos: fila.aciertos,
      tasaPct: Math.round(tasa * 100),
      promedioPct: Math.round(promedio * 100),
      veredicto: tasa - promedio >= DIFERENCIA_CLARA ? "acerto_mas" : promedio - tasa >= DIFERENCIA_CLARA ? "acerto_menos" : "normal",
    };
  });
  const mejor = evidencia.filter((fila) => fila.veredicto === "acerto_mas").sort((a, b) => b.tasaPct - a.tasaPct)[0];
  const peor = evidencia.filter((fila) => fila.veredicto === "acerto_menos").sort((a, b) => a.tasaPct - b.tasaPct)[0];
  if (!mejor && !peor) return null;

  const nuevos = { ...pesos };
  const claves = CRITERIOS_PUNTUABLES as readonly (keyof PesosAprender)[];
  const puedeBajar = (clave: keyof PesosAprender) => nuevos[clave] - PASO_PESO >= PESO_MINIMO;
  // Receptor: el que más acertó; si nadie acertó más, el que menos pesa entre los que no fallaron.
  const receptor = mejor
    ? (mejor.criterio as keyof PesosAprender)
    : [...claves].filter((clave) => clave !== peor?.criterio).sort((a, b) => nuevos[a] - nuevos[b])[0];
  // Donante: el que más falló; si nadie falló, el de mayor peso entre los demás.
  const donante =
    peor && puedeBajar(peor.criterio as keyof PesosAprender)
      ? (peor.criterio as keyof PesosAprender)
      : peor
        ? undefined
        : [...claves].filter((clave) => clave !== receptor && puedeBajar(clave)).sort((a, b) => nuevos[b] - nuevos[a])[0];
  if (!receptor || !donante || receptor === donante) return null;
  nuevos[donante] -= PASO_PESO;
  nuevos[receptor] += PASO_PESO;
  return { pesosPropuestos: nuevos, evidencia };
}

const NOMBRE_CRITERIO: Record<string, string> = { valuacion: "valuación", momento: "momento", calidad: "calidad", noticias: "noticias" };

export function descripcionPropuesta(pesos: PesosAprender, propuesta: PropuestaPesos): string {
  const cambios = (Object.keys(pesos) as Array<keyof PesosAprender>)
    .filter((clave) => pesos[clave] !== propuesta.pesosPropuestos[clave])
    .map((clave) => `${NOMBRE_CRITERIO[clave]} de ${pesos[clave]} a ${propuesta.pesosPropuestos[clave]}`);
  const datos = propuesta.evidencia.map((fila) => `${NOMBRE_CRITERIO[fila.criterio]}: ${fila.aciertos} de ${fila.casos} le ganaron a VOO (${fila.tasaPct}%, promedio ${fila.promedioPct}%)`).join("; ");
  return `Propuesta de pesos: ${cambios.join(" y ")}. Datos: ${datos}. Vos decidís si aceptarla.`;
}

export type MedidaSemana = { ticker: string; semanas: number; rendimientoPct: number; vooPct: number; ganoAVoo: boolean };

// Línea del domingo con lo que aprendió esa semana: armada solo con números del código.
export function lineaDiarioAprendizaje(medidasSemana: MedidaSemana[]): string | null {
  if (medidasSemana.length === 0) return null;
  const ganaron = medidasSemana.filter((medida) => medida.ganoAVoo).length;
  const signo = (valor: number) => `${valor >= 0 ? "+" : "−"}${Math.abs(Math.round(valor))}%`;
  const detalle = medidasSemana
    .slice(0, 4)
    .map((medida) => `${medida.ticker} a ${medida.semanas} ${medida.semanas === 1 ? "semana" : "semanas"}: ${signo(medida.rendimientoPct)} contra ${signo(medida.vooPct)} de VOO`)
    .join("; ");
  const aviso = medidasSemana.length < MIN_CASOS_HISTORIAL ? ` Son pocos casos (menos de ${MIN_CASOS_HISTORIAL}): puede ser suerte.` : "";
  return `Esta semana medí ${medidasSemana.length} ${medidasSemana.length === 1 ? "sugerencia" : "sugerencias"}: ${ganaron} le ${ganaron === 1 ? "ganó" : "ganaron"} a VOO. ${detalle}.${aviso}`;
}

export type PuntoPrecio = { fecha: string; precio: number };

// Último cierre en o antes de la fecha objetivo, siempre que no sea más viejo que la tolerancia (fines de semana y
// feriados). Si no hay, null: la medición se reintenta al día siguiente. `serie` va en orden cronológico.
export function precioAlCierre(serie: PuntoPrecio[], fechaObjetivo: string, toleranciaDias = 4): PuntoPrecio | null {
  const candidatos = serie.filter((punto) => punto.fecha <= fechaObjetivo);
  const ultimo = candidatos.at(-1);
  if (!ultimo) return null;
  const dias = Math.round((Date.parse(`${fechaObjetivo}T00:00:00Z`) - Date.parse(`${ultimo.fecha}T00:00:00Z`)) / 86_400_000);
  return dias <= toleranciaDias ? ultimo : null;
}

export type SugerenciaGuardada = {
  id: string;
  fecha: string;
  vooPrecio: number | null;
  candidatos: Array<{ ticker: string; precio: number | null; aportes: Partial<Record<CriterioClave, number>> }>;
};

export type FilaResultado = {
  sugerenciaId: string;
  ticker: string;
  semanas: number;
  fechaMedicion: string;
  precioInicial: number;
  precioFinal: number;
  rendimientoPct: number;
  vooPct: number;
  ganoAVoo: boolean;
  aportes: Partial<Record<CriterioClave, number>>;
};

// Calcula las mediciones que ya se cumplieron y todavía no se guardaron (a 1, 4 y 12 semanas, contra VOO), la haya
// comprado el usuario o no.
export function medicionesPendientes(input: {
  hoy: string;
  sugerencias: SugerenciaGuardada[];
  yaMedidas: Set<string>; // `${sugerenciaId}|${ticker}|${semanas}`
  cierres: Record<string, PuntoPrecio[]>;
}): FilaResultado[] {
  const filas: FilaResultado[] = [];
  for (const sugerencia of input.sugerencias) {
    if (!sugerencia.vooPrecio || sugerencia.vooPrecio <= 0) continue;
    for (const semanas of SEMANAS_MEDICION) {
      const fechaMedicion = fechaDeMedicion(sugerencia.fecha, semanas);
      if (fechaMedicion > input.hoy) continue;
      const voo = precioAlCierre(input.cierres.VOO ?? [], fechaMedicion);
      if (!voo) continue;
      for (const candidato of sugerencia.candidatos) {
        if (!candidato.precio || candidato.precio <= 0 || input.yaMedidas.has(`${sugerencia.id}|${candidato.ticker}|${semanas}`)) continue;
        const final = precioAlCierre(input.cierres[candidato.ticker] ?? [], fechaMedicion);
        if (!final) continue;
        const rendimiento = rendimientoPct(candidato.precio, final.precio);
        const vooRendimiento = rendimientoPct(sugerencia.vooPrecio, voo.precio);
        filas.push({ sugerenciaId: sugerencia.id, ticker: candidato.ticker, semanas, fechaMedicion, precioInicial: candidato.precio, precioFinal: final.precio, rendimientoPct: rendimiento, vooPct: vooRendimiento, ganoAVoo: rendimiento > vooRendimiento, aportes: candidato.aportes });
      }
    }
  }
  return filas;
}
