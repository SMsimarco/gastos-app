import { describe, expect, it } from "vitest";
import type { Movimiento } from "./gemini";
import { resolverCobroEnPesos } from "./cobroEnPesos";

const base: Movimiento = {
  tipo: "ingreso",
  monto: 500,
  moneda: "USD",
  descripcion: "Cobro de cliente",
  comercio: null,
  categoria: "Clientes",
  metodo_pago: "transferencia",
  cuotas: 1,
  fecha: "2026-10-10",
  confianza: "alta",
  transcripcion_raw: "cobré 500 dólares, me transfirieron 725000 pesos",
};

describe("resolverCobroEnPesos", () => {
  it("guarda los pesos reales como ARS con el tc implícito y los USD de referencia", () => {
    const resultado = resolverCobroEnPesos({ ...base, monto_ars_recibido: 725_000 });
    expect(resultado?.item.moneda).toBe("ARS");
    expect(resultado?.item.monto).toBe(725_000);
    expect(resultado?.tcUsado).toBe(1_450);
    expect(resultado?.montoUsd).toBe(500);
  });

  it("sin pesos recibidos no cambia nada", () => {
    expect(resolverCobroEnPesos(base)).toBeNull();
    expect(resolverCobroEnPesos({ ...base, monto_ars_recibido: 0 })).toBeNull();
  });

  it("solo aplica a cobros en USD", () => {
    expect(resolverCobroEnPesos({ ...base, moneda: "ARS", monto_ars_recibido: 725_000 })).toBeNull();
  });
});
