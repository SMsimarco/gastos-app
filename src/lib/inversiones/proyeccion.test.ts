import { describe, expect, it } from "vitest";
import { calcularAhorroMensualPromedio, compararPalancas, proyectarDepto } from "./proyeccion";

describe("proyectarDepto", () => {
  it("ordena los tres escenarios de mejor a peor", () => {
    const resultado = proyectarDepto({ saldoActualUsd: 10_000, ahorroMensualPromedioUsd: 1_000, rendimientoAnualSupuesto: 0.07, precioObjetivoUsd: 100_000, fechaBase: new Date("2026-10-01T00:00:00Z") });
    expect(resultado.seLlega).toBe(true);
    expect(resultado.meses.optimista!).toBeLessThan(resultado.meses.base!);
    expect(resultado.meses.base!).toBeLessThan(resultado.meses.pesimista!);
    expect(resultado.fechaEstimada.optimista!.getTime()).toBeLessThan(resultado.fechaEstimada.base!.getTime());
  });

  it("devuelve que no se llega con ahorro cero o negativo", () => {
    for (const ahorro of [0, -100]) {
      const resultado = proyectarDepto({ saldoActualUsd: 1_000, ahorroMensualPromedioUsd: ahorro, rendimientoAnualSupuesto: 0.07, precioObjetivoUsd: 100_000 });
      expect(resultado.seLlega).toBe(false);
      expect(resultado.meses.base).toBeNull();
      expect(resultado.fechaEstimada.base).toBeNull();
    }
  });
});
describe("compararPalancas", () => {
  it("cada palanca acorta el plazo del caso base", () => {
    const resultado = compararPalancas({ saldoActualUsd: 5_000, ahorroMensualPromedioUsd: 500, ingresoMensualPromedioUsd: 2_000, gastoMensualPromedioUsd: 1_500, proyectoTipicoUsd: 3_000, rendimientoAnualSupuesto: 0.07, precioObjetivoUsd: 80_000 });
    expect(resultado).toHaveLength(4);
    expect(resultado.every((palanca) => palanca.mesesGanados !== null && palanca.mesesGanados > 0)).toBe(true);
  });
});

describe("calcularAhorroMensualPromedio", () => {
  it("usa seis meses completos, sus MEP y excluye el mes actual", () => {
    const hoy = new Date("2026-10-15T00:00:00Z");
    const movimientos = [
      { tipo: "ingreso" as const, monto_ars: 200_000, fecha: "2026-04-05" },
      { tipo: "gasto" as const, monto_ars: 100_000, fecha: "2026-04-10" },
      { tipo: "ingreso" as const, monto_ars: 300_000, fecha: "2026-05-05" },
      { tipo: "gasto" as const, monto_ars: 100_000, fecha: "2026-05-10" },
      { tipo: "ingreso" as const, monto_ars: 999_999, fecha: "2026-10-01" },
    ];
    const cambios = [
      { fecha: "2026-04-30", mep_venta: 1_000 },
      { fecha: "2026-05-31", mep_venta: 2_000 },
      { fecha: "2026-06-30", mep_venta: 1_500 },
      { fecha: "2026-07-31", mep_venta: 1_500 },
      { fecha: "2026-08-31", mep_venta: 1_500 },
      { fecha: "2026-09-30", mep_venta: 1_500 },
      { fecha: "2026-10-01", mep_venta: 1 },
    ];
    expect(calcularAhorroMensualPromedio(movimientos, cambios, hoy)).toBeCloseTo((100 + 100) / 6);
  });
});

