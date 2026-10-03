import { describe, expect, it } from "vitest";
import { calcularGastoMensual, calcularReparto, type ConfigReparto } from "./reparto";

const configDefault: ConfigReparto = {
  pctGastos: 25,
  pctLargoPlazo: 65,
  pctAprender: 10,
  emergenciaPrimero: true,
  mesesEmergencia: 3,
  minimoCompraUsd: 100,
};

describe("calcularReparto", () => {
  it("reparte el caso real y prioriza la emergencia", () => {
    const resultado = calcularReparto({
      montoIngresoArs: 690_000,
      saldos: { gastos: 260_000, emergencia: 209, porInvertir: 0 },
      gastoMensualArs: 200_000,
      tcReferencia: 1_544,
      config: configDefault,
    });

    expect(resultado.gastos).toBe(172_500);
    expect(resultado.emergencia).toBe(179.6);
    expect(resultado.largo_plazo).toBe(134.83);
    expect(resultado.aprender).toBe(0);
    expect(resultado.por_invertir).toBe(20.74);
    expect(resultado.acciones.length).toBeGreaterThan(0);
  });

  it("con la emergencia completa aplica los porcentajes puros", () => {
    const resultado = calcularReparto({
      montoIngresoArs: 1_544_000,
      saldos: { gastos: 400_000, emergencia: 1_000 },
      gastoMensualArs: 200_000,
      tcReferencia: 1_544,
      config: configDefault,
    });

    expect(resultado.gastos).toBe(386_000);
    expect(resultado.emergencia).toBe(0);
    expect(resultado.largo_plazo).toBe(650);
    expect(resultado.aprender).toBe(100);
    expect(resultado.por_invertir).toBe(0);
  });

  it("acumula asignaciones menores al mínimo de compra", () => {
    const resultado = calcularReparto({
      montoIngresoArs: 154_400,
      saldos: { gastos: 200_000, emergencia: 1_000 },
      gastoMensualArs: 100_000,
      tcReferencia: 1_544,
      config: configDefault,
    });

    expect(resultado.largo_plazo).toBe(0);
    expect(resultado.aprender).toBe(0);
    expect(resultado.por_invertir).toBe(75);
  });

  it("manda todo a gastos cuando un ingreso chico no alcanza para el piso", () => {
    const resultado = calcularReparto({
      montoIngresoArs: 100_000,
      saldos: { gastos: 0, emergencia: 0 },
      gastoMensualArs: 200_000,
      tcReferencia: 1_544,
      config: configDefault,
    });

    expect(resultado.gastos).toBe(100_000);
    expect(resultado.emergencia + resultado.largo_plazo + resultado.aprender + resultado.por_invertir).toBe(0);
  });

  it("conserva exactamente el total disponible en centavos de cada moneda", () => {
    const resultado = calcularReparto({
      montoIngresoArs: 100_003,
      saldos: { gastos: 80_000, emergencia: 1_000 },
      gastoMensualArs: 50_000,
      tcReferencia: 1_544,
      config: configDefault,
    });
    const disponibleUsd = Math.round(((100_003 - resultado.gastos) / 1_544) * 100) / 100;
    const asignadoUsd =
      resultado.emergencia + resultado.largo_plazo + resultado.aprender + resultado.por_invertir;

    expect(Math.round(asignadoUsd * 100) / 100).toBe(disponibleUsd);
  });

  it("un cobro de US$500 convertido y repartido con el mismo MEP conserva los 500 dólares", () => {
    const mep = 1_544;
    const montoIngresoArs = Math.round(500 * mep * 100) / 100;
    const gastoMensualArs = 200_000;
    const resultado = calcularReparto({
      montoIngresoArs,
      saldos: { gastos: 260_000, emergencia: 209, porInvertir: 0 },
      gastoMensualArs,
      tcReferencia: mep,
      config: configDefault,
    });
    const totalUsd =
      resultado.emergencia +
      resultado.largo_plazo +
      resultado.aprender +
      resultado.por_invertir +
      resultado.gastos / mep;

    expect(Math.abs(totalUsd - 500)).toBeLessThanOrEqual(0.01);
  });

  it("rechaza porcentajes que no suman 100", () => {
    expect(() =>
      calcularReparto({
        montoIngresoArs: 100_000,
        saldos: { gastos: 0, emergencia: 0 },
        gastoMensualArs: 50_000,
        tcReferencia: 1_000,
        config: { ...configDefault, pctAprender: 11 },
      })
    ).toThrow("deben sumar 100");
  });
});

describe("calcularGastoMensual", () => {
  const hoy = new Date("2026-10-02T00:00:00Z");

  it("promedia los tres meses completos y excluye el mes actual y cuotas futuras", () => {
    const resultado = calcularGastoMensual(
      [
        { tipo: "gasto", monto_ars: 100_000, fecha: "2026-07-15" },
        { tipo: "gasto", monto_ars: 200_000, fecha: "2026-08-10" },
        { tipo: "gasto", monto_ars: 300_000, fecha: "2026-09-05" },
        { tipo: "gasto", monto_ars: 999_999, fecha: "2026-10-01" },
        { tipo: "gasto", monto_ars: 999_999, fecha: "2026-12-01" },
        { tipo: "ingreso", monto_ars: 690_000, fecha: "2026-09-01" },
      ],
      hoy
    );

    expect(resultado).toBe(200_000);
  });

  it("usa cero para meses sin gastos dentro de la ventana", () => {
    expect(calcularGastoMensual([{ tipo: "gasto", monto_ars: 90_000, fecha: "2026-09-10" }], hoy)).toBe(30_000);
  });

  it("sin gastos devuelve null para habilitar el valor manual", () => {
    expect(calcularGastoMensual([], hoy)).toBeNull();
  });
});
