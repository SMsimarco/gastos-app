import { describe, expect, it } from "vitest";
import { esDomingoEnArgentina, seleccionarAvisos, type CandidatoAviso } from "./avisos";

const mercado = (clave: string): CandidatoAviso => ({ clave, mensaje: clave, categoria: "mercado" });

describe("avisos de Telegram", () => {
  it("no repite una clave enviada hoy", () => {
    expect(seleccionarAvisos([mercado("mercado:voo")], new Set(["mercado:voo"]), new Set())).toEqual([]);
  });

  it("envía como máximo una alerta de mercado por usuario y día", () => {
    expect(seleccionarAvisos([mercado("mercado:voo"), mercado("mercado:ypf")], new Set(), new Set())).toHaveLength(1);
    expect(seleccionarAvisos([mercado("mercado:ypf")], new Set(["mercado:voo"]), new Set())).toEqual([]);
  });

  it("un reparto vencido se avisa una sola vez en toda su vida", () => {
    const candidato: CandidatoAviso = { clave: "reparto:1", mensaje: "pendiente", categoria: "reparto", soloUnaVez: true };
    expect(seleccionarAvisos([candidato], new Set(), new Set(["reparto:1"]))).toEqual([]);
  });

  it("solo reconoce domingo usando la zona horaria argentina", () => {
    expect(esDomingoEnArgentina(new Date("2026-10-04T23:00:00Z"))).toBe(true);
    expect(esDomingoEnArgentina(new Date("2026-10-05T23:00:00Z"))).toBe(false);
  });
});

