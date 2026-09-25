import { describe, it, expect } from "vitest";
import { calcularReparto, calcularGastoMensual, type ConfigPlan } from "./plan";

const configDefault: ConfigPlan = {
  mesesEmergencia: 3,
  mesesCoberturaGastos: 1.5,
  pctDepto: 85,
  umbralCompraUsd: 100,
};

describe("calcularReparto", () => {
  it("caso real: cobro de proyecto con saldos parciales", () => {
    const r = calcularReparto({
      montoIngresoArs: 690000,
      saldos: { gastos: 60000, emergencia: 209.43 },
      gastoMensualArs: 200000,
      tcReferencia: 1544,
      config: configDefault,
    });

    expect(r.gastos).toBe(240000); // 200000*1.5 - 60000
    expect(r.emergencia).toBe(179.17);
    expect(r.depto).toBe(95.44);
    expect(r.aprender).toBe(16.84);
    expect(r.metaEmergenciaUsd).toBe(388.6);
    expect(r.explicacion.length).toBeGreaterThan(0);
  });

  it("ingreso que no alcanza ni para gastos: todo va a gastos", () => {
    const r = calcularReparto({
      montoIngresoArs: 100000,
      saldos: { gastos: 60000, emergencia: 209.43 },
      gastoMensualArs: 200000,
      tcReferencia: 1544,
      config: configDefault,
    });

    expect(r.gastos).toBe(100000);
    expect(r.emergencia).toBe(0);
    expect(r.depto).toBe(0);
    expect(r.aprender).toBe(0);
  });

  it("emergencia ya completa: nada va a emergencia", () => {
    const r = calcularReparto({
      montoIngresoArs: 690000,
      saldos: { gastos: 240000, emergencia: 500 }, // > meta de 388.6
      gastoMensualArs: 200000,
      tcReferencia: 1544,
      config: configDefault,
    });

    expect(r.emergencia).toBe(0);
    expect(r.gastos).toBe(60000); // 200000*1.5 - 240000
  });

  it("suma exacta con montos que generan residuo de redondeo", () => {
    const r = calcularReparto({
      montoIngresoArs: 100003,
      saldos: { gastos: 240000, emergencia: 500 },
      gastoMensualArs: 200000,
      tcReferencia: 1544,
      config: configDefault,
    });

    expect(r.gastos).toBe(60000);
    expect(r.emergencia).toBe(0);
    // el resto en USD se reparte entero entre depto y aprender, residuo a depto
    const restoUsd = (100003 - 60000) / 1544;
    expect(Math.round((r.depto + r.aprender) * 100) / 100).toBe(Math.round(restoUsd * 100) / 100);
  });

  it("depto bajo el umbral → sugerirCompraVOO = false", () => {
    const r = calcularReparto({
      montoIngresoArs: 100000,
      saldos: { gastos: 400000, emergencia: 500 },
      gastoMensualArs: 200000,
      tcReferencia: 1544,
      config: configDefault,
    });

    expect(r.depto).toBe(55.05);
    expect(r.sugerirCompraVOO).toBe(false);
  });

  it("depto igual o por encima del umbral → sugerirCompraVOO = true", () => {
    const r = calcularReparto({
      montoIngresoArs: 690000,
      saldos: { gastos: 240000, emergencia: 500 }, // emergencia y gastos ya cubiertos
      gastoMensualArs: 200000,
      tcReferencia: 1544,
      config: configDefault,
    });

    expect(r.depto).toBeGreaterThanOrEqual(configDefault.umbralCompraUsd);
    expect(r.sugerirCompraVOO).toBe(true);
  });
});

describe("calcularGastoMensual", () => {
  const hoy = new Date("2026-09-25T00:00:00Z");

  it("promedia los últimos 3 meses completos, excluye el mes en curso y cuotas futuras", () => {
    const movimientos = [
      { tipo: "gasto" as const, monto_ars: 100000, fecha: "2026-06-15" },
      { tipo: "gasto" as const, monto_ars: 200000, fecha: "2026-07-10" },
      { tipo: "gasto" as const, monto_ars: 300000, fecha: "2026-08-05" },
      { tipo: "gasto" as const, monto_ars: 999999, fecha: "2026-09-01" }, // mes en curso, se excluye
      { tipo: "gasto" as const, monto_ars: 999999, fecha: "2026-12-01" }, // cuota futura, se excluye
      { tipo: "ingreso" as const, monto_ars: 690000, fecha: "2026-08-01" }, // no es gasto
    ];

    expect(calcularGastoMensual(movimientos, hoy)).toBe(200000);
  });

  it("con menos de 1 mes completo de datos devuelve null", () => {
    const movimientos = [{ tipo: "gasto" as const, monto_ars: 100000, fecha: "2026-09-10" }];
    expect(calcularGastoMensual(movimientos, hoy)).toBeNull();
  });

  it("sin ningún movimiento devuelve null", () => {
    expect(calcularGastoMensual([], hoy)).toBeNull();
  });
});
