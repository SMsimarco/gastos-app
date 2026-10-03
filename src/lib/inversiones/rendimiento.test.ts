import { describe, expect, it } from "vitest";
import { calcularCartera, type ActivoRendimiento } from "./rendimiento";

const voo: ActivoRendimiento = {
  id: "voo", ticker: "VOO", nombre: "VOO", tipo: "etf", moneda: "USD",
  bolsillo_clave: "largo_plazo", tasa_anual: null,
};

const base = {
  activos: [voo],
  bolsillos: [],
  inflacionMensualPct: null,
  tcReferencia: 1_500,
  hoy: "2026-10-02",
};

describe("calcularCartera", () => {
  it("calcula una compra simple con comisión", () => {
    const resultado = calcularCartera({
      ...base,
      operaciones: [{ activo_id: "voo", tipo: "compra", fecha: "2026-09-01", cantidad: 2, precio_usd: 100, monto_usd: 200, comision_usd: 1 }],
      precios: [{ ticker: "VOO", fecha: "2026-10-02", cierre_usd: 120 }],
    });
    expect(resultado.activos[0]).toMatchObject({ cantidad: 2, costoPromedioUsd: 100.5, invertidoUsd: 201, valorActualUsd: 240, gananciaUsd: 39 });
  });

  it("pondera varias compras a precios distintos", () => {
    const resultado = calcularCartera({
      ...base,
      operaciones: [
        { activo_id: "voo", tipo: "compra", fecha: "2026-08-01", cantidad: 1, precio_usd: 100, monto_usd: 100, comision_usd: 0 },
        { activo_id: "voo", tipo: "compra", fecha: "2026-09-01", cantidad: 2, precio_usd: 130, monto_usd: 260, comision_usd: 0 },
      ],
      precios: [{ ticker: "VOO", fecha: "2026-10-02", cierre_usd: 140 }],
    });
    expect(resultado.activos[0].cantidad).toBe(3);
    expect(resultado.activos[0].costoPromedioUsd).toBe(120);
    expect(resultado.activos[0].gananciaUsd).toBe(60);
  });

  it("estima una cuenta remunerada y su rendimiento real", () => {
    const cuenta: ActivoRendimiento = {
      id: "ars", ticker: "ARS-REM", nombre: "ARS Remunerada", tipo: "cuenta_remunerada",
      moneda: "ARS", bolsillo_clave: "gastos", tasa_anual: 19.22,
    };
    const resultado = calcularCartera({
      ...base,
      activos: [cuenta],
      operaciones: [],
      precios: [],
      bolsillos: [{ clave: "gastos", saldo: 1_200_000 }],
      inflacionMensualPct: 2,
    });
    expect(resultado.cuentas[0]).toMatchObject({ rendimientoMes: 19_220, rendimientoAnio: 230_640, tasaRealAnualPct: -4.78, rendimientoRealMes: -4_780 });
  });

  it("marca cuando la alternativa VOO hubiera rendido más", () => {
    const accion: ActivoRendimiento = { ...voo, id: "abc", ticker: "ABC", nombre: "Aprender", tipo: "accion", bolsillo_clave: "aprender" };
    const resultado = calcularCartera({
      ...base,
      activos: [voo, accion],
      operaciones: [{ activo_id: "abc", tipo: "compra", fecha: "2026-09-01", cantidad: 10, precio_usd: 10, monto_usd: 100, comision_usd: 0 }],
      precios: [
        { ticker: "ABC", fecha: "2026-10-02", cierre_usd: 9 },
        { ticker: "VOO", fecha: "2026-09-01", cierre_usd: 100 },
        { ticker: "VOO", fecha: "2026-10-02", cierre_usd: 120 },
      ],
    });
    expect(resultado.benchmark).toMatchObject({ valorVooUsd: 120, diferenciaUsd: 30, hubieraSidoMejorVoo: true });
  });

  it("marca un precio con más de un día hábil", () => {
    const resultado = calcularCartera({
      ...base,
      operaciones: [{ activo_id: "voo", tipo: "compra", fecha: "2026-09-01", cantidad: 1, precio_usd: 100, monto_usd: 100, comision_usd: 0 }],
      precios: [{ ticker: "VOO", fecha: "2026-09-29", cierre_usd: 110 }],
    });
    expect(resultado.activos[0].precioDesactualizado).toBe(true);
  });
});
