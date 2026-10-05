import { describe, expect, it } from "vitest";
import { mensajeFueraDeLaboratorio, tipoDeTicker, validarActivoAprender, validarPesos } from "./aprenderActivos";

const tesisOk = "Empresa de consumo estable que paga dividendo";

describe("validarActivoAprender", () => {
  it("acepta ticker, tesis y al menos un umbral; normaliza el ticker", () => {
    const resultado = validarActivoAprender({ ticker: " ko ", tesis: tesisOk, tomaGananciaPct: "30", stopRevisionPct: "" });
    expect(resultado).toEqual({ ok: true, datos: { ticker: "KO", tesis: tesisOk, nombre: "KO", toma_ganancia_pct: 30, stop_revision_pct: null } });
  });

  it("la tesis es obligatoria", () => {
    expect(validarActivoAprender({ ticker: "KO", tesis: "  ", tomaGananciaPct: 30 }).ok).toBe(false);
    expect(validarActivoAprender({ ticker: "KO", tesis: "corta", tomaGananciaPct: 30 }).ok).toBe(false);
  });

  it("pide al menos una toma de ganancia o un umbral de revisión", () => {
    const resultado = validarActivoAprender({ ticker: "KO", tesis: tesisOk });
    expect(resultado).toEqual({ ok: false, error: "Definí al menos una toma de ganancia o un umbral de revisión" });
  });

  it("rechaza tickers y porcentajes inválidos", () => {
    expect(validarActivoAprender({ ticker: "no es ticker", tesis: tesisOk, tomaGananciaPct: 30 }).ok).toBe(false);
    expect(validarActivoAprender({ ticker: "KO", tesis: tesisOk, tomaGananciaPct: -5 }).ok).toBe(false);
    expect(validarActivoAprender({ ticker: "KO", tesis: tesisOk, stopRevisionPct: "abc" }).ok).toBe(false);
  });

  it("al editar no exige ticker", () => {
    expect(validarActivoAprender({ tesis: tesisOk, stopRevisionPct: 20 }, false).ok).toBe(true);
  });

  it("clasifica ETF y acción, y explica por qué no se puede sumar un ticker fuera del laboratorio", () => {
    expect(tipoDeTicker("QQQ")).toBe("etf");
    expect(tipoDeTicker("MSFT")).toBe("accion");
    expect(mensajeFueraDeLaboratorio("PLTR")).toContain("decisión aparte");
  });
});

describe("validarPesos", () => {
  it("acepta enteros que suman 100", () => {
    expect(validarPesos({ valuacion: 40, momento: 20, calidad: 20, noticias: 20 })).toEqual({ ok: true, pesos: { peso_valuacion: 40, peso_momento: 20, peso_calidad: 20, peso_noticias: 20 } });
  });
  it("rechaza si no suman 100 o no son enteros", () => {
    expect(validarPesos({ valuacion: 40, momento: 20, calidad: 20, noticias: 10 }).ok).toBe(false);
    expect(validarPesos({ valuacion: 40.5, momento: 19.5, calidad: 20, noticias: 20 }).ok).toBe(false);
    expect(validarPesos({ valuacion: -10, momento: 50, calidad: 30, noticias: 30 }).ok).toBe(false);
  });
});
