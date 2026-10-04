// Monitor de mercado del laboratorio (SIMULADO). Función pura: recibe lo que se ve ahora y lo que
// ya se registró, y devuelve eventos. No llama a la IA ni dispara decisiones por sí misma: el
// campo `disparaDecision` indica si ese evento le tocaría despertar al bot reactivo (A), respetando
// el cooldown y el máximo de decisiones por evento del día.

export type TipoEventoMercado = "movimiento" | "vix" | "noticia_relevante" | "balance_hoy";

export type EventoMercado = {
  clave: string; // única por evento: evita repetirlo cada 15 minutos
  tipo: TipoEventoMercado;
  ticker: string | null;
  detalle: Record<string, unknown>;
  disparaDecision: boolean;
};

export type ConfigMonitor = {
  umbralMovimientoPct: number;
  umbralVixPct: number;
  umbralRelevancia: number;
  maxDecisionesEventoPorDia: number;
  cooldownEventoMin: number;
};

export const CONFIG_MONITOR_DEFAULT: ConfigMonitor = {
  umbralMovimientoPct: 3,
  umbralVixPct: 10,
  umbralRelevancia: 0.8,
  maxDecisionesEventoPorDia: 2,
  cooldownEventoMin: 60,
};

export type NoticiaParaMonitor = {
  id: string;
  titular: string;
  ticker: string | null;
  tickers: string[];
  relevancia: number | null;
};

export type EntradaMonitor = {
  ahora: Date;
  fechaMercado: string; // YYYY-MM-DD en hora de Nueva York
  universo: string[];
  precios: Record<string, number>;
  // Precio contra el que se mide el movimiento: el de la última decisión del bot; si todavía no
  // hay bots, el cierre anterior.
  referencias: Record<string, number>;
  vix: { actual: number; anterior: number; fecha: string } | null;
  noticiasNuevas: NoticiaParaMonitor[];
  tickersConBalanceHoy: string[];
  posiciones: string[]; // tickers en los que el bot tiene posición (vacío mientras no haya bots)
  clavesRegistradas: ReadonlySet<string>;
  disparosHoy: number;
  ultimoDisparo: Date | null;
  config: ConfigMonitor;
};

type Candidato = {
  evento: Omit<EventoMercado, "disparaDecision">;
  aptoParaDisparar: boolean;
};

function tienePosicion(posiciones: Set<string>, tickers: string[]): boolean {
  return tickers.some((ticker) => posiciones.has(ticker));
}

export function detectarEventos(entrada: EntradaMonitor): EventoMercado[] {
  const { config, fechaMercado } = entrada;
  const universo = new Set(entrada.universo);
  const posiciones = new Set(entrada.posiciones);
  const candidatos: Candidato[] = [];

  // 1) Balances de hoy (una sola vez por ticker y día).
  for (const ticker of entrada.tickersConBalanceHoy) {
    if (!universo.has(ticker)) continue;
    candidatos.push({
      evento: { clave: `balance:${ticker}:${fechaMercado}`, tipo: "balance_hoy", ticker, detalle: { fecha: fechaMercado } },
      aptoParaDisparar: posiciones.has(ticker),
    });
  }

  // 2) VIX: suba contra la rueda anterior.
  if (entrada.vix && entrada.vix.anterior > 0) {
    const variacion = (entrada.vix.actual / entrada.vix.anterior - 1) * 100;
    if (variacion >= config.umbralVixPct) {
      candidatos.push({
        evento: {
          clave: `vix:${entrada.vix.fecha}`,
          tipo: "vix",
          ticker: null,
          detalle: {
            actual: entrada.vix.actual,
            anterior: entrada.vix.anterior,
            variacion_pct: Math.round(variacion * 100) / 100,
          },
        },
        aptoParaDisparar: true,
      });
    }
  }

  // 3) Movimientos del universo, de mayor a menor magnitud.
  const movimientos = entrada.universo
    .map((ticker) => {
      const precio = entrada.precios[ticker];
      const referencia = entrada.referencias[ticker];
      if (!(precio > 0) || !(referencia > 0)) return null;
      return { ticker, precio, referencia, variacion: (precio / referencia - 1) * 100 };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null && Math.abs(item.variacion) >= config.umbralMovimientoPct)
    .sort((a, b) => Math.abs(b.variacion) - Math.abs(a.variacion));
  for (const movimiento of movimientos) {
    const sentido = movimiento.variacion >= 0 ? "suba" : "baja";
    candidatos.push({
      evento: {
        clave: `movimiento:${movimiento.ticker}:${fechaMercado}:${sentido}`,
        tipo: "movimiento",
        ticker: movimiento.ticker,
        detalle: {
          precio: movimiento.precio,
          referencia: movimiento.referencia,
          variacion_pct: Math.round(movimiento.variacion * 100) / 100,
        },
      },
      aptoParaDisparar: true,
    });
  }

  // 4) Noticias muy relevantes sobre tickers del universo (dispara solo si el bot tiene posición).
  const noticias = entrada.noticiasNuevas
    .filter((noticia) => (noticia.relevancia ?? 0) >= config.umbralRelevancia)
    .sort((a, b) => (b.relevancia ?? 0) - (a.relevancia ?? 0));
  for (const noticia of noticias) {
    const afectados = [...new Set([...(noticia.ticker ? [noticia.ticker] : []), ...noticia.tickers])].filter((ticker) => universo.has(ticker));
    if (afectados.length === 0) continue;
    candidatos.push({
      evento: {
        clave: `noticia:${noticia.id}`,
        tipo: "noticia_relevante",
        ticker: afectados[0],
        detalle: { noticia_id: noticia.id, titular: noticia.titular, relevancia: noticia.relevancia, tickers: afectados },
      },
      aptoParaDisparar: tienePosicion(posiciones, afectados),
    });
  }

  // Descarta lo ya registrado y reparte los "disparos" respetando cooldown y máximo diario.
  let disparosHoy = entrada.disparosHoy;
  let ultimoDisparo = entrada.ultimoDisparo;
  const cooldownMs = config.cooldownEventoMin * 60_000;
  const eventos: EventoMercado[] = [];
  for (const candidato of candidatos) {
    if (entrada.clavesRegistradas.has(candidato.evento.clave)) continue;
    const dentroDeCooldown = ultimoDisparo !== null && entrada.ahora.getTime() - ultimoDisparo.getTime() < cooldownMs;
    const dispara = candidato.aptoParaDisparar && disparosHoy < config.maxDecisionesEventoPorDia && !dentroDeCooldown;
    if (dispara) {
      disparosHoy += 1;
      ultimoDisparo = entrada.ahora;
    }
    eventos.push({ ...candidato.evento, disparaDecision: dispara });
  }
  return eventos;
}
