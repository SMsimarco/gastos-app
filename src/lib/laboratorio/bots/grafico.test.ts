import { describe, expect, it } from "vitest";
import { armarPresupuestoPanel, armarSerieGrafico, type SnapshotGrafico } from "./grafico";

const bots = { "bot-a": "A", "bot-b": "B", "bot-c": "C" } as const;
const snap = (bot_id: string | null, ts: string, tipo: "intradia" | "cierre", valor_usd: number): SnapshotGrafico => ({ bot_id, ts, tipo, valor_usd });

describe("armarSerieGrafico: hoy (intradía)", () => {
  // Lunes 5/10/2026: 14:00 UTC = 10:00 en Nueva York (horario de verano).
  const snapshots = [
    snap("bot-a", "2026-10-05T14:02:00Z", "intradia", 1_000),
    snap("bot-a", "2026-10-05T14:14:00Z", "intradia", 1_001), // mismo tramo de 15 min: gana el último
    snap("bot-b", "2026-10-05T14:03:00Z", "intradia", 998),
    snap(null, "2026-10-05T14:03:00Z", "intradia", 1_002),
    snap("bot-a", "2026-10-05T14:17:00Z", "intradia", 1_005),
    snap("bot-a", "2026-10-02T19:50:00Z", "intradia", 990), // rueda anterior: no entra en "hoy"
    snap("bot-a", "2026-10-02T22:00:00Z", "cierre", 990), // los cierres no entran en "hoy"
  ];
  const serie = armarSerieGrafico({ snapshots, botsPorId: bots, rango: "hoy", ahora: new Date("2026-10-05T14:20:00Z") });

  it("junta los 4 valores de cada tramo de 15 minutos y se queda con el último valor de cada tramo", () => {
    expect(serie).toEqual([
      { t: "2026-10-05T14:00:00.000Z", etiqueta: "10:00", A: 1_001, B: 998, VOO: 1_002 },
      { t: "2026-10-05T14:15:00.000Z", etiqueta: "10:15", A: 1_005 },
    ]);
  });
  it("solo muestra la última rueda con datos intradía", () => {
    expect(serie.every((punto) => punto.t.startsWith("2026-10-05"))).toBe(true);
  });
  it("ignora snapshots de bots desconocidos", () => {
    const resultado = armarSerieGrafico({ snapshots: [snap("bot-x", "2026-10-05T14:02:00Z", "intradia", 5)], botsPorId: bots, rango: "hoy", ahora: new Date("2026-10-05T14:20:00Z") });
    expect(resultado).toEqual([]);
  });
});

describe("armarSerieGrafico: semana, mes y todo (cierres diarios)", () => {
  const ahora = new Date("2026-10-20T15:00:00Z");
  const snapshots = [
    snap("bot-a", "2026-09-01T22:00:00Z", "cierre", 1_000),
    snap("bot-a", "2026-10-10T22:00:00Z", "cierre", 1_020),
    snap("bot-b", "2026-10-10T22:00:00Z", "cierre", 1_010),
    snap(null, "2026-10-10T22:00:00Z", "cierre", 1_015),
    snap("bot-a", "2026-10-16T22:00:00Z", "cierre", 1_030),
    snap("bot-a", "2026-10-19T22:00:00Z", "cierre", 1_040),
  ];
  it("'todo' trae todos los cierres, uno por día, con la fecha como etiqueta", () => {
    const serie = armarSerieGrafico({ snapshots, botsPorId: bots, rango: "todo", ahora });
    expect(serie.map((p) => p.etiqueta)).toEqual(["01/09", "10/10", "16/10", "19/10"]);
    expect(serie[1]).toMatchObject({ A: 1_020, B: 1_010, VOO: 1_015 });
  });
  it("'semana' deja solo los últimos 7 días y 'mes' los últimos 30", () => {
    expect(armarSerieGrafico({ snapshots, botsPorId: bots, rango: "semana", ahora }).map((p) => p.etiqueta)).toEqual(["16/10", "19/10"]);
    expect(armarSerieGrafico({ snapshots, botsPorId: bots, rango: "mes", ahora }).map((p) => p.etiqueta)).toEqual(["10/10", "16/10", "19/10"]);
  });
  it("el día de hoy, sin cierre todavía, muestra el último valor intradía para que el gráfico no quede atrasado", () => {
    const conHoy = [...snapshots, snap("bot-a", "2026-10-20T14:00:00Z", "intradia", 1_050), snap("bot-a", "2026-10-20T15:30:00Z", "intradia", 1_055)];
    const serie = armarSerieGrafico({ snapshots: conHoy, botsPorId: bots, rango: "semana", ahora });
    expect(serie.at(-1)).toMatchObject({ etiqueta: "20/10", A: 1_055 });
  });
  it("un intradía de un día que ya tiene cierre no pisa al cierre", () => {
    const conIntradiaViejo = [...snapshots, snap("bot-a", "2026-10-19T19:00:00Z", "intradia", 9_999)];
    const serie = armarSerieGrafico({ snapshots: conIntradiaViejo, botsPorId: bots, rango: "semana", ahora });
    expect(serie.find((p) => p.etiqueta === "19/10")?.A).toBe(1_040);
  });
  it("sin snapshots devuelve una lista vacía", () => {
    expect(armarSerieGrafico({ snapshots: [], botsPorId: bots, rango: "todo", ahora })).toEqual([]);
  });
});

describe("armarPresupuestoPanel", () => {
  const costos = [
    { tipo: "resumen_noticias", costo_usd: 0.4, detalle: {} },
    { tipo: "diario_mercado", costo_usd: 0.1, detalle: { fecha: "2026-10-05" } },
    { tipo: "decision_bot", costo_usd: 0.024, detalle: { bot: "A", disparador: "diaria" } },
    { tipo: "decision_bot", costo_usd: 0.025, detalle: { bot: "A", disparador: "evento" } },
    { tipo: "decision_bot", costo_usd: 0.023, detalle: { bot: "C", disparador: "diaria" } },
    { tipo: "leccion_bot", costo_usd: 0.02, detalle: { bot_id: "bot-b", casos: 2 } },
  ];
  it("suma el mes, calcula el porcentaje del tope y desglosa por tipo y por bot", () => {
    const presupuesto = armarPresupuestoPanel({ costos, topeUsd: 10, botsPorId: { ...bots } });
    expect(presupuesto.gastadoUsd).toBe(0.592);
    expect(presupuesto.pctUsado).toBe(5.9);
    expect(presupuesto.porTipo[0]).toEqual({ tipo: "resumen_noticias", etiqueta: "Resumen de noticias (compartido)", usd: 0.4 });
    expect(presupuesto.porBot).toEqual([
      { clave: "A", usd: 0.049 },
      { clave: "B", usd: 0.02 },
      { clave: "C", usd: 0.023 },
    ]);
  });
  it("con tope cero no divide por cero y sin costos queda en cero", () => {
    expect(armarPresupuestoPanel({ costos, topeUsd: 0, botsPorId: { ...bots } }).pctUsado).toBe(0);
    expect(armarPresupuestoPanel({ costos: [], topeUsd: 10, botsPorId: { ...bots } })).toEqual({ gastadoUsd: 0, topeUsd: 10, pctUsado: 0, porTipo: [], porBot: [] });
  });
});
