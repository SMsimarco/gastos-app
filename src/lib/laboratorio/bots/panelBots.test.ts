import { describe, expect, it } from "vitest";
import { armarPanelBots, DIAS_EXPERIMENTO } from "./panelBots";

const bots = [
  { id: "c", clave: "C", nombre: "Bot C", perfil_info: "solo_precios", reactivo: false, pausado: false, motivo_pausa: null },
  { id: "a", clave: "A", nombre: "Bot A", perfil_info: "completo", reactivo: true, pausado: false, motivo_pausa: null },
  { id: "b", clave: "B", nombre: "Bot B", perfil_info: "completo", reactivo: false, pausado: true, motivo_pausa: "Pausado a mano" },
];

describe("armarPanelBots", () => {
  it("sin configuración ni datos devuelve el panel vacío e inactivo, con los bots en orden A, B, C", () => {
    const panel = armarPanelBots({ config: null, bots, snapshots: [], corridas: [], decisiones: [], hoy: "2026-10-05" });
    expect(panel.activo).toBe(false);
    expect(panel.bots.map((bot) => bot.clave)).toEqual(["A", "B", "C"]);
    expect(panel.bots.every((bot) => bot.valorUsd === null && bot.ultimaCorrida === null)).toBe(true);
    expect(panel.benchmark).toBeNull();
    expect(panel.diasTranscurridos).toBeNull();
    expect(panel.diasTotales).toBe(DIAS_EXPERIMENTO);
  });

  it("calcula rendimiento de cada bot y del benchmark VOO contra el capital inicial y los días de la corrida", () => {
    const panel = armarPanelBots({
      config: { activo: true, fecha_inicio: "2026-10-01", capital_inicial_usd: 1_000 },
      bots,
      snapshots: [
        { bot_id: "a", ts: "2026-10-05T22:00:00Z", valor_usd: 1_012.5, efectivo_usd: 600, costo_ia_acumulado_usd: 0.12, posiciones: [{ ticker: "NVDA", valor_usd: 200, resultado_pct: 3.1 }] },
        { bot_id: null, ts: "2026-10-05T22:00:00Z", valor_usd: 1_005, efectivo_usd: 0, costo_ia_acumulado_usd: 0, posiciones: [] },
        { bot_id: "a", ts: "2026-10-04T22:00:00Z", valor_usd: 990, efectivo_usd: 800, costo_ia_acumulado_usd: 0.1, posiciones: [] },
      ],
      corridas: [],
      decisiones: [],
      hoy: "2026-10-05",
    });
    const botA = panel.bots.find((bot) => bot.clave === "A")!;
    expect(botA).toMatchObject({ valorUsd: 1_012.5, efectivoUsd: 600, rendimientoPct: 1.25, costoIaUsd: 0.12 });
    expect(botA.posiciones).toEqual([{ ticker: "NVDA", valorUsd: 200, resultadoPct: 3.1 }]);
    expect(panel.benchmark).toEqual({ valorUsd: 1_005, rendimientoPct: 0.5 });
    expect(panel.diasTranscurridos).toBe(4);
    expect(panel.bots.find((bot) => bot.clave === "B")).toMatchObject({ pausado: true, motivoPausa: "Pausado a mano" });
  });

  it("une la última corrida de cada bot con sus decisiones, incluyendo lo que recortó el gestor de riesgo", () => {
    const panel = armarPanelBots({
      config: { activo: true, fecha_inicio: "2026-10-01", capital_inicial_usd: 1_000 },
      bots,
      snapshots: [],
      corridas: [
        { id: "c2", bot_id: "a", ts: "2026-10-05T14:30:00Z", estado: "ok", disparador: "diaria", modelo: "gemini-3.5-flash", error: null, respuesta_ia: { resumen_mercado: "Mercado en máximos." } },
        { id: "c1", bot_id: "a", ts: "2026-10-04T14:30:00Z", estado: "sin_cambios", disparador: "diaria", modelo: "gemini-3.5-flash", error: null, respuesta_ia: null },
        { id: "c3", bot_id: "c", ts: "2026-10-05T14:31:00Z", estado: "error", disparador: "diaria", modelo: null, error: "Gemini falló: 503", respuesta_ia: null },
      ],
      decisiones: [
        { corrida_id: "c2", ticker: "NVDA", accion: "comprar", monto_propuesto_usd: 400, monto_aprobado_usd: 200, razon_ia: "RSI bajo", ajuste_riesgo: "Recortada de US$400.00 a US$200.00 por máximo por posición 20%", estado_orden: "filled", precio_ejecucion: 234.1 },
        { corrida_id: "c1", ticker: "KO", accion: "mantener", monto_propuesto_usd: 0, monto_aprobado_usd: 0, razon_ia: "sin razón clara", ajuste_riesgo: null, estado_orden: "sin_orden", precio_ejecucion: null },
      ],
      hoy: "2026-10-05",
    });
    const botA = panel.bots.find((bot) => bot.clave === "A")!;
    expect(botA.ultimaCorrida).toMatchObject({ estado: "ok", resumenMercado: "Mercado en máximos.", modelo: "gemini-3.5-flash" });
    expect(botA.ultimaCorrida?.decisiones).toEqual([
      { ticker: "NVDA", accion: "comprar", montoPropuestoUsd: 400, montoAprobadoUsd: 200, razon: "RSI bajo", ajuste: "Recortada de US$400.00 a US$200.00 por máximo por posición 20%", estadoOrden: "filled", precioEjecucion: 234.1 },
    ]);
    expect(panel.bots.find((bot) => bot.clave === "C")?.ultimaCorrida).toMatchObject({ estado: "error", error: "Gemini falló: 503", decisiones: [] });
    expect(panel.bots.find((bot) => bot.clave === "B")?.ultimaCorrida).toBeNull();
  });
});
