import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./fuentes/alpaca", async (original) => ({
  ...(await original<typeof import("./fuentes/alpaca")>()),
  obtenerReloj: async () => ({ abierto: true, ahora: "2026-10-05T15:00:00Z", proximaApertura: "", proximoCierre: "" }),
  obtenerSnapshots: async () => [
    { ticker: "NVDA", precio: 104, ts: "2026-10-05T15:00:00Z", volumenDia: 1_000, cierreAnterior: 100 },
    { ticker: "KO", precio: 85, ts: "2026-10-05T15:00:00Z", volumenDia: 1_000, cierreAnterior: 85 },
  ],
}));
vi.mock("./bots/reactivo", () => ({ leerContextoReactivo: vi.fn() }));
vi.mock("./bots/ejecutar", () => ({ ejecutarDecisiones: vi.fn() }));
vi.mock("./bots/avisos", () => ({ avisarDecisionPorEvento: vi.fn() }));
vi.mock("./bots/snapshots", () => ({ guardarSnapshotsIntradia: vi.fn(async () => ({ bots: 0, benchmark: false, errores: [] })) }));

import { avisarDecisionPorEvento } from "./bots/avisos";
import { ejecutarDecisiones } from "./bots/ejecutar";
import { leerContextoReactivo } from "./bots/reactivo";
import { ejecutarMonitor } from "./recoleccion";

// Cliente falso: toda consulta devuelve vacío, salvo el upsert de eventos, que devuelve lo insertado con ids.
function clienteFalso() {
  const eventosGuardados: Array<{ clave: string; disparo_decision: boolean; tipo: string }> = [];
  const cliente = {
    from: (tabla: string) => {
      const cadena: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "gte", "lte", "order", "limit", "neq", "in", "is"]) cadena[metodo] = () => cadena;
      cadena.upsert = (filas: Array<{ clave: string; disparo_decision: boolean; tipo: string }>) => {
        if (tabla === "lab_eventos_mercado") eventosGuardados.push(...filas);
        const insertadas = filas.map((fila, indice) => ({ id: `evento-${indice}`, clave: fila.clave }));
        return { select: () => Promise.resolve({ data: insertadas, error: null }), then: (resolver: (valor: unknown) => unknown) => resolver({ data: null, error: null }) };
      };
      cadena.then = (resolver: (valor: unknown) => unknown) => resolver({ data: [], error: null });
      return cadena;
    },
  } as unknown as SupabaseClient;
  return { cliente, eventosGuardados };
}

const botA = { id: "bot-a", usuario_id: "u1", clave: "A", nombre: "Bot A", perfil_info: "completo", reactivo: true, alpaca_cuenta: "A", estrategia_prompt: "x", pausado: false };
const contextoReactivo = (parcial: Record<string, unknown> = {}) => ({
  bot: botA,
  config: {},
  posiciones: ["NVDA"],
  referencias: { NVDA: 100 },
  diariaHecha: true,
  disparosHoy: 0,
  ultimoDisparo: null,
  ...parcial,
});

describe("el monitor despierta al bot reactivo", () => {
  beforeEach(() => {
    vi.mocked(leerContextoReactivo).mockReset();
    vi.mocked(ejecutarDecisiones).mockReset();
    vi.mocked(avisarDecisionPorEvento).mockReset();
    vi.mocked(ejecutarDecisiones).mockResolvedValue({ simulada: false, disparador: "evento", bots: [{ clave: "A", estado: "ok", corridaId: "corrida-1" }] });
    vi.mocked(avisarDecisionPorEvento).mockResolvedValue("enviado");
  });

  it("un movimiento de 4% desde la última decisión dispara UNA decisión por evento del bot A y el aviso", async () => {
    vi.mocked(leerContextoReactivo).mockResolvedValue(contextoReactivo() as never);
    const { cliente, eventosGuardados } = clienteFalso();
    const resultado = await ejecutarMonitor(cliente);

    expect(eventosGuardados.map((evento) => [evento.tipo, evento.disparo_decision])).toEqual([["movimiento", true]]);
    expect(ejecutarDecisiones).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ejecutarDecisiones).mock.calls[0][1]).toMatchObject({
      disparador: "evento",
      clave: "A",
      evento: { id: "evento-0", tipo: "movimiento", ticker: "NVDA" },
    });
    expect(avisarDecisionPorEvento).toHaveBeenCalledWith(cliente, expect.objectContaining({ usuarioId: "u1", botClave: "A", corridaId: "corrida-1", estado: "ok" }));
    expect(resultado).toMatchObject({ eventos: 1, dispararian: 1, decisionPorEvento: { evento: expect.stringContaining("movimiento:NVDA"), aviso: "enviado" } });
  });

  it("la referencia del movimiento es el precio de la última decisión del bot (no el cierre anterior)", async () => {
    // Con cierre anterior 100 y precio 104 habría +4%, pero el bot decidió ya a 103,5: son +0,48%, no despierta.
    vi.mocked(leerContextoReactivo).mockResolvedValue(contextoReactivo({ referencias: { NVDA: 103.5 } }) as never);
    const { cliente, eventosGuardados } = clienteFalso();
    await ejecutarMonitor(cliente);
    expect(eventosGuardados).toEqual([]);
    expect(ejecutarDecisiones).not.toHaveBeenCalled();
  });

  it("antes de la decisión diaria no se despierta: el evento queda registrado pero sin disparar", async () => {
    vi.mocked(leerContextoReactivo).mockResolvedValue(contextoReactivo({ diariaHecha: false }) as never);
    const { cliente, eventosGuardados } = clienteFalso();
    await ejecutarMonitor(cliente);
    expect(eventosGuardados.map((evento) => evento.disparo_decision)).toEqual([false]);
    expect(ejecutarDecisiones).not.toHaveBeenCalled();
    expect(avisarDecisionPorEvento).not.toHaveBeenCalled();
  });

  it("con el máximo de decisiones por evento del día alcanzado no se despierta", async () => {
    vi.mocked(leerContextoReactivo).mockResolvedValue(contextoReactivo({ disparosHoy: 2, ultimoDisparo: new Date("2026-10-05T11:00:00Z") }) as never);
    const { cliente, eventosGuardados } = clienteFalso();
    await ejecutarMonitor(cliente);
    expect(eventosGuardados.map((evento) => evento.disparo_decision)).toEqual([false]);
    expect(ejecutarDecisiones).not.toHaveBeenCalled();
  });

  it("dentro del cooldown de 60 minutos desde la última decisión por evento no se despierta", async () => {
    vi.mocked(leerContextoReactivo).mockResolvedValue(contextoReactivo({ disparosHoy: 1, ultimoDisparo: new Date("2026-10-05T14:30:00Z") }) as never);
    const { cliente } = clienteFalso();
    await ejecutarMonitor(cliente);
    expect(ejecutarDecisiones).not.toHaveBeenCalled();
  });

  it("sin bot reactivo activo el monitor solo registra eventos, como en la parte A", async () => {
    vi.mocked(leerContextoReactivo).mockResolvedValue(null);
    const { cliente, eventosGuardados } = clienteFalso();
    const resultado = await ejecutarMonitor(cliente);
    expect(eventosGuardados).toHaveLength(1);
    expect(ejecutarDecisiones).not.toHaveBeenCalled();
    expect(resultado).not.toHaveProperty("decisionPorEvento");
  });

  it("si el aviso de Telegram falla, la decisión igual queda hecha y el monitor no se cae", async () => {
    vi.mocked(leerContextoReactivo).mockResolvedValue(contextoReactivo() as never);
    vi.mocked(avisarDecisionPorEvento).mockRejectedValue(new Error("Telegram caído"));
    const { cliente } = clienteFalso();
    const resultado = await ejecutarMonitor(cliente);
    expect(ejecutarDecisiones).toHaveBeenCalledTimes(1);
    expect(resultado).toMatchObject({ decisionPorEvento: { aviso: "error" } });
  });
});
