import { describe, expect, it } from "vitest";
import { armarComparacion } from "./comparacion";

const bots = [
  { id: "bot-a", clave: "A" as const, nombre: "Bot A" },
  { id: "bot-b", clave: "B" as const, nombre: "Bot B" },
  { id: "bot-c", clave: "C" as const, nombre: "Bot C" },
];
const cierre = (bot_id: string | null, dia: number, valor_usd: number) => ({ bot_id, ts: `2026-10-0${dia}T22:00:00Z`, valor_usd });
const ultimo = (bot_id: string | null, valor_usd: number, costo = 0) => ({ bot_id, ts: "2026-10-03T22:00:00Z", valor_usd, costo_ia_acumulado_usd: costo });

const base = {
  capitalUsd: 1_000,
  diasTotales: 182,
  bots,
  cierres: [
    cierre("bot-a", 1, 1_010), cierre("bot-a", 2, 1_030), cierre("bot-a", 3, 1_040),
    cierre("bot-b", 1, 1_005), cierre("bot-b", 2, 1_010), cierre("bot-b", 3, 1_020),
    cierre("bot-c", 1, 1_000), cierre("bot-c", 2, 1_002), cierre("bot-c", 3, 1_010),
    cierre(null, 1, 1_004), cierre(null, 2, 1_008), cierre(null, 3, 1_012),
  ],
  ultimos: [ultimo("bot-a", 1_040, 0.5), ultimo("bot-b", 1_020, 0.4), ultimo("bot-c", 1_010, 0.1), ultimo(null, 1_012)],
  operaciones: [
    { bot_id: "bot-a", accion: "comprar", ticker: "NVDA", precio_ejecucion: 230 },
    { bot_id: "bot-a", accion: "comprar", ticker: "KO", precio_ejecucion: 90 },
    { bot_id: "bot-b", accion: "comprar", ticker: "NVDA", precio_ejecucion: 230 },
    { bot_id: "bot-a", accion: "mantener", ticker: "VOO", precio_ejecucion: null },
  ],
  precios: { NVDA: 240, KO: 85 },
};

describe("armarComparacion", () => {
  const comparacion = armarComparacion(base);

  it("ordena la tabla de mejor a peor rendimiento neto de IA e incluye el benchmark VOO", () => {
    // A: (1040 - 0.5)/1000 -> +3,95%; B: +1,96%; VOO: +1,2%; C: +1,0% - 0,01
    expect(comparacion.tabla.map((fila) => fila.clave)).toEqual(["A", "B", "VOO", "C"]);
    expect(comparacion.tabla[0].metricas).toMatchObject({ valorUsd: 1_040, rendimientoBrutoPct: 4, rendimientoNetoPct: 3.95, costoIaUsd: 0.5 });
    expect(comparacion.tabla.find((fila) => fila.clave === "VOO")?.metricas).toMatchObject({ rendimientoBrutoPct: 1.2, costoIaUsd: 0, operaciones: 0 });
  });

  it("cuenta solo las operaciones reales (compras y ventas ejecutadas) y mide las ganadoras contra el precio actual", () => {
    const botA = comparacion.tabla.find((fila) => fila.clave === "A")!.metricas;
    // NVDA comprada a 230 y hoy 240 gana; KO comprada a 90 y hoy 85 pierde: 1 de 2 = 50%
    expect(botA).toMatchObject({ operaciones: 2, pctGanadoras: 50 });
    expect(comparacion.tabla.find((fila) => fila.clave === "B")!.metricas).toMatchObject({ operaciones: 1, pctGanadoras: 100 });
  });

  it("calcula las tres preguntas con los números de cada bot", () => {
    expect(comparacion.preguntas.dias).toBe(3);
    expect(comparacion.preguntas.reaccionar).toMatchObject({ difNetoPuntos: 1.99, operacionesExtra: 1 });
    expect(comparacion.preguntas.masInformacion?.difNetoPuntos).toBe(0.97); // B neto +1,96 menos C neto +0,99
    expect(comparacion.preguntas.contraVoo.map((fila) => fila.clave)).toEqual(["A", "B", "C"]);
    expect(comparacion.evaluacion.at(-1)).toBe("6 meses es poco para descartar suerte.");
  });

  it("si un bot no tiene datos todavía, queda afuera de la tabla y sus preguntas quedan en null", () => {
    const sinC = armarComparacion({ ...base, cierres: base.cierres.filter((fila) => fila.bot_id !== "bot-c"), ultimos: base.ultimos.filter((fila) => fila.bot_id !== "bot-c") });
    expect(sinC.tabla.map((fila) => fila.clave)).not.toContain("C");
    expect(sinC.preguntas.masInformacion).toBeNull();
    expect(sinC.preguntas.reaccionar).not.toBeNull();
  });

  it("sin ningún dato devuelve todo vacío sin romper", () => {
    const vacia = armarComparacion({ ...base, cierres: [], ultimos: [], operaciones: [] });
    expect(vacia.tabla).toEqual([]);
    expect(vacia.evaluacion).toEqual(["Todavía no hay cierres para comparar.", "6 meses es poco para descartar suerte."]);
  });

  it("usa el valor más reciente (intradía) aunque el último cierre sea de ayer", () => {
    const conIntradia = armarComparacion({ ...base, ultimos: [{ bot_id: "bot-a", ts: "2026-10-04T15:00:00Z", valor_usd: 1_060, costo_ia_acumulado_usd: 0.5 }, ...base.ultimos.filter((fila) => fila.bot_id !== "bot-a")] });
    expect(conIntradia.tabla.find((fila) => fila.clave === "A")!.metricas.valorUsd).toBe(1_060);
  });
});
