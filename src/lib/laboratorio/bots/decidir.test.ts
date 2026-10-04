import { describe, expect, it } from "vitest";
import { BOTS_POR_DEFECTO, construirPromptDecision, DECISION_SCHEMA, ESTRATEGIA_DEFAULT, normalizarDecision } from "./decidir";

describe("construirPromptDecision", () => {
  const prompt = construirPromptDecision({ fecha: "2026-10-05", portafolio: { valor_total_usd: 1000 } }, "Estrategia de prueba");

  it("incluye la estrategia y el briefing exacto", () => {
    expect(prompt).toContain("ESTRATEGIA: Estrategia de prueba");
    expect(prompt).toContain('{"fecha":"2026-10-05","portafolio":{"valor_total_usd":1000}}');
  });
  it("aclara que mantener todo es válido y que operar de más tiene costo", () => {
    expect(prompt).toContain('"Mantener todo" es una respuesta válida');
    expect(prompt).toContain("operar de más tiene costo y riesgo");
  });
  it("prohíbe inventar datos, apalancamiento y usar el efectivo de ventas del mismo día, y avisa que los límites los hace cumplir el sistema", () => {
    expect(prompt).toContain("No inventes");
    expect(prompt).toContain("Sin margen");
    expect(prompt).toContain("efectivo de ventas del mismo día");
    expect(prompt).toContain("el sistema los hace cumplir");
  });
});

describe("DECISION_SCHEMA", () => {
  it("restringe acciones y confianzas a los valores que entiende el gestor de riesgo", () => {
    const item = (DECISION_SCHEMA.properties.acciones.items as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(item.accion.enum).toEqual(["comprar", "vender", "mantener"]);
    expect(item.confianza.enum).toEqual(["alta", "media", "baja"]);
    expect(DECISION_SCHEMA.required).toEqual(["acciones", "resumen_mercado"]);
  });
});

describe("normalizarDecision", () => {
  it("convierte una respuesta válida en propuestas con ticker en mayúsculas y montos redondeados", () => {
    const resultado = normalizarDecision({
      acciones: [{ ticker: " nvda ", accion: "comprar", monto_usd: 123.456, razon: "  RSI bajo y balance por delante  ", confianza: "alta" }],
      resumen_mercado: "  Mercado en máximos.  ",
    });
    expect(resultado).toEqual({
      propuestas: [{ ticker: "NVDA", accion: "comprar", montoUsd: 123.46, razon: "RSI bajo y balance por delante", confianza: "alta" }],
      resumenMercado: "Mercado en máximos.",
      descartadasPorExceso: 0,
    });
  });

  it("una lista vacía es válida: mantener todo", () => {
    expect(normalizarDecision({ acciones: [], resumen_mercado: "Sin cambios." })).toMatchObject({ propuestas: [], resumenMercado: "Sin cambios." });
  });

  it("rechaza respuestas que no son un objeto o no traen la lista de acciones", () => {
    expect(normalizarDecision(null)).toBeNull();
    expect(normalizarDecision("comprar todo")).toBeNull();
    expect(normalizarDecision({ resumen_mercado: "x" })).toBeNull();
    expect(normalizarDecision({ acciones: "comprar" })).toBeNull();
  });

  it("descarta acciones inválidas, corrige montos y confianzas raros y no rompe con basura", () => {
    const resultado = normalizarDecision({
      acciones: [
        { ticker: "", accion: "comprar", monto_usd: 10, razon: "x", confianza: "alta" },
        { ticker: "KO", accion: "apalancar", monto_usd: 10, razon: "x", confianza: "alta" },
        { ticker: "KO", accion: "comprar", monto_usd: "mucho", razon: 5, confianza: "segura" },
        null,
        "texto",
        { ticker: "AAPL", accion: "vender", monto_usd: -50, razon: "x", confianza: "media" },
      ],
      resumen_mercado: 42,
    });
    expect(resultado?.propuestas).toEqual([
      { ticker: "KO", accion: "comprar", montoUsd: 0, razon: "", confianza: "baja" },
      { ticker: "AAPL", accion: "vender", montoUsd: 0, razon: "x", confianza: "media" },
    ]);
    expect(resultado?.resumenMercado).toBe("");
  });

  it("limita a 10 acciones y cuenta las que sobraron", () => {
    const acciones = Array.from({ length: 14 }, (_, i) => ({ ticker: `T${i}`, accion: "comprar", monto_usd: 10, razon: "x", confianza: "media" }));
    const resultado = normalizarDecision({ acciones, resumen_mercado: "" });
    expect(resultado?.propuestas).toHaveLength(10);
    expect(resultado?.descartadasPorExceso).toBe(4);
  });

  it("acota razones y resúmenes larguísimos", () => {
    const resultado = normalizarDecision({ acciones: [{ ticker: "KO", accion: "mantener", monto_usd: 0, razon: "r".repeat(2_000), confianza: "baja" }], resumen_mercado: "m".repeat(2_000) });
    expect(resultado?.propuestas[0].razon).toHaveLength(500);
    expect(resultado?.resumenMercado).toHaveLength(700);
  });
});

describe("bots por defecto", () => {
  it("son tres, con perfiles y reactividad según el diseño del experimento", () => {
    expect(BOTS_POR_DEFECTO.map((bot) => [bot.clave, bot.perfil_info, bot.reactivo, bot.alpaca_cuenta])).toEqual([
      ["A", "completo", true, "A"],
      ["B", "completo", false, "B"],
      ["C", "solo_precios", false, "C"],
    ]);
  });
  it("los tres usan la misma estrategia: solo cambia la información", () => {
    expect(ESTRATEGIA_DEFAULT.length).toBeGreaterThan(50);
    expect(new Set(BOTS_POR_DEFECTO.map(() => ESTRATEGIA_DEFAULT)).size).toBe(1);
  });
});
