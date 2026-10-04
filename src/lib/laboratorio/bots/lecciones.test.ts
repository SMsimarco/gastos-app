import { describe, expect, it } from "vitest";
import type { Barra } from "../indicadores";
import { construirPromptLecciones, evaluarDecision, HORIZONTE_LECCION, normalizarLecciones, type CasoLeccion } from "./lecciones";

function barras(fechas: string[], cierres: number[]): Barra[] {
  return fechas.map((fecha, i) => ({ fecha, cierre: cierres[i], volumen: 1_000 }));
}

// Lunes 5/10 a lunes 12/10 (6 ruedas: 5, 6, 7, 8, 9, 12). La decisión es del 5/10; a 5 ruedas es el 12/10.
const FECHAS = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12"];

describe("evaluarDecision", () => {
  it("una compra que rindió 6% cuando VOO rindió 2% aportó +4 puntos y acertó", () => {
    const resultado = evaluarDecision({
      accion: "comprar",
      precioEjecucion: 100,
      fechaDecision: "2026-10-05",
      barras: barras(FECHAS, [100, 101, 102, 103, 104, 106]),
      barrasVoo: barras(FECHAS, [700, 701, 702, 703, 704, 714]),
    });
    expect(resultado).toEqual({ fechaEvaluacion: "2026-10-12", resultadoPct: 6, vooPct: 2, excesoPct: 4, veredicto: "acerto" });
  });

  it("mide desde el precio de ejecución, no desde el cierre del día de la decisión", () => {
    const resultado = evaluarDecision({
      accion: "comprar",
      precioEjecucion: 98,
      fechaDecision: "2026-10-05",
      barras: barras(FECHAS, [100, 100, 100, 100, 100, 100]),
      barrasVoo: barras(FECHAS, [700, 700, 700, 700, 700, 700]),
    });
    expect(resultado?.resultadoPct).toBe(2.04);
  });

  it("una compra que rindió menos que VOO por más de 1 punto erró", () => {
    const resultado = evaluarDecision({
      accion: "comprar",
      precioEjecucion: 100,
      fechaDecision: "2026-10-05",
      barras: barras(FECHAS, [100, 99, 98, 97, 96, 97]),
      barrasVoo: barras(FECHAS, [700, 701, 702, 703, 704, 707]),
    });
    expect(resultado).toMatchObject({ resultadoPct: -3, vooPct: 1, excesoPct: -4, veredicto: "erro" });
  });

  it("vender antes de una caída suma (evitó perder) y vender antes de una suba resta (se la perdió)", () => {
    const caida = evaluarDecision({ accion: "vender", precioEjecucion: 100, fechaDecision: "2026-10-05", barras: barras(FECHAS, [100, 98, 96, 95, 94, 94]), barrasVoo: barras(FECHAS, [700, 700, 700, 700, 700, 700]) });
    expect(caida).toMatchObject({ resultadoPct: -6, vooPct: 0, excesoPct: 6, veredicto: "acerto" });
    const suba = evaluarDecision({ accion: "vender", precioEjecucion: 100, fechaDecision: "2026-10-05", barras: barras(FECHAS, [100, 103, 105, 107, 108, 110]), barrasVoo: barras(FECHAS, [700, 700, 700, 700, 700, 700]) });
    expect(suba).toMatchObject({ resultadoPct: 10, excesoPct: -10, veredicto: "erro" });
  });

  it("una diferencia menor a 1 punto contra VOO es neutral", () => {
    const resultado = evaluarDecision({ accion: "comprar", precioEjecucion: 100, fechaDecision: "2026-10-05", barras: barras(FECHAS, [100, 100, 100, 100, 100, 101]), barrasVoo: barras(FECHAS, [700, 700, 700, 700, 700, 707]) });
    expect(resultado?.veredicto).toBe("neutral");
  });

  it("devuelve null si todavía no pasaron las 5 ruedas (nunca mira un futuro que no existe)", () => {
    const corto = FECHAS.slice(0, 5);
    expect(evaluarDecision({ accion: "comprar", precioEjecucion: 100, fechaDecision: "2026-10-05", barras: barras(corto, [100, 101, 102, 103, 104]), barrasVoo: barras(corto, [700, 700, 700, 700, 700]) })).toBeNull();
    expect(HORIZONTE_LECCION).toBe(5);
  });

  it("devuelve null si falta la barra del día de la decisión, las de VOO o el precio de ejecución", () => {
    const base = { accion: "comprar" as const, fechaDecision: "2026-10-06", barras: barras(["2026-10-05", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"], [1, 2, 3, 4, 5, 6, 7]) };
    expect(evaluarDecision({ ...base, precioEjecucion: 100, barrasVoo: barras(FECHAS, [1, 1, 1, 1, 1, 1]) })).toBeNull(); // falta la barra del 6/10
    expect(evaluarDecision({ accion: "comprar", precioEjecucion: 100, fechaDecision: "2026-10-05", barras: barras(FECHAS, [100, 100, 100, 100, 100, 100]), barrasVoo: barras(FECHAS.slice(0, 3), [700, 700, 700]) })).toBeNull();
    expect(evaluarDecision({ accion: "comprar", precioEjecucion: 0, fechaDecision: "2026-10-05", barras: barras(FECHAS, [100, 100, 100, 100, 100, 100]), barrasVoo: barras(FECHAS, [700, 700, 700, 700, 700, 700]) })).toBeNull();
  });

  it("horizonte configurable: a 1 rueda", () => {
    const resultado = evaluarDecision({ accion: "comprar", precioEjecucion: 100, fechaDecision: "2026-10-05", horizonte: 1, barras: barras(FECHAS, [100, 105, 105, 105, 105, 105]), barrasVoo: barras(FECHAS, [700, 700, 700, 700, 700, 700]) });
    expect(resultado).toMatchObject({ fechaEvaluacion: "2026-10-06", resultadoPct: 5 });
  });
});

describe("construirPromptLecciones", () => {
  const caso: CasoLeccion = {
    ticker: "NVDA",
    accion: "comprar",
    fechaDecision: "2026-10-05",
    montoUsd: 150,
    razonOriginal: "RSI bajo y balance por delante",
    horizonte: 5,
    evaluacion: { fechaEvaluacion: "2026-10-12", resultadoPct: 6, vooPct: 2, excesoPct: 4, veredicto: "acerto" },
  };
  const prompt = construirPromptLecciones([caso]);

  it("incluye los números ya calculados y la razón original", () => {
    expect(prompt).toContain('"el_ticker_rindio_pct":6');
    expect(prompt).toContain('"aporte_de_la_decision_vs_voo_pct":4');
    expect(prompt).toContain("RSI bajo y balance por delante");
  });
  it("obliga a tratarlo como un solo caso que puede ser suerte y prohíbe inventar causas y hacer cuentas", () => {
    expect(prompt).toContain("UN solo caso");
    expect(prompt).toContain("suerte");
    expect(prompt).toContain("No inventes causas");
    expect(prompt).toContain("No hagas cuentas nuevas");
  });
});

describe("normalizarLecciones", () => {
  it("acepta las válidas, recorta el largo y descarta índices desconocidos, repetidos o textos vacíos", () => {
    const resultado = normalizarLecciones(
      [
        { indice: 0, leccion: `  ${"a".repeat(600)}  ` },
        { indice: 0, leccion: "repetida" },
        { indice: 1, leccion: "   " },
        { indice: 5, leccion: "no existe" },
        { indice: 2, leccion: 7 },
        { indice: 3, leccion: "ok" },
      ],
      4
    );
    expect([...resultado.keys()]).toEqual([0, 3]);
    expect(resultado.get(0)).toHaveLength(400);
    expect(resultado.get(3)).toBe("ok");
  });
  it("una respuesta que no es una lista no rompe", () => {
    expect(normalizarLecciones({ error: true }, 3).size).toBe(0);
    expect(normalizarLecciones(null, 3).size).toBe(0);
  });
});
