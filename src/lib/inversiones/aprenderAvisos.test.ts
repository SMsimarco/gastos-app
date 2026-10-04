import { vi } from "vitest";

vi.mock("./aprenderDatos", () => ({ cargarEstadoAprender: vi.fn() }));

import { describe, expect, it } from "vitest";
import type { ResultadoAprender } from "./aprender";
import { claveAlerta, decidirAvisosAprender } from "./aprenderAvisos";

function resultado(cambios: Partial<ResultadoAprender> = {}): ResultadoAprender {
  return { puedeComprar: true, saldoUsd: 120, faltaUsd: 0, candidatos: [], excluidos: [], voo: null, opcionEsperar: { accion: "esperar_o_sumar_a_voo", motivo: "x" }, alertas: [], advertencias: [], ...cambios };
}

const alertaGanancia = { tipo: "objetivo_ganancia", prioridad: 400, mensaje: "MSFT llegó a tu objetivo", datos: { ticker: "MSFT" } };

describe("decidirAvisosAprender", () => {
  it("avisa cuando el saldo supera el mínimo y no hubo aviso esta semana", () => {
    expect(decidirAvisosAprender({ hoy: "2026-10-05", resultado: resultado(), historial: [] }).enviarAviso).toBe(true);
  });

  it("no avisa si el saldo no llega al mínimo", () => {
    expect(decidirAvisosAprender({ hoy: "2026-10-05", resultado: resultado({ puedeComprar: false, faltaUsd: 30 }), historial: [] }).enviarAviso).toBe(false);
  });

  it("máximo 1 aviso por semana", () => {
    const historial = [{ clave: "aprender-aviso:2026-10-01", fecha: "2026-10-01" }];
    expect(decidirAvisosAprender({ hoy: "2026-10-05", resultado: resultado(), historial }).enviarAviso).toBe(false);
    // 7 días después de un aviso ya se puede de nuevo
    expect(decidirAvisosAprender({ hoy: "2026-10-08", resultado: resultado(), historial }).enviarAviso).toBe(true);
  });

  it("toma de ganancia y revisión salen aunque ya haya habido un aviso esta semana, pero no se repiten", () => {
    const base = resultado({ alertas: [alertaGanancia] });
    const conAvisoReciente = [{ clave: "aprender-aviso:2026-10-04", fecha: "2026-10-04" }];
    expect(decidirAvisosAprender({ hoy: "2026-10-05", resultado: base, historial: conAvisoReciente }).alertas).toHaveLength(1);
    const yaAvisada = [...conAvisoReciente, { clave: claveAlerta(alertaGanancia), fecha: "2026-10-03" }];
    expect(decidirAvisosAprender({ hoy: "2026-10-05", resultado: base, historial: yaAvisada }).alertas).toHaveLength(0);
  });

  it("las alertas salen aunque el saldo no llegue al mínimo", () => {
    const decision = decidirAvisosAprender({ hoy: "2026-10-05", resultado: resultado({ puedeComprar: false, alertas: [alertaGanancia] }), historial: [] });
    expect(decision.enviarAviso).toBe(false);
    expect(decision.alertas).toHaveLength(1);
  });
});
