import { describe, expect, it } from "vitest";
import { calcularPromedioPe5a } from "./aprenderPe";

// 20 trimestres hacia atrás desde 2026-09-30, con P/E de 30 a 49
function serie(cantidad: number) {
  return Array.from({ length: cantidad }, (_, i) => {
    const fecha = new Date(Date.UTC(2026, 8, 30));
    fecha.setUTCMonth(fecha.getUTCMonth() - 3 * i);
    return { period: fecha.toISOString().slice(0, 10), v: 30 + i };
  });
}

describe("promedio de P/E de 5 años", () => {
  it("promedia solo los últimos 5 años", () => {
    const resultado = calcularPromedioPe5a(serie(30), "2026-10-05")!;
    expect(resultado.muestras).toBeLessThanOrEqual(21);
    expect(resultado.muestras).toBeGreaterThanOrEqual(20);
    // los 20 trimestres más recientes valen 30..49 (promedio 39,5); el 21º (50) puede entrar según la fecha exacta
    expect(resultado.promedio).toBeGreaterThanOrEqual(39.5);
    expect(resultado.promedio).toBeLessThanOrEqual(40);
  });

  it("ignora P/E negativos, nulos y fechas futuras", () => {
    const base = serie(20);
    const sucio = [...base, { period: "2026-12-31", v: 999 }, { period: "2026-06-30", v: -5 }, { period: "2026-03-31", v: null }];
    expect(calcularPromedioPe5a(sucio, "2026-10-05")!.promedio).toBe(calcularPromedioPe5a(base, "2026-10-05")!.promedio);
  });

  it("con menos de 12 trimestres no calcula nada", () => {
    expect(calcularPromedioPe5a(serie(11), "2026-10-05")).toBeNull();
    expect(calcularPromedioPe5a([], "2026-10-05")).toBeNull();
  });
});
