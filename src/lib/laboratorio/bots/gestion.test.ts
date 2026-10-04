import { describe, expect, it } from "vitest";
import { repartirCostoCompartido } from "./cierre";
import { esClaveDeBot, validarCambiosBot, validarCambiosConfig } from "./gestion";

describe("validarCambiosConfig", () => {
  it("acepta activar y límites válidos, y normaliza el universo", () => {
    const resultado = validarCambiosConfig({ activo: true, universo: [" voo", "nvda", "VOO", "BRK.B"], max_pct_por_posicion: 15, drawdown_pausa_pct: 30 });
    expect(resultado).toEqual({ ok: true, cambios: { activo: true, universo: ["VOO", "NVDA", "BRK.B"], max_pct_por_posicion: 15, drawdown_pausa_pct: 30 } });
  });
  it("rechaza campos que no se pueden cambiar desde la pantalla (capital, modelos, fecha de inicio)", () => {
    for (const campo of ["capital_inicial_usd", "modelo_decision", "fecha_inicio", "usuario_id", "voo_cantidad"]) {
      expect(validarCambiosConfig({ [campo]: 1 }).ok, campo).toBe(false);
    }
  });
  it("rechaza valores fuera de rango, no numéricos o de tipo equivocado", () => {
    expect(validarCambiosConfig({ max_pct_por_posicion: 0 }).ok).toBe(false);
    expect(validarCambiosConfig({ max_pct_por_posicion: 101 }).ok).toBe(false);
    expect(validarCambiosConfig({ min_pct_efectivo: -1 }).ok).toBe(false);
    expect(validarCambiosConfig({ min_pct_efectivo: "mucho" }).ok).toBe(false);
    expect(validarCambiosConfig({ min_pct_efectivo: true }).ok).toBe(false);
    expect(validarCambiosConfig({ max_operaciones_por_dia: null }).ok).toBe(false);
    expect(validarCambiosConfig({ activo: "si" }).ok).toBe(false);
  });
  it("rechaza universos vacíos, enormes o con tickers inválidos", () => {
    expect(validarCambiosConfig({ universo: [] }).ok).toBe(false);
    expect(validarCambiosConfig({ universo: Array.from({ length: 31 }, (_, i) => `T${i}`) }).ok).toBe(false);
    expect(validarCambiosConfig({ universo: ["VOO", "no es un ticker"] }).ok).toBe(false);
    expect(validarCambiosConfig({ universo: ["VOO", 5] }).ok).toBe(false);
  });
  it("rechaza cuerpos vacíos o que no son objetos", () => {
    expect(validarCambiosConfig({}).ok).toBe(false);
    expect(validarCambiosConfig(null).ok).toBe(false);
    expect(validarCambiosConfig([1]).ok).toBe(false);
  });
});

describe("validarCambiosBot", () => {
  it("pausar a mano deja el motivo y despausar lo borra", () => {
    expect(validarCambiosBot({ pausado: true })).toEqual({ ok: true, cambios: { pausado: true, motivo_pausa: "Pausado a mano" } });
    expect(validarCambiosBot({ pausado: false })).toEqual({ ok: true, cambios: { pausado: false, motivo_pausa: null } });
  });
  it("acepta una estrategia de largo razonable y la recorta", () => {
    const resultado = validarCambiosBot({ estrategia_prompt: `   ${"Comprar barato y esperar. ".repeat(5)}   ` });
    expect(resultado.ok && (resultado.cambios.estrategia_prompt as string).startsWith("Comprar")).toBe(true);
  });
  it("rechaza estrategias muy cortas o muy largas y campos que no se tocan (perfil, cuenta, usuario)", () => {
    expect(validarCambiosBot({ estrategia_prompt: "corta" }).ok).toBe(false);
    expect(validarCambiosBot({ estrategia_prompt: "x".repeat(2_001) }).ok).toBe(false);
    for (const campo of ["perfil_info", "alpaca_cuenta", "usuario_id", "reactivo", "clave"]) {
      expect(validarCambiosBot({ [campo]: "A" }).ok, campo).toBe(false);
    }
    expect(validarCambiosBot({ pausado: "no" }).ok).toBe(false);
    expect(validarCambiosBot({}).ok).toBe(false);
  });
});

describe("esClaveDeBot", () => {
  it("solo A, B y C", () => {
    expect(["A", "B", "C"].every(esClaveDeBot)).toBe(true);
    expect(["D", "a", "", "AB"].some(esClaveDeBot)).toBe(false);
  });
});

describe("repartirCostoCompartido", () => {
  const bots = [
    { clave: "A", perfil_info: "completo" },
    { clave: "B", perfil_info: "completo" },
    { clave: "C", perfil_info: "solo_precios" },
  ];
  it("reparte el costo de noticias y diario solo entre los bots que los usan: el C no paga nada", () => {
    expect(repartirCostoCompartido(0.3, bots)).toEqual({ A: 0.15, B: 0.15, C: 0 });
  });
  it("si no hay bots completos no reparte nada", () => {
    expect(repartirCostoCompartido(1, [{ clave: "C", perfil_info: "solo_precios" }])).toEqual({ C: 0 });
  });
});
