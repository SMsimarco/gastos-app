import { describe, expect, it } from "vitest";
import { CONFIG_MONITOR_DEFAULT, detectarEventos, type EntradaMonitor } from "./monitor";

const AHORA = new Date("2026-10-05T15:00:00Z");

function entrada(parcial: Partial<EntradaMonitor> = {}): EntradaMonitor {
  return {
    ahora: AHORA,
    fechaMercado: "2026-10-05",
    universo: ["VOO", "NVDA", "AAPL"],
    precios: { VOO: 500, NVDA: 100, AAPL: 200 },
    referencias: { VOO: 500, NVDA: 100, AAPL: 200 },
    vix: null,
    noticiasNuevas: [],
    tickersConBalanceHoy: [],
    posiciones: [],
    clavesRegistradas: new Set(),
    disparosHoy: 0,
    ultimoDisparo: null,
    config: CONFIG_MONITOR_DEFAULT,
    ...parcial,
  };
}

describe("detectarEventos", () => {
  it("sin cambios no devuelve eventos", () => {
    expect(detectarEventos(entrada())).toEqual([]);
  });

  it("un movimiento de 3% o más en un ticker del universo dispara decisión", () => {
    const eventos = detectarEventos(entrada({ precios: { VOO: 500, NVDA: 103.5, AAPL: 200 } }));
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ tipo: "movimiento", ticker: "NVDA", disparaDecision: true });
    expect(eventos[0].detalle.variacion_pct).toBe(3.5);
  });

  it("un movimiento menor a 3% no genera evento", () => {
    expect(detectarEventos(entrada({ precios: { VOO: 500, NVDA: 102.9, AAPL: 200 } }))).toEqual([]);
  });

  it("detecta bajas y distingue el sentido en la clave", () => {
    const eventos = detectarEventos(entrada({ precios: { VOO: 500, NVDA: 96, AAPL: 200 } }));
    expect(eventos[0].clave).toBe("movimiento:NVDA:2026-10-05:baja");
  });

  it("el VIX con suba de 10% o más dispara decisión", () => {
    const eventos = detectarEventos(entrada({ vix: { actual: 22, anterior: 20, fecha: "2026-10-05" } }));
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ tipo: "vix", ticker: null, disparaDecision: true });
  });

  it("el VIX con suba menor a 10% o una baja no genera evento", () => {
    expect(detectarEventos(entrada({ vix: { actual: 21.9, anterior: 20, fecha: "2026-10-05" } }))).toEqual([]);
    expect(detectarEventos(entrada({ vix: { actual: 15, anterior: 20, fecha: "2026-10-05" } }))).toEqual([]);
  });

  it("noticia relevante: se registra siempre, pero solo dispara si hay posición en el ticker", () => {
    const noticia = { id: "n1", titular: "NVDA anuncia chip", ticker: "NVDA", tickers: ["NVDA"], relevancia: 0.9 };
    const sinPosicion = detectarEventos(entrada({ noticiasNuevas: [noticia] }));
    expect(sinPosicion[0]).toMatchObject({ tipo: "noticia_relevante", ticker: "NVDA", disparaDecision: false });
    const conPosicion = detectarEventos(entrada({ noticiasNuevas: [noticia], posiciones: ["NVDA"] }));
    expect(conPosicion[0].disparaDecision).toBe(true);
  });

  it("ignora noticias con relevancia menor a 0,8 o sin tickers del universo", () => {
    const eventos = detectarEventos(
      entrada({
        noticiasNuevas: [
          { id: "n1", titular: "x", ticker: "NVDA", tickers: [], relevancia: 0.79 },
          { id: "n2", titular: "y", ticker: null, tickers: ["TSLA"], relevancia: 0.95 },
          { id: "n3", titular: "z", ticker: null, tickers: [], relevancia: 0.95 },
        ],
      })
    );
    expect(eventos).toEqual([]);
  });

  it("balance de hoy: dispara una vez y solo con posición", () => {
    const sinPosicion = detectarEventos(entrada({ tickersConBalanceHoy: ["AAPL"] }));
    expect(sinPosicion[0]).toMatchObject({ tipo: "balance_hoy", ticker: "AAPL", disparaDecision: false });
    const conPosicion = detectarEventos(entrada({ tickersConBalanceHoy: ["AAPL"], posiciones: ["AAPL"] }));
    expect(conPosicion[0].disparaDecision).toBe(true);
    const repetido = detectarEventos(
      entrada({ tickersConBalanceHoy: ["AAPL"], posiciones: ["AAPL"], clavesRegistradas: new Set(["balance:AAPL:2026-10-05"]) })
    );
    expect(repetido).toEqual([]);
  });

  it("no repite eventos ya registrados", () => {
    const eventos = detectarEventos(
      entrada({
        precios: { VOO: 500, NVDA: 104, AAPL: 200 },
        clavesRegistradas: new Set(["movimiento:NVDA:2026-10-05:suba"]),
      })
    );
    expect(eventos).toEqual([]);
  });

  it("cooldown: un segundo disparo dentro del cooldown se registra pero no dispara", () => {
    const eventos = detectarEventos(
      entrada({
        precios: { VOO: 500, NVDA: 104, AAPL: 190 },
        ultimoDisparo: new Date(AHORA.getTime() - 30 * 60_000),
        disparosHoy: 1,
      })
    );
    expect(eventos).toHaveLength(2);
    expect(eventos.every((evento) => evento.disparaDecision === false)).toBe(true);
  });

  it("pasado el cooldown vuelve a disparar", () => {
    const eventos = detectarEventos(
      entrada({
        precios: { VOO: 500, NVDA: 104, AAPL: 200 },
        ultimoDisparo: new Date(AHORA.getTime() - 61 * 60_000),
        disparosHoy: 1,
      })
    );
    expect(eventos[0].disparaDecision).toBe(true);
  });

  it("dentro de la misma corrida el primero dispara y el segundo queda en cooldown", () => {
    const eventos = detectarEventos(entrada({ precios: { VOO: 500, NVDA: 106, AAPL: 190 } }));
    // Se ordenan por magnitud: NVDA (+6%) antes que AAPL (-5%).
    expect(eventos.map((evento) => [evento.ticker, evento.disparaDecision])).toEqual([
      ["NVDA", true],
      ["AAPL", false],
    ]);
  });

  it("respeta el máximo de decisiones por evento del día", () => {
    const eventos = detectarEventos(
      entrada({
        precios: { VOO: 500, NVDA: 104, AAPL: 200 },
        disparosHoy: 2,
        ultimoDisparo: new Date(AHORA.getTime() - 5 * 3_600_000),
      })
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0].disparaDecision).toBe(false);
  });

  it("con cooldown 0 y máximo 2, solo disparan los dos primeros", () => {
    const eventos = detectarEventos(
      entrada({
        universo: ["VOO", "NVDA", "AAPL"],
        precios: { VOO: 520, NVDA: 106, AAPL: 190 },
        config: { ...CONFIG_MONITOR_DEFAULT, cooldownEventoMin: 0 },
      })
    );
    expect(eventos.map((evento) => evento.disparaDecision)).toEqual([true, true, false]);
  });
});
