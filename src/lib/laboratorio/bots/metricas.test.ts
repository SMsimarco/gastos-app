import { describe, expect, it } from "vitest";
import {
  calcularMetricasBot,
  compararPreguntas,
  drawdownMaximoPct,
  porcentajeGanadoras,
  redactarEvaluacion,
  rendimientoNetoPct,
  rendimientoPct,
  volatilidadAnualPct,
} from "./metricas";

const serie = (valores: number[]) => valores.map((valorUsd, i) => ({ ts: `2026-10-0${i + 1}T22:00:00Z`, valorUsd }));

describe("rendimiento", () => {
  it("bruto contra el capital inicial y neto después de descontar el costo de IA", () => {
    expect(rendimientoPct(1_050, 1_000)).toBe(5);
    expect(rendimientoPct(940, 1_000)).toBe(-6);
    // 1.050 de valor menos 10 de IA: (1.040 / 1.000 - 1) = 4%
    expect(rendimientoNetoPct(1_050, 10, 1_000)).toBe(4);
    expect(rendimientoNetoPct(1_000, 0.5, 1_000)).toBe(-0.05);
  });
  it("con capital cero no divide por cero", () => {
    expect(rendimientoPct(100, 0)).toBe(0);
    expect(rendimientoNetoPct(100, 1, 0)).toBe(0);
  });
});

describe("drawdownMaximoPct", () => {
  it("mide la mayor caída desde un pico, no desde el inicio", () => {
    // pico 1.200, mínimo posterior 900: (1200 - 900) / 1200 = 25%
    expect(drawdownMaximoPct([1_000, 1_200, 1_100, 900, 1_000])).toBe(25);
  });
  it("una serie que solo sube no tiene drawdown", () => {
    expect(drawdownMaximoPct([1_000, 1_010, 1_050])).toBe(0);
  });
  it("toma la peor de varias caídas", () => {
    // caída 1: 1.000 -> 950 (5%); caída 2: 1.100 -> 880 (20%)
    expect(drawdownMaximoPct([1_000, 950, 1_100, 880])).toBe(20);
  });
  it("sin valores devuelve 0", () => {
    expect(drawdownMaximoPct([])).toBe(0);
  });
});

describe("volatilidadAnualPct", () => {
  it("coincide con la fórmula a mano: retornos de +1%, -1%, +1% -> desvío muestral anualizado", () => {
    const valores = [100, 101, 101 * 0.99, 101 * 0.99 * 1.01];
    const retornos = [0.01, -0.01, 0.01];
    const media = retornos.reduce((a, b) => a + b, 0) / 3;
    const desvio = Math.sqrt(retornos.reduce((a, b) => a + (b - media) ** 2, 0) / 2);
    expect(volatilidadAnualPct(valores)).toBeCloseTo(desvio * Math.sqrt(252) * 100, 1);
  });
  it("una serie sin variación tiene volatilidad cero", () => {
    expect(volatilidadAnualPct([100, 100, 100, 100])).toBe(0);
  });
  it("con pocos puntos no la calcula (null) en vez de inventar un número", () => {
    expect(volatilidadAnualPct([100, 101])).toBeNull();
    expect(volatilidadAnualPct([])).toBeNull();
  });
});

describe("porcentajeGanadoras", () => {
  it("una compra gana si subió, y una venta gana si el precio quedó por debajo de donde se vendió", () => {
    const resultado = porcentajeGanadoras([
      { accion: "comprar", precioEjecucion: 100, precioActual: 105 }, // gana
      { accion: "comprar", precioEjecucion: 100, precioActual: 95 }, // pierde
      { accion: "vender", precioEjecucion: 50, precioActual: 45 }, // gana (evitó la caída)
      { accion: "vender", precioEjecucion: 50, precioActual: 55 }, // pierde (se perdió la suba)
    ]);
    expect(resultado).toBe(50);
  });
  it("sin operaciones válidas devuelve null", () => {
    expect(porcentajeGanadoras([])).toBeNull();
    expect(porcentajeGanadoras([{ accion: "comprar", precioEjecucion: 0, precioActual: 10 }])).toBeNull();
  });
});

describe("calcularMetricasBot", () => {
  it("junta valor, rendimiento bruto y neto, drawdown, volatilidad, operaciones y costo, con el capital como punto de partida", () => {
    const metricas = calcularMetricasBot({
      capitalUsd: 1_000,
      serieCierre: serie([1_020, 1_100, 990]),
      costoIaUsd: 5,
      operaciones: [
        { accion: "comprar", precioEjecucion: 100, precioActual: 110 },
        { accion: "comprar", precioEjecucion: 100, precioActual: 90 },
      ],
    });
    expect(metricas).toMatchObject({
      valorUsd: 990,
      rendimientoBrutoPct: -1,
      rendimientoNetoPct: -1.5,
      costoIaUsd: 5,
      drawdownMaxPct: 10, // pico 1.100, mínimo 990
      operaciones: 2,
      pctGanadoras: 50,
      diasConDatos: 3,
    });
    expect(metricas?.volatilidadAnualPct).not.toBeNull();
  });

  it("si hay un valor más reciente que el último cierre lo usa como punto final", () => {
    const metricas = calcularMetricasBot({ capitalUsd: 1_000, serieCierre: serie([1_000, 1_100]), valorActualUsd: 880, costoIaUsd: 0, operaciones: [] });
    expect(metricas).toMatchObject({ valorUsd: 880, rendimientoBrutoPct: -12, drawdownMaxPct: 20, diasConDatos: 2 });
  });

  it("sin cierres ni valor actual devuelve null", () => {
    expect(calcularMetricasBot({ capitalUsd: 1_000, serieCierre: [], costoIaUsd: 0, operaciones: [] })).toBeNull();
  });
});

describe("compararPreguntas y redactarEvaluacion", () => {
  const metrica = (neto: number, bruto: number, ops: number, costo: number, dias = 30) => ({
    valorUsd: 1_000 * (1 + bruto / 100),
    rendimientoBrutoPct: bruto,
    rendimientoNetoPct: neto,
    costoIaUsd: costo,
    drawdownMaxPct: 5,
    volatilidadAnualPct: 12,
    operaciones: ops,
    pctGanadoras: 50,
    diasConDatos: dias,
  });
  const A = metrica(2.5, 3, 14, 0.5);
  const B = metrica(1.2, 1.6, 6, 0.4);
  const C = metrica(0.4, 0.5, 5, 0.1);
  const VOO = metrica(1, 1, 0, 0);

  it("calcula las tres preguntas del experimento con las diferencias en puntos, operaciones y costo de IA", () => {
    const comparacion = compararPreguntas({ A, B, C, VOO });
    expect(comparacion.dias).toBe(30);
    expect(comparacion.masInformacion).toEqual({ difNetoPuntos: 0.8, costoIaExtraUsd: 0.3 });
    expect(comparacion.reaccionar).toEqual({ difNetoPuntos: 1.3, operacionesExtra: 8, costoIaExtraUsd: 0.1 });
    expect(comparacion.contraVoo).toEqual([
      { clave: "A", difPuntos: 1.5 },
      { clave: "B", difPuntos: 0.2 },
      { clave: "C", difPuntos: -0.6 },
    ]);
  });

  it("si falta un bot o el benchmark, esa pregunta queda en null en vez de inventarse", () => {
    const sinC = compararPreguntas({ A, B, C: null, VOO: null });
    expect(sinC.masInformacion).toBeNull();
    expect(sinC.reaccionar).not.toBeNull();
    expect(sinC.contraVoo).toEqual([]);
    expect(compararPreguntas({ A: null, B: null, C: null, VOO: null })).toEqual({ dias: 0, masInformacion: null, reaccionar: null, contraVoo: [] });
  });

  it("la evaluación son números sin opinar y termina con la aclaración sobre la suerte", () => {
    const lineas = redactarEvaluacion(compararPreguntas({ A, B, C, VOO }), 182);
    expect(lineas[0]).toBe("Datos de 30 cierres de un experimento de 182 días.");
    expect(lineas[1]).toBe("Más información (B contra C): +0,80 puntos de rendimiento neto de IA, con US$0,30 más de IA.");
    expect(lineas[2]).toBe("Reaccionar durante el día (A contra B): +1,30 puntos, con 8 operaciones más y US$0,10 más de IA.");
    expect(lineas[3]).toBe("Contra VOO sin tocar: Bot A +1,50 puntos, Bot B +0,20 puntos, Bot C −0,60 puntos.");
    expect(lineas.at(-1)).toBe("6 meses es poco para descartar suerte.");
    expect(lineas.join(" ")).not.toMatch(/mejor|peor|gan[óo]|perd[ií]|recomend/i);
  });

  it("las diferencias negativas se muestran con signo menos y 'menos' en operaciones y costo", () => {
    const lineas = redactarEvaluacion(compararPreguntas({ A: B, B: A, C, VOO }), 182);
    expect(lineas[2]).toContain("−1,30 puntos, con 8 operaciones menos y US$0,10 menos de IA");
  });

  it("sin cierres lo dice y no inventa comparaciones", () => {
    const lineas = redactarEvaluacion(compararPreguntas({ A: null, B: null, C: null, VOO: null }), 182);
    expect(lineas).toEqual(["Todavía no hay cierres para comparar.", "6 meses es poco para descartar suerte."]);
  });
});
