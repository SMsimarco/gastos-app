import { describe, expect, it } from "vitest";
import { costoLlamadaUsd, evaluarPresupuesto, inicioDeMesUtc } from "./presupuesto";

describe("costoLlamadaUsd", () => {
  it("calcula con el precio por millón de tokens del modelo", () => {
    // 100.000 de entrada a 0,30 + 10.000 de salida a 2,50 = 0,03 + 0,025
    expect(costoLlamadaUsd("gemini-3.5-flash-lite", 100_000, 10_000)).toBeCloseTo(0.055, 6);
  });
  it("un modelo desconocido se cobra al precio más caro conocido", () => {
    expect(costoLlamadaUsd("modelo-nuevo", 1_000_000, 1_000_000)).toBeCloseTo(1.5 + 9, 6);
  });
});

describe("inicioDeMesUtc", () => {
  it("devuelve el primer instante del mes", () => {
    expect(inicioDeMesUtc(new Date("2026-10-17T15:30:00Z"))).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("evaluarPresupuesto", () => {
  it("con presupuesto disponible permite la llamada", () => {
    const estado = evaluarPresupuesto({ gastadoMesUsd: 3, topeUsd: 10, costoEstimadoUsd: 0.1 });
    expect(estado).toMatchObject({ permitido: true, restanteUsd: 7, motivo: null });
  });
  it("con el tope alcanzado no permite llamar a la IA", () => {
    const estado = evaluarPresupuesto({ gastadoMesUsd: 10, topeUsd: 10 });
    expect(estado).toMatchObject({ permitido: false, restanteUsd: 0, motivo: "sin_presupuesto" });
  });
  it("con el tope superado tampoco", () => {
    expect(evaluarPresupuesto({ gastadoMesUsd: 10.5, topeUsd: 10 }).permitido).toBe(false);
  });
  it("no permite una llamada cuyo costo estimado supera lo que queda", () => {
    const estado = evaluarPresupuesto({ gastadoMesUsd: 9.95, topeUsd: 10, costoEstimadoUsd: 0.1 });
    expect(estado).toMatchObject({ permitido: false, motivo: "superaria_el_tope" });
  });
  it("un tope en cero bloquea todo", () => {
    expect(evaluarPresupuesto({ gastadoMesUsd: 0, topeUsd: 0 }).permitido).toBe(false);
  });
});
