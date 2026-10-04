import { describe, expect, it } from "vitest";
import { parsearDividendos } from "./alpaca";
import { parsearDolares, parsearRiesgoPais } from "./argentina";
import { mapearCik, parsearFilings } from "./edgar";
import { parsearInsiders, parsearMetricas, parsearRecomendaciones, parsearSorpresas } from "./finnhub";
import { parsearFechasPublicacion } from "./fred";

describe("finnhub: métricas", () => {
  it("toma los campos usados con sus nombres y deja null los que faltan", () => {
    const metricas = parsearMetricas({
      metric: { peTTM: 29.2, netProfitMarginTTM: 63.66, revenueGrowthTTMYoy: 83.38, beta: 2.26, "52WeekHigh": 237.88, "totalDebt/totalEquityQuarterly": 0.15, otraCosa: 1 },
    });
    expect(metricas).toMatchObject({ pe: 29.2, margen_neto: 63.66, crecimiento_ingresos: 83.38, beta: 2.26, max_52s: 237.88, deuda_capital: 0.15, roe: null });
  });
  it("sin métricas (los ETF) devuelve null", () => {
    expect(parsearMetricas({ metric: {} })).toBeNull();
    expect(parsearMetricas({})).toBeNull();
  });
});

describe("finnhub: analistas y sorpresas", () => {
  it("parsearRecomendaciones completa con cero lo que falta y descarta filas sin período", () => {
    expect(parsearRecomendaciones([{ period: "2026-09-01", strongBuy: 24, buy: 41, hold: 3, sell: 1 }, { buy: 5 }])).toEqual([
      { periodo: "2026-09-01", strongBuy: 24, buy: 41, hold: 3, sell: 1, strongSell: 0 },
    ]);
  });
  it("un período repetido (Finnhub lo hizo con XOM) se queda una sola vez, para que el upsert no falle", () => {
    const repetido = [{ period: "2026-07-01", buy: 5 }, { period: "2026-07-01", buy: 9 }, { period: "2026-08-01", buy: 1 }];
    expect(parsearRecomendaciones(repetido).map((fila) => [fila.periodo, fila.buy])).toEqual([["2026-07-01", 5], ["2026-08-01", 1]]);
    expect(parsearSorpresas([{ period: "2026-06-30", actual: 1 }, { period: "2026-06-30", actual: 2 }])).toHaveLength(1);
  });
  it("parsearSorpresas toma estimado, real y sorpresa porcentual", () => {
    expect(parsearSorpresas([{ period: "2026-09-30", estimate: 2.1384, actual: 2.22, surprisePercent: 3.8159, year: 2027, quarter: 2 }])).toEqual([
      { periodo: "2026-09-30", estimado: 2.1384, real: 2.22, sorpresaPct: 3.8159, anio: 2027, trimestre: 2 },
    ]);
  });
});

describe("finnhub: insiders", () => {
  const filas = [
    { name: "Ana", share: 1000, change: -500, filingDate: "2026-09-23", transactionDate: "2026-09-21", transactionCode: "S", transactionPrice: 223.7 },
    { name: "Beto", share: 5000, change: 200, filingDate: "2026-09-10", transactionDate: "2026-09-08", transactionCode: "P", transactionPrice: 0 },
    { name: "Carla", share: 900, change: -50, filingDate: "2026-09-10", transactionDate: "2026-09-08", transactionCode: "F", transactionPrice: 220 }, // impuestos
    { name: "Dani", share: 100, change: 900, filingDate: "2026-09-10", transactionDate: "2026-09-08", transactionCode: "A", transactionPrice: 0 }, // premio
    { name: "Eli", share: 1, change: -1, filingDate: "2026-01-10", transactionDate: "2026-01-08", transactionCode: "S", transactionPrice: 100 }, // vieja
    { name: "Fer", share: 1, change: 0, filingDate: "2026-09-10", transactionDate: "2026-09-08", transactionCode: "S", transactionPrice: 100 }, // sin cambio
  ];
  it("se queda solo con compras y ventas recientes, sin premios, impuestos ni movimientos nulos", () => {
    const resultado = parsearInsiders(filas, "2026-07-01");
    expect(resultado.map((fila) => [fila.nombre, fila.codigo, fila.cambioAcciones])).toEqual([
      ["Ana", "S", -500],
      ["Beto", "P", 200],
    ]);
    expect(resultado[1].precio).toBeNull(); // precio 0 = sin precio
  });
});

describe("sec edgar", () => {
  it("mapearCik arma el mapa ticker -> CIK", () => {
    expect(mapearCik({ "0": { cik_str: 1045810, ticker: "nvda" }, "1": { cik_str: 320193, ticker: "AAPL" }, "2": { ticker: "XXX" } })).toEqual({ NVDA: 1045810, AAPL: 320193 });
  });

  const recent = {
    accessionNumber: ["0001045810-26-000078", "0001-26-1", "0001045810-26-000075", "0001-26-2", "0001-26-3"],
    filingDate: ["2026-09-03", "2026-09-02", "2026-08-26", "2026-08-20", "2026-01-15"],
    form: ["8-K", "4", "10-Q", "144", "8-K"],
    items: ["2.02,9.01", "", "", "", "8.01"],
    primaryDocument: ["nvda-20260902.htm", "form4.xml", "nvda-20260726.htm", "p.xml", "viejo.htm"],
  };

  it("parsearFilings guarda solo los formularios de hechos de la empresa, recientes, con items y url de la SEC", () => {
    const resultado = parsearFilings("NVDA", 1045810, recent, "2026-07-01");
    expect(resultado.map((fila) => [fila.formulario, fila.items])).toEqual([
      ["8-K", ["2.02", "9.01"]],
      ["10-Q", []],
    ]);
    expect(resultado[0].url).toBe("https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm");
  });
  it("una respuesta vacía no rompe", () => {
    expect(parsearFilings("NVDA", 1, {}, "2026-07-01")).toEqual([]);
  });
});

describe("alpaca: dividendos", () => {
  it("parsearDividendos toma ticker, fecha ex, fecha de pago y monto, y descarta montos inválidos", () => {
    expect(
      parsearDividendos([
        { symbol: "ko", ex_date: "2026-11-14", payable_date: "2026-12-01", rate: 0.53, special: false },
        { symbol: "SCHD", ex_date: "2026-12-10", rate: 0 },
      ])
    ).toEqual([{ ticker: "KO", fechaEx: "2026-11-14", fechaPago: "2026-12-01", monto: 0.53, especial: false }]);
  });
});

describe("argentina", () => {
  it("parsearRiesgoPais", () => {
    expect(parsearRiesgoPais({ valor: 655, fecha: "2026-10-02" })).toEqual([{ serie: "RIESGO_PAIS", fecha: "2026-10-02", valor: 655 }]);
    expect(parsearRiesgoPais({})).toEqual([]);
  });
  it("parsearDolares se queda con oficial, MEP (bolsa), CCL y blue, al precio de venta y con su fecha", () => {
    const resultado = parsearDolares([
      { casa: "oficial", venta: 1540, fechaActualizacion: "2026-10-02T18:55:00.000Z" },
      { casa: "bolsa", venta: 1551.9, fechaActualizacion: "2026-10-04T10:00:00.000Z" },
      { casa: "contadoconliqui", venta: 1623.8, fechaActualizacion: "2026-10-04T10:00:00.000Z" },
      { casa: "blue", venta: 1560, fechaActualizacion: "2026-10-04T10:00:00.000Z" },
      { casa: "cripto", venta: 1614, fechaActualizacion: "2026-10-04T10:00:00.000Z" },
      { casa: "tarjeta", venta: 2002, fechaActualizacion: "2026-10-02T18:55:00.000Z" },
    ]);
    expect(resultado.map((fila) => [fila.serie, fila.valor, fila.fecha])).toEqual([
      ["USD_OFICIAL", 1540, "2026-10-02"],
      ["USD_MEP", 1551.9, "2026-10-04"],
      ["USD_CCL", 1623.8, "2026-10-04"],
      ["USD_BLUE", 1560, "2026-10-04"],
    ]);
  });
});

describe("fred: fechas de publicación", () => {
  it("parsearFechasPublicacion descarta fechas con formato inválido", () => {
    expect(parsearFechasPublicacion([{ date: "2026-10-14" }, { date: "mañana" }, {}])).toEqual(["2026-10-14"]);
  });
});
