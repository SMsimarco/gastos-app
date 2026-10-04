// Gestor de riesgo del laboratorio (SIMULADO). Función pura: la IA propone y el código dispone. Valida
// cada propuesta contra límites determinísticos antes de ejecutar nada, y cada recorte deja su motivo.

export type Accion = "comprar" | "vender" | "mantener";
export type Confianza = "alta" | "media" | "baja";

export type Propuesta = { ticker: string; accion: Accion; montoUsd: number; razon: string; confianza: Confianza };

export type EstadoRiesgo = {
  valorTotalUsd: number;
  efectivoUsd: number;
  posiciones: Array<{ ticker: string; valorUsd: number }>;
  operacionesHoy: number; // órdenes ya ejecutadas hoy por este bot
  picoUsd: number; // máximo valor histórico del bot (al menos el capital inicial)
};

export type LimitesRiesgo = {
  universo: string[];
  maxPctPorPosicion: number;
  minPctEfectivo: number;
  maxOperacionesPorDia: number;
  drawdownPausaPct: number;
};

export type DecisionRiesgo = {
  ticker: string;
  accion: Accion;
  razon: string;
  confianza: Confianza;
  montoPropuestoUsd: number;
  montoAprobadoUsd: number;
  aprobada: boolean; // true = hay que ejecutar la orden (o, para "mantener", no hay nada que hacer)
  ventaTotal: boolean; // vender toda la posición (se ejecuta por cantidad)
  ajuste: string | null; // qué recortó o descartó el gestor y por qué
};

export type ResultadoRiesgo = { decisiones: DecisionRiesgo[]; pausar: { motivo: string } | null };

const MONTO_MINIMO_USD = 1; // mínimo de una orden en Alpaca
const PESO_CONFIANZA: Record<Confianza, number> = { alta: 3, media: 2, baja: 1 };

const abajo = (valor: number) => Math.floor(valor * 100 + 1e-9) / 100;
const usd = (valor: number) => `US$${valor.toFixed(2)}`;

export function drawdownPct(valorTotalUsd: number, picoUsd: number): number {
  if (!(picoUsd > 0)) return 0;
  return Math.max(0, ((picoUsd - valorTotalUsd) / picoUsd) * 100);
}

export function aplicarRiesgo(propuestas: Propuesta[], estado: EstadoRiesgo, limites: LimitesRiesgo): ResultadoRiesgo {
  const universo = new Set(limites.universo.map((ticker) => ticker.toUpperCase()));
  const caida = drawdownPct(estado.valorTotalUsd, estado.picoUsd);
  const pausar = caida >= limites.drawdownPausaPct ? { motivo: `Drawdown de ${caida.toFixed(1)}% (límite ${limites.drawdownPausaPct}%): sin compras y bot pausado` } : null;

  const decisiones: DecisionRiesgo[] = propuestas.map((propuesta) => ({
    ticker: propuesta.ticker.toUpperCase(),
    accion: propuesta.accion,
    razon: propuesta.razon,
    confianza: propuesta.confianza,
    montoPropuestoUsd: propuesta.montoUsd,
    montoAprobadoUsd: 0,
    aprobada: false,
    ventaTotal: false,
    ajuste: null,
  }));

  const descartar = (decision: DecisionRiesgo, motivo: string) => {
    decision.aprobada = false;
    decision.montoAprobadoUsd = 0;
    decision.ajuste = `Descartada: ${motivo}`;
  };

  // 1) Filtros que no dependen del resto: universo, "mantener" y montos inválidos.
  const candidatas: DecisionRiesgo[] = [];
  for (const decision of decisiones) {
    if (!universo.has(decision.ticker)) {
      descartar(decision, `${decision.ticker} está fuera del universo`);
    } else if (decision.accion === "mantener") {
      decision.aprobada = true;
    } else if (!(decision.montoPropuestoUsd > 0) || !Number.isFinite(decision.montoPropuestoUsd)) {
      descartar(decision, "monto inválido");
    } else {
      candidatas.push(decision);
    }
  }

  // 2) Máximo de operaciones por día: se queda con las de mayor confianza (a igual confianza, la primera que propuso la IA).
  const lugares = Math.max(0, limites.maxOperacionesPorDia - estado.operacionesHoy);
  const ordenadas = [...candidatas].sort((a, b) => PESO_CONFIANZA[b.confianza] - PESO_CONFIANZA[a.confianza] || decisiones.indexOf(a) - decisiones.indexOf(b));
  const conLugar = ordenadas.slice(0, lugares);
  for (const decision of ordenadas.slice(lugares)) {
    descartar(decision, `máximo de ${limites.maxOperacionesPorDia} operaciones por día (ya hubo ${estado.operacionesHoy})`);
  }

  // 3) Ventas primero y compras después, pero las compras NO usan el efectivo de las ventas de esta misma
  //    corrida (en una cuenta real ese dinero todavía no liquidó): la rotación tarda un día.
  const valorPorTicker = new Map(estado.posiciones.map((posicion) => [posicion.ticker.toUpperCase(), posicion.valorUsd]));
  const vendidoPorTicker = new Map<string, number>();
  for (const decision of conLugar.filter((item) => item.accion === "vender")) {
    const valorPosicion = (valorPorTicker.get(decision.ticker) ?? 0) - (vendidoPorTicker.get(decision.ticker) ?? 0);
    if (!(valorPosicion >= MONTO_MINIMO_USD)) {
      descartar(decision, `no hay posición de ${decision.ticker} para vender`);
      continue;
    }
    let monto = Math.min(decision.montoPropuestoUsd, valorPosicion);
    const notas: string[] = [];
    if (monto < decision.montoPropuestoUsd) notas.push(`recortada de ${usd(decision.montoPropuestoUsd)} a ${usd(monto)}: la posición vale ${usd(valorPosicion)}`);
    // Vender casi todo equivale a cerrar la posición (se evita dejar migajas).
    if (monto >= valorPosicion * 0.98) {
      monto = valorPosicion;
      decision.ventaTotal = true;
    }
    decision.aprobada = true;
    decision.montoAprobadoUsd = abajo(monto);
    decision.ajuste = notas.length > 0 ? notas.join("; ") : null;
    vendidoPorTicker.set(decision.ticker, (vendidoPorTicker.get(decision.ticker) ?? 0) + monto);
  }

  const topePosicion = (estado.valorTotalUsd * limites.maxPctPorPosicion) / 100;
  const efectivoMinimo = (estado.valorTotalUsd * limites.minPctEfectivo) / 100;
  let efectivoDisponible = estado.efectivoUsd;
  const compradoPorTicker = new Map<string, number>();
  for (const decision of conLugar.filter((item) => item.accion === "comprar")) {
    if (pausar) {
      descartar(decision, "el bot está en pausa por drawdown: no se aprueban compras");
      continue;
    }
    const actual = (valorPorTicker.get(decision.ticker) ?? 0) + (compradoPorTicker.get(decision.ticker) ?? 0);
    const lugarEnPosicion = topePosicion - actual;
    const lugarEnEfectivo = efectivoDisponible - efectivoMinimo;
    if (lugarEnPosicion < MONTO_MINIMO_USD) {
      descartar(decision, `${decision.ticker} ya está en el máximo por posición (${limites.maxPctPorPosicion}% = ${usd(topePosicion)})`);
      continue;
    }
    if (lugarEnEfectivo < MONTO_MINIMO_USD) {
      descartar(decision, `no queda efectivo: hay que conservar el ${limites.minPctEfectivo}% (${usd(efectivoMinimo)})`);
      continue;
    }
    const monto = abajo(Math.min(decision.montoPropuestoUsd, lugarEnPosicion, lugarEnEfectivo));
    if (monto < decision.montoPropuestoUsd) {
      const motivos = [
        decision.montoPropuestoUsd > lugarEnPosicion ? `máximo por posición ${limites.maxPctPorPosicion}%` : null,
        decision.montoPropuestoUsd > lugarEnEfectivo ? `efectivo mínimo ${limites.minPctEfectivo}%` : null,
      ].filter(Boolean);
      decision.ajuste = `Recortada de ${usd(decision.montoPropuestoUsd)} a ${usd(monto)} por ${motivos.join(" y ")}`;
    }
    decision.aprobada = true;
    decision.montoAprobadoUsd = monto;
    efectivoDisponible -= monto;
    compradoPorTicker.set(decision.ticker, (compradoPorTicker.get(decision.ticker) ?? 0) + monto);
  }

  return { decisiones, pausar };
}
