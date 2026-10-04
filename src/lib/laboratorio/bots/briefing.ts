// Briefing de cada bot del laboratorio (SIMULADO). Función pura: arma exactamente lo que ve la IA según el
// perfil del bot y con un tope de tamaño para no inflar tokens (y costo) por decisión.
//
// - Perfil `completo` (bots A y B): portafolio, indicadores, noticias, macro, fundamentales, calendario,
//   diario de mercado, señales con su estadística histórica y lecciones.
// - Perfil `solo_precios` (bot C): portafolio, límites e indicadores técnicos. NADA más: ni noticias, ni
//   macro, ni memoria. Eso es lo que hace comparable el experimento (¿más información mejora las decisiones?).
import type { HechosDelDia } from "../diario";
import type { SenalConMemoria, DiarioResumido } from "../memoria";

export type PerfilInfo = "completo" | "solo_precios";

export const MAX_CARACTERES_BRIEFING = 28_000; // ~8.000 tokens

export type DatosPortafolio = {
  valorTotalUsd: number;
  efectivoUsd: number;
  capitalInicialUsd: number;
  posiciones: Array<{ ticker: string; cantidad: number; valorUsd: number; costoPromedio: number; pnlPct: number }>;
  operacionesHoy: number;
  diasDesdeInicio: number | null;
};

export type LimitesBriefing = { maxPctPorPosicion: number; minPctEfectivo: number; maxOperacionesPorDia: number };

export type IndicadorTicker = {
  ticker: string;
  precio: number;
  variacion_dia: number | null;
  variacion_semana: number | null;
  variacion_mes: number | null;
  rsi14: number | null;
  sma50: number | null;
  sma200: number | null;
  distancia_max52s: number | null;
  volatilidad20: number | null;
  volumen_relativo: number | null;
};

export type DatosCompletos = {
  noticias: HechosDelDia["noticias"];
  macro: HechosDelDia["macro"];
  fundamentales: Array<Record<string, unknown>>;
  presentaciones_sec: HechosDelDia["presentaciones_sec"];
  calendario_proximos_7_dias: HechosDelDia["calendario_proximos_7_dias"];
  diario: DiarioResumido[];
  senales_de_hoy: SenalConMemoria[];
  lecciones: Array<{ fecha: string; ticker: string | null; leccion: string }>;
};

export type EntradaBriefing = {
  fecha: string;
  horaNuevaYork: string;
  disparador: "diaria" | "evento";
  evento?: { tipo: string; ticker: string | null; detalle: Record<string, unknown> } | null;
  portafolio: DatosPortafolio;
  limites: LimitesBriefing;
  indicadores: IndicadorTicker[];
  completos?: DatosCompletos;
};

export type Briefing = Record<string, unknown>;

const relativo = (precio: number, referencia: number | null): number | null =>
  referencia && referencia > 0 ? Math.round((precio / referencia - 1) * 10_000) / 100 : null;

// El precio de cada ticker contra sus medias, ya calculado: la IA no hace cuentas.
function indicadorParaIA(indicador: IndicadorTicker) {
  return {
    ticker: indicador.ticker,
    precio: indicador.precio,
    var_dia_pct: indicador.variacion_dia,
    var_semana_pct: indicador.variacion_semana,
    var_mes_pct: indicador.variacion_mes,
    rsi14: indicador.rsi14,
    vs_media50_pct: relativo(indicador.precio, indicador.sma50),
    vs_media200_pct: relativo(indicador.precio, indicador.sma200),
    vs_max52s_pct: indicador.distancia_max52s,
    volatilidad_anual_pct: indicador.volatilidad20,
    volumen_vs_promedio: indicador.volumen_relativo,
  };
}

function portafolioParaIA(portafolio: DatosPortafolio) {
  const total = portafolio.valorTotalUsd;
  return {
    valor_total_usd: round2(total),
    efectivo_usd: round2(portafolio.efectivoUsd),
    efectivo_pct: total > 0 ? round2((portafolio.efectivoUsd / total) * 100) : 0,
    rendimiento_desde_inicio_pct: portafolio.capitalInicialUsd > 0 ? round2((total / portafolio.capitalInicialUsd - 1) * 100) : 0,
    dias_desde_inicio: portafolio.diasDesdeInicio,
    operaciones_hechas_hoy: portafolio.operacionesHoy,
    posiciones: portafolio.posiciones.map((posicion) => ({
      ticker: posicion.ticker,
      cantidad: posicion.cantidad,
      valor_usd: round2(posicion.valorUsd),
      pct_del_portafolio: total > 0 ? round2((posicion.valorUsd / total) * 100) : 0,
      costo_promedio: posicion.costoPromedio,
      resultado_pct: posicion.pnlPct,
    })),
  };
}

const round2 = (valor: number) => Math.round(valor * 100) / 100;

// Pasos de recorte, en orden: primero lo que menos pesa en una decisión, hasta entrar en el tope.
const PASOS_RECORTE: Array<{ clave: keyof DatosCompletos; maximos: number[]; etiqueta: string }> = [
  { clave: "lecciones", maximos: [5, 3, 1, 0], etiqueta: "lecciones" },
  { clave: "presentaciones_sec", maximos: [4, 2, 0], etiqueta: "presentaciones de la SEC" },
  { clave: "calendario_proximos_7_dias", maximos: [8, 5, 3], etiqueta: "calendario" },
  { clave: "noticias", maximos: [12, 8, 5, 3, 1], etiqueta: "noticias" },
  { clave: "diario", maximos: [3, 2, 1], etiqueta: "notas del diario" },
  { clave: "senales_de_hoy", maximos: [8, 5, 3], etiqueta: "señales" },
  { clave: "macro", maximos: [8, 5], etiqueta: "series macro" },
];

export function armarBriefing(perfil: PerfilInfo, entrada: EntradaBriefing): { briefing: Briefing; recortes: string[] } {
  const base: Briefing = {
    fecha: entrada.fecha,
    hora_nueva_york: entrada.horaNuevaYork,
    disparador: entrada.disparador,
    portafolio: portafolioParaIA(entrada.portafolio),
    limites: {
      maximo_por_posicion_pct: entrada.limites.maxPctPorPosicion,
      efectivo_minimo_pct: entrada.limites.minPctEfectivo,
      maximo_operaciones_por_dia: entrada.limites.maxOperacionesPorDia,
    },
    universo: entrada.indicadores.map(indicadorParaIA),
  };

  // El perfil solo_precios se corta acá: no se mira `completos` ni `evento`, aunque vengan en la entrada.
  if (perfil === "solo_precios") return { briefing: base, recortes: [] };

  if (entrada.evento) base.evento_que_disparo_esta_decision = entrada.evento;
  const completos = entrada.completos;
  if (!completos) return { briefing: base, recortes: [] };

  const recortes: string[] = [];
  const secciones: DatosCompletos = { ...completos };
  const armar = () => ({ ...base, ...secciones });
  const largo = () => JSON.stringify(armar()).length;

  for (const paso of PASOS_RECORTE) {
    for (const maximo of paso.maximos) {
      if (largo() <= MAX_CARACTERES_BRIEFING) break;
      const original = (secciones[paso.clave] as unknown[]).length;
      if (original <= maximo) continue;
      (secciones[paso.clave] as unknown[]) = (secciones[paso.clave] as unknown[]).slice(0, maximo);
      recortes.push(`${paso.etiqueta}: de ${original} a ${maximo}`);
    }
  }
  // Último recurso: los fundamentales son lo más pesado; se reducen sin tocar portafolio ni indicadores.
  for (const maximo of [8, 5, 3, 0]) {
    if (largo() <= MAX_CARACTERES_BRIEFING) break;
    const original = secciones.fundamentales.length;
    if (original <= maximo) continue;
    secciones.fundamentales = secciones.fundamentales.slice(0, maximo);
    recortes.push(`fundamentales: de ${original} a ${maximo}`);
  }
  return { briefing: armar(), recortes };
}
