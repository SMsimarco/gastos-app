import { describe, expect, it } from "vitest";
import { calcularIndicadores, media, rsi, volatilidadAnualizada, type Barra } from "./indicadores";

function barras(cierres: number[], volumenes?: number[]): Barra[] {
  return cierres.map((cierre, i) => ({
    fecha: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    cierre,
    volumen: volumenes?.[i] ?? 1_000,
  }));
}

describe("media", () => {
  it("promedia las últimas n ruedas", () => {
    expect(media([1, 2, 3, 4, 5], 3)).toBe(4);
  });
  it("devuelve null si no hay datos suficientes", () => {
    expect(media([1, 2], 3)).toBeNull();
  });
});

describe("rsi", () => {
  it("coincide con el cálculo a mano: 7 subas de 2 y 7 bajas de 1 dan RSI 66,67", () => {
    // ganancia promedio = 14/14 = 1; pérdida promedio = 7/14 = 0,5; RS = 2; RSI = 100 - 100/3
    const serie = [100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 108, 107];
    expect(rsi(serie, 14)).toBeCloseTo(66.6667, 3);
  });
  it("una serie que solo sube da 100 y una plana da 50", () => {
    expect(rsi(Array.from({ length: 15 }, (_, i) => 100 + i), 14)).toBe(100);
    expect(rsi(Array.from({ length: 15 }, () => 100), 14)).toBe(50);
  });
  it("aplica el suavizado de Wilder a partir de la rueda 15", () => {
    const serie = [100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 108, 107, 109];
    // tras 14 variaciones: gan=1, perd=0,5; la 15ª es +2 => gan=(1*13+2)/14, perd=0,5*13/14
    const gan = 15 / 14;
    const perd = 6.5 / 14;
    expect(rsi(serie, 14)).toBeCloseTo(100 - 100 / (1 + gan / perd), 6);
  });
  it("sin datos suficientes devuelve null", () => {
    expect(rsi([1, 2, 3], 14)).toBeNull();
  });
});

describe("volatilidadAnualizada", () => {
  it("una serie con retorno constante tiene volatilidad cero", () => {
    const serie = Array.from({ length: 21 }, (_, i) => 100 * 1.01 ** i);
    expect(volatilidadAnualizada(serie, 20)).toBeCloseTo(0, 6);
  });
  it("alternando 100 y 110 coincide con la fórmula a mano", () => {
    const serie = Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 100 : 110));
    const a = Math.log(1.1);
    // 20 retornos: 10 de +a y 10 de -a => media 0, varianza muestral = 20a²/19
    const esperado = Math.sqrt((20 * a * a) / 19) * Math.sqrt(252) * 100;
    expect(volatilidadAnualizada(serie, 20)).toBeCloseTo(esperado, 6);
  });
});

describe("calcularIndicadores", () => {
  it("calcula variaciones, distancia al máximo y volumen relativo", () => {
    const cierres = Array.from({ length: 60 }, (_, i) => 100 + i); // 100..159
    const volumenes = Array.from({ length: 60 }, (_, i) => (i === 59 ? 3_000 : 1_000));
    const resultado = calcularIndicadores(barras(cierres, volumenes))!;
    expect(resultado.cierre).toBe(159);
    expect(resultado.cierre_anterior).toBe(158);
    expect(resultado.variacion_dia).toBeCloseTo((159 / 158 - 1) * 100, 2);
    expect(resultado.variacion_semana).toBeCloseTo((159 / 154 - 1) * 100, 2);
    expect(resultado.variacion_mes).toBeCloseTo((159 / 138 - 1) * 100, 2);
    expect(resultado.distancia_max52s).toBe(0);
    expect(resultado.volumen_relativo).toBe(3);
    expect(resultado.sma20).toBe(149.5); // promedio de 140..159
    expect(resultado.sma50).toBe(134.5); // promedio de 110..159
    expect(resultado.sma200).toBeNull();
  });
  it("mide la distancia al máximo cuando el precio cayó", () => {
    const resultado = calcularIndicadores(barras([100, 200, 150]))!;
    expect(resultado.distancia_max52s).toBe(-25);
  });
  it("sin barras devuelve null", () => {
    expect(calcularIndicadores([])).toBeNull();
  });
});
