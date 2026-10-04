import { describe, expect, it } from "vitest";
import { parsearBarras, parsearNoticias, parsearSnapshots } from "./alpaca";
import { parsearBalances } from "./finnhub";
import { reunionesFedEntre } from "./fed";
import { parsearObservaciones } from "./fred";
import { fechaGdeltAIso, MINUTOS_POR_TEMA, parsearArticulos, TEMAS_GLOBALES, temaDeLaCorrida } from "./gdelt";

describe("alpaca", () => {
  it("parsearBarras ordena por fecha y descarta cierres inválidos", () => {
    const resultado = parsearBarras({
      NVDA: [
        { t: "2026-10-02T04:00:00Z", c: 110, v: 5 },
        { t: "2026-10-01T04:00:00Z", c: 100, v: 4 },
        { t: "2026-09-30T04:00:00Z", c: 0, v: 1 },
      ],
      VOO: undefined,
    });
    expect(resultado.NVDA).toEqual([
      { fecha: "2026-10-01", cierre: 100, volumen: 4 },
      { fecha: "2026-10-02", cierre: 110, volumen: 5 },
    ]);
    expect(resultado.VOO).toEqual([]);
  });

  it("parsearSnapshots toma el último trade y el cierre anterior, con ambos formatos de respuesta", () => {
    const snap = {
      latestTrade: { p: 105.5, t: "2026-10-05T15:00:00Z" },
      dailyBar: { c: 105, v: 1_000, t: "2026-10-05T04:00:00Z" },
      prevDailyBar: { c: 100 },
    };
    const esperado = [{ ticker: "NVDA", precio: 105.5, ts: "2026-10-05T15:00:00Z", volumenDia: 1_000, cierreAnterior: 100 }];
    expect(parsearSnapshots({ NVDA: snap })).toEqual(esperado);
    expect(parsearSnapshots({ snapshots: { NVDA: snap } })).toEqual(esperado);
    expect(parsearSnapshots({ XXX: {} })).toEqual([]);
  });

  it("parsearNoticias descarta las incompletas y pasa los tickers a mayúsculas", () => {
    const resultado = parsearNoticias([
      { headline: "Titular", url: "https://x/1", created_at: "2026-10-05T10:00:00Z", symbols: ["nvda"], source: "benzinga" },
      { headline: "Sin url", created_at: "2026-10-05T10:00:00Z" },
    ]);
    expect(resultado).toHaveLength(1);
    expect(resultado[0]).toMatchObject({ fuente: "alpaca:benzinga", tickers: ["NVDA"] });
  });
});

describe("gdelt", () => {
  it("convierte la fecha de GDELT a ISO", () => {
    expect(fechaGdeltAIso("20261003T121530Z")).toBe("2026-10-03T12:15:30Z");
    expect(fechaGdeltAIso("basura")).toBeNull();
  });
  it("parsearArticulos descarta los que no tienen url, título o fecha válida", () => {
    const resultado = parsearArticulos("fed", [
      { url: "https://x/1", title: " La Fed mantiene tasas ", seendate: "20261003T121530Z", domain: "reuters.com" },
      { url: "https://x/2", title: "Sin fecha" },
    ]);
    expect(resultado).toEqual([
      { tema: "fed", titular: "La Fed mantiene tasas", url: "https://x/1", publicadoAt: "2026-10-03T12:15:30Z", dominio: "reuters.com" },
    ]);
  });
});

describe("gdelt: rotación de temas", () => {
  it("cada corrida de 10 minutos pasa al tema siguiente y vuelve a empezar después del último", () => {
    const inicio = new Date("2026-10-05T12:00:00Z").getTime();
    const temas = Array.from({ length: TEMAS_GLOBALES.length + 1 }, (_, i) =>
      temaDeLaCorrida(new Date(inicio + i * MINUTOS_POR_TEMA * 60_000)).tema
    );
    expect(new Set(temas.slice(0, TEMAS_GLOBALES.length)).size).toBe(TEMAS_GLOBALES.length); // los 7 temas, sin repetir
    expect(temas[TEMAS_GLOBALES.length]).toBe(temas[0]);
  });
  it("dentro de la misma ventana de 10 minutos devuelve siempre el mismo tema", () => {
    const a = temaDeLaCorrida(new Date("2026-10-05T12:00:30Z"));
    const b = temaDeLaCorrida(new Date("2026-10-05T12:09:30Z"));
    expect(a.tema).toBe(b.tema);
  });
});

describe("fred", () => {
  it("parsearObservaciones ignora los '.' (sin dato) y los valores no numéricos", () => {
    expect(
      parsearObservaciones([
        { date: "2026-10-02", value: "4.33" },
        { date: "2026-10-01", value: "." },
        { date: "2026-09-30", value: "abc" },
      ])
    ).toEqual([{ fecha: "2026-10-02", valor: 4.33 }]);
  });
});

describe("finnhub y fed", () => {
  it("parsearBalances arma el detalle del balance", () => {
    const resultado = parsearBalances([{ date: "2026-10-29", symbol: "aapl", hour: "amc", quarter: 4, year: 2026, epsEstimate: 1.5 }]);
    expect(resultado).toEqual([
      {
        ticker: "AAPL",
        fecha: "2026-10-29",
        detalle: { momento: "amc", trimestre: 4, anio: 2026, eps_estimado: 1.5, ingresos_estimados: null },
      },
    ]);
  });
  it("reunionesFedEntre devuelve las reuniones dentro del rango", () => {
    expect(reunionesFedEntre("2026-10-01", "2026-12-31")).toEqual(["2026-10-28", "2026-12-09"]);
    expect(reunionesFedEntre("2026-11-01", "2026-11-30")).toEqual([]);
  });
});
