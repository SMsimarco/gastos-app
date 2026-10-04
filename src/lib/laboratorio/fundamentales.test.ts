import { describe, expect, it } from "vitest";
import { mensajeDeError } from "./fuentes/http";
import { consensoAnalistas, describirFiling, resumenInsiders } from "./fundamentales";
import { armarFundamentales, resumirMacro } from "./panel";

describe("consensoAnalistas", () => {
  it("suma strong buy y buy como compra y calcula el porcentaje", () => {
    expect(consensoAnalistas({ strong_buy: 24, buy: 41, hold: 3, sell: 1, strong_sell: 0 })).toEqual({ compra: 65, mantener: 3, venta: 1, total: 69, pctCompra: 94 });
  });
  it("sin analistas devuelve null", () => {
    expect(consensoAnalistas({ strong_buy: 0, buy: 0, hold: 0, sell: 0, strong_sell: 0 })).toBeNull();
  });
});

describe("resumenInsiders", () => {
  const movimientos = [
    { codigo: "S", fecha_transaccion: "2026-09-21", cambio_acciones: -4499 },
    { codigo: "S", fecha_transaccion: "2026-08-01", cambio_acciones: -1000 },
    { codigo: "P", fecha_transaccion: "2026-09-01", cambio_acciones: 300 },
    { codigo: "S", fecha_transaccion: "2026-03-01", cambio_acciones: -9999 }, // fuera de los 90 días
  ];
  it("cuenta compras y ventas de los últimos 90 días con sus acciones", () => {
    expect(resumenInsiders(movimientos, "2026-10-04")).toEqual({ compras: 1, ventas: 2, accionesCompradas: 300, accionesVendidas: 5499 });
  });
});

describe("describirFiling", () => {
  it("traduce los ítems del 8-K y omite el 9.01 (anexos)", () => {
    expect(describirFiling("8-K", ["2.02", "9.01"])).toBe("Resultados trimestrales");
    expect(describirFiling("8-K", ["5.02", "7.01"])).toBe("Cambios en directivos, Divulgación de información");
  });
  it("un 8-K con ítem desconocido o sin ítems no rompe", () => {
    expect(describirFiling("8-K", ["6.99"])).toBe("Ítem 6.99");
    expect(describirFiling("8-K", ["9.01"])).toBe("Reporte de hechos relevantes");
  });
  it("describe los otros formularios", () => {
    expect(describirFiling("10-Q", [])).toBe("Informe trimestral");
    expect(describirFiling("6-K", [])).toBe("Comunicado de emisor extranjero");
  });
});

describe("armarFundamentales", () => {
  it("junta métricas, consenso, última sorpresa e insiders por ticker, tomando la fila más nueva", () => {
    const filas = armarFundamentales({
      empresas: ["NVDA", "KO"],
      hoy: "2026-10-04",
      fundamentales: [
        { ticker: "NVDA", fecha: "2026-10-03", datos: { pe: 29.2, margen_neto: 63.7, crecimiento_ingresos: 83.4, beta: 2.26, rendimiento_26s: 41.6 } },
        { ticker: "NVDA", fecha: "2026-10-02", datos: { pe: 99 } },
      ],
      analistas: [
        { ticker: "NVDA", periodo: "2026-09-01", strong_buy: 24, buy: 41, hold: 3, sell: 1, strong_sell: 0 },
        { ticker: "NVDA", periodo: "2026-08-01", strong_buy: 1, buy: 1, hold: 1, sell: 1, strong_sell: 1 },
      ],
      sorpresas: [
        { ticker: "NVDA", periodo: "2026-09-30", sorpresa_pct: 3.8 },
        { ticker: "NVDA", periodo: "2026-06-30", sorpresa_pct: -1 },
      ],
      insiders: [{ ticker: "NVDA", codigo: "S", fecha_transaccion: "2026-09-21", cambio_acciones: -4499 }],
    });
    expect(filas[0]).toMatchObject({
      ticker: "NVDA",
      pe: 29.2,
      margenNeto: 63.7,
      sorpresa: { pct: 3.8, periodo: "2026-09-30" },
      analistas: { compra: 65, total: 69, periodo: "2026-09-01" },
      insiders: { compras: 0, ventas: 1 },
    });
  });
  it("un ticker sin datos queda con todo en null, sin romper", () => {
    const [fila] = armarFundamentales({ empresas: ["KO"], hoy: "2026-10-04", fundamentales: [], analistas: [], sorpresas: [], insiders: [] });
    expect(fila).toMatchObject({ ticker: "KO", fechaDatos: null, pe: null, analistas: null, sorpresa: null, insiders: null });
  });
});

describe("resumirMacro con las series nuevas", () => {
  it("el riesgo país de Argentina se muestra con diferencia en puntos y el dólar con porcentaje", () => {
    expect(resumirMacro("RIESGO_PAIS", [{ fecha: "2026-10-02", valor: 655 }, { fecha: "2026-10-01", valor: 670 }])).toMatchObject({ grupo: "argentina", variacion: -15, tipoVariacion: "pp" });
    expect(resumirMacro("USD_MEP", [{ fecha: "2026-10-04", valor: 1551.9 }, { fecha: "2026-10-03", valor: 1500 }])).toMatchObject({ grupo: "argentina", variacion: 3.46, tipoVariacion: "pct" });
  });
  it("el bono a 10 años en puntos y los pedidos de desempleo en porcentaje, ambos de EE.UU.", () => {
    expect(resumirMacro("DGS10", [{ fecha: "2026-10-01", valor: 5.24 }, { fecha: "2026-09-30", valor: 5.29 }])).toMatchObject({ grupo: "eeuu", variacion: -0.05, tipoVariacion: "pp" });
    expect(resumirMacro("ICSA", [{ fecha: "2026-09-26", valor: 197000 }, { fecha: "2026-09-19", valor: 198000 }])).toMatchObject({ grupo: "eeuu", tipoVariacion: "pct" });
  });
});

describe("mensajeDeError", () => {
  it("conserva el texto de los errores que llegan como string (los de la base de datos)", () => {
    expect(mensajeDeError("duplicate key value")).toBe("duplicate key value");
    expect(mensajeDeError(new Error("HTTP 500"))).toBe("HTTP 500");
    expect(mensajeDeError(undefined)).toBe("Error desconocido");
  });
});
