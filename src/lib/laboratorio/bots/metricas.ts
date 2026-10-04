// Métricas y comparación de los bots del laboratorio (SIMULADO). Funciones puras: todo se calcula en código con
// los snapshots de cierre y las decisiones ejecutadas; la IA no interviene. El rendimiento principal es NETO
// de lo que cuesta la IA de cada bot, porque ese costo es parte del experimento.

export type PuntoValor = { ts: string; valorUsd: number };

export type OperacionEvaluable = { accion: "comprar" | "vender"; precioEjecucion: number; precioActual: number };

const redondear = (valor: number) => Math.round(valor * 100) / 100;

export function rendimientoPct(valorUsd: number, capitalUsd: number): number {
  return capitalUsd > 0 ? redondear((valorUsd / capitalUsd - 1) * 100) : 0;
}

// Rendimiento después de descontar el costo de IA acumulado del bot.
export function rendimientoNetoPct(valorUsd: number, costoIaUsd: number, capitalUsd: number): number {
  return capitalUsd > 0 ? redondear(((valorUsd - costoIaUsd) / capitalUsd - 1) * 100) : 0;
}

// Mayor caída porcentual desde un máximo hasta el mínimo posterior.
export function drawdownMaximoPct(valores: number[]): number {
  let pico = -Infinity;
  let peor = 0;
  for (const valor of valores) {
    if (valor > pico) pico = valor;
    if (pico > 0) peor = Math.max(peor, ((pico - valor) / pico) * 100);
  }
  return redondear(peor);
}

// Desvío de los retornos entre puntos consecutivos, anualizado con 252 ruedas. Necesita al menos 3 valores.
export function volatilidadAnualPct(valores: number[]): number | null {
  const retornos = valores.slice(1).flatMap((valor, i) => (valores[i] > 0 ? [valor / valores[i] - 1] : []));
  if (retornos.length < 2) return null;
  const media = retornos.reduce((total, retorno) => total + retorno, 0) / retornos.length;
  const varianza = retornos.reduce((total, retorno) => total + (retorno - media) ** 2, 0) / (retornos.length - 1);
  return redondear(Math.sqrt(varianza) * Math.sqrt(252) * 100);
}

// Una compra gana si el precio actual está por encima de lo que pagó; una venta gana si después el precio
// quedó por debajo de donde vendió (se evitó una caída). Es un resultado "a hoy", no realizado.
export function porcentajeGanadoras(operaciones: OperacionEvaluable[]): number | null {
  const validas = operaciones.filter((operacion) => operacion.precioEjecucion > 0 && operacion.precioActual > 0);
  if (validas.length === 0) return null;
  const ganadoras = validas.filter((operacion) => (operacion.accion === "comprar" ? operacion.precioActual > operacion.precioEjecucion : operacion.precioActual < operacion.precioEjecucion));
  return redondear((ganadoras.length / validas.length) * 100);
}

export type MetricasBot = {
  valorUsd: number;
  rendimientoBrutoPct: number;
  rendimientoNetoPct: number;
  costoIaUsd: number;
  drawdownMaxPct: number;
  volatilidadAnualPct: number | null;
  operaciones: number;
  pctGanadoras: number | null;
  diasConDatos: number;
};

// `serieCierre` en orden cronológico (un valor por cierre). Si hay un valor más reciente (`valorActualUsd`),
// se usa como último punto. El capital inicial es el punto de partida del drawdown.
export function calcularMetricasBot(params: {
  capitalUsd: number;
  serieCierre: PuntoValor[];
  valorActualUsd?: number | null;
  costoIaUsd: number;
  operaciones: OperacionEvaluable[];
}): MetricasBot | null {
  const ultimoCierre = params.serieCierre.at(-1)?.valorUsd;
  const valorUsd = params.valorActualUsd ?? ultimoCierre;
  if (valorUsd === undefined || valorUsd === null) return null;
  const valores = [params.capitalUsd, ...params.serieCierre.map((punto) => punto.valorUsd)];
  if (params.valorActualUsd !== undefined && params.valorActualUsd !== null && params.valorActualUsd !== ultimoCierre) valores.push(params.valorActualUsd);
  return {
    valorUsd: redondear(valorUsd),
    rendimientoBrutoPct: rendimientoPct(valorUsd, params.capitalUsd),
    rendimientoNetoPct: rendimientoNetoPct(valorUsd, params.costoIaUsd, params.capitalUsd),
    costoIaUsd: Math.round(params.costoIaUsd * 10_000) / 10_000,
    drawdownMaxPct: drawdownMaximoPct(valores),
    volatilidadAnualPct: volatilidadAnualPct(valores),
    operaciones: params.operaciones.length,
    pctGanadoras: porcentajeGanadoras(params.operaciones),
    diasConDatos: params.serieCierre.length,
  };
}

export type ComparacionPreguntas = {
  dias: number;
  // ¿Más información mejora las decisiones? B (todo) contra C (solo precios).
  masInformacion: { difNetoPuntos: number; costoIaExtraUsd: number } | null;
  // ¿Reaccionar durante el día mejora las decisiones? A (reactivo) contra B (una vez por día).
  reaccionar: { difNetoPuntos: number; operacionesExtra: number; costoIaExtraUsd: number } | null;
  // ¿Alguno le gana a comprar VOO y no hacer nada? Rendimiento neto de cada bot menos el de VOO.
  contraVoo: Array<{ clave: string; difPuntos: number }>;
};

export function compararPreguntas(metricas: { A: MetricasBot | null; B: MetricasBot | null; C: MetricasBot | null; VOO: MetricasBot | null }): ComparacionPreguntas {
  const { A, B, C, VOO } = metricas;
  return {
    dias: Math.max(0, ...[A, B, C, VOO].map((metrica) => metrica?.diasConDatos ?? 0)),
    masInformacion: B && C ? { difNetoPuntos: redondear(B.rendimientoNetoPct - C.rendimientoNetoPct), costoIaExtraUsd: Math.round((B.costoIaUsd - C.costoIaUsd) * 10_000) / 10_000 } : null,
    reaccionar: A && B ? { difNetoPuntos: redondear(A.rendimientoNetoPct - B.rendimientoNetoPct), operacionesExtra: A.operaciones - B.operaciones, costoIaExtraUsd: Math.round((A.costoIaUsd - B.costoIaUsd) * 10_000) / 10_000 } : null,
    contraVoo: VOO
      ? (["A", "B", "C"] as const).flatMap((clave) => {
          const metrica = metricas[clave];
          return metrica ? [{ clave, difPuntos: redondear(metrica.rendimientoNetoPct - VOO.rendimientoBrutoPct) }] : [];
        })
      : [],
  };
}

const conSigno = (valor: number) => `${valor > 0 ? "+" : valor < 0 ? "−" : ""}${Math.abs(valor).toFixed(2).replace(".", ",")}`;
const usd = (valor: number) => `US$${valor.toFixed(2).replace(".", ",")}`;

// Tarjeta de evaluación: solo números, sin opinar, con la aclaración obligatoria.
export function redactarEvaluacion(comparacion: ComparacionPreguntas, diasTotales: number): string[] {
  const lineas: string[] = [];
  lineas.push(
    comparacion.dias > 0
      ? `Datos de ${comparacion.dias} ${comparacion.dias === 1 ? "cierre" : "cierres"} de un experimento de ${diasTotales} días.`
      : "Todavía no hay cierres para comparar."
  );
  if (comparacion.masInformacion) {
    lineas.push(`Más información (B contra C): ${conSigno(comparacion.masInformacion.difNetoPuntos)} puntos de rendimiento neto de IA, con ${usd(Math.abs(comparacion.masInformacion.costoIaExtraUsd))} ${comparacion.masInformacion.costoIaExtraUsd >= 0 ? "más" : "menos"} de IA.`);
  }
  if (comparacion.reaccionar) {
    const extra = comparacion.reaccionar.operacionesExtra;
    lineas.push(
      `Reaccionar durante el día (A contra B): ${conSigno(comparacion.reaccionar.difNetoPuntos)} puntos, con ${Math.abs(extra)} ${Math.abs(extra) === 1 ? "operación" : "operaciones"} ${extra >= 0 ? "más" : "menos"} y ${usd(Math.abs(comparacion.reaccionar.costoIaExtraUsd))} ${comparacion.reaccionar.costoIaExtraUsd >= 0 ? "más" : "menos"} de IA.`
    );
  }
  if (comparacion.contraVoo.length > 0) {
    lineas.push(`Contra VOO sin tocar: ${comparacion.contraVoo.map((fila) => `Bot ${fila.clave} ${conSigno(fila.difPuntos)} puntos`).join(", ")}.`);
  }
  lineas.push("6 meses es poco para descartar suerte.");
  return lineas;
}
