import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./alpacaPaper", () => ({ obtenerCuentaPaper: vi.fn(), obtenerPosicionesPaper: vi.fn() }));

import { obtenerCuentaPaper, obtenerPosicionesPaper } from "./alpacaPaper";
import { guardarSnapshotsIntradia } from "./snapshots";

type Insertado = { tabla: string; fila: Record<string, unknown> };

// Cliente falso: cada tabla devuelve sus filas; los inserts se capturan.
function clienteFalso(tablas: Record<string, unknown[]>) {
  const insertados: Insertado[] = [];
  const cliente = {
    from: (tabla: string) => {
      const cadena: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "order", "limit"]) cadena[metodo] = () => cadena;
      cadena.insert = (fila: Record<string, unknown>) => {
        insertados.push({ tabla, fila });
        return Promise.resolve({ error: null });
      };
      cadena.then = (resolver: (valor: unknown) => unknown) => resolver({ data: tablas[tabla] ?? [], error: null });
      return cadena;
    },
  } as unknown as SupabaseClient;
  return { cliente, insertados };
}

const bots = [
  { id: "bot-a", clave: "A", alpaca_cuenta: "A" },
  { id: "bot-b", clave: "B", alpaca_cuenta: "B" },
  { id: "bot-c", clave: "C", alpaca_cuenta: "C" },
];

describe("guardarSnapshotsIntradia", () => {
  beforeEach(() => {
    vi.mocked(obtenerCuentaPaper).mockReset();
    vi.mocked(obtenerPosicionesPaper).mockReset();
    vi.mocked(obtenerCuentaPaper).mockImplementation(async (cuenta) => ({ numero: `PA-${cuenta}`, estado: "ACTIVE", equity: cuenta === "A" ? 1_012.5 : 1_000, efectivo: 600, bloqueada: false }));
    vi.mocked(obtenerPosicionesPaper).mockResolvedValue([{ ticker: "NVDA", cantidad: 0.5, valorMercado: 117, costoPromedio: 230, precioActual: 234, pnlPct: 1.74 }]);
  });

  it("guarda un snapshot intradía por bot con su equity real y posiciones, y el del benchmark VOO", async () => {
    const { cliente, insertados } = clienteFalso({ lab_config: [{ usuario_id: "u1", voo_cantidad: 1.4 }], lab_bots: bots, lab_snapshots: [] });
    const resultado = await guardarSnapshotsIntradia(cliente, 700);
    expect(resultado).toEqual({ bots: 3, benchmark: true, errores: [] });
    const filas = insertados.filter((item) => item.tabla === "lab_snapshots").map((item) => item.fila);
    expect(filas).toHaveLength(4);
    expect(filas[0]).toMatchObject({ bot_id: "bot-a", usuario_id: "u1", tipo: "intradia", valor_usd: 1_012.5, efectivo_usd: 600 });
    expect(filas[0].posiciones).toEqual([{ ticker: "NVDA", cantidad: 0.5, valor_usd: 117, resultado_pct: 1.74 }]);
    // El benchmark vale la cantidad de VOO "comprada" el día 1 por el precio actual: 1,4 x 700 = 980
    expect(filas[3]).toMatchObject({ bot_id: null, tipo: "intradia", valor_usd: 980 });
  });

  it("no repite si ya hay un snapshot intradía de hace menos de 10 minutos", async () => {
    const { cliente, insertados } = clienteFalso({ lab_config: [{ usuario_id: "u1", voo_cantidad: 1.4 }], lab_bots: bots, lab_snapshots: [{ ts: new Date(Date.now() - 4 * 60_000).toISOString() }] });
    const resultado = await guardarSnapshotsIntradia(cliente, 700);
    expect(resultado.omitido).toBe("reciente");
    expect(insertados).toHaveLength(0);
    expect(obtenerCuentaPaper).not.toHaveBeenCalled();
  });

  it("sin laboratorio activo no hace nada", async () => {
    const { cliente, insertados } = clienteFalso({ lab_config: [] });
    expect(await guardarSnapshotsIntradia(cliente, 700)).toEqual({ bots: 0, benchmark: false, errores: [] });
    expect(insertados).toHaveLength(0);
  });

  it("si Alpaca falla para un bot, guarda los otros y devuelve el error en vez de romper", async () => {
    vi.mocked(obtenerCuentaPaper).mockImplementation(async (cuenta) => {
      if (cuenta === "B") throw new Error("Alpaca paper respondió HTTP 500");
      return { numero: "PA", estado: "ACTIVE", equity: 1_000, efectivo: 500, bloqueada: false };
    });
    const { cliente, insertados } = clienteFalso({ lab_config: [{ usuario_id: "u1", voo_cantidad: null }], lab_bots: bots, lab_snapshots: [] });
    const resultado = await guardarSnapshotsIntradia(cliente, 700);
    expect(resultado.bots).toBe(2);
    expect(resultado.errores).toEqual(["Bot B: Alpaca paper respondió HTTP 500"]);
    expect(insertados.map((item) => item.fila.bot_id)).toEqual(["bot-a", "bot-c"]);
  });

  it("sin precio de VOO o sin la cantidad comprada no guarda el benchmark", async () => {
    const { cliente } = clienteFalso({ lab_config: [{ usuario_id: "u1", voo_cantidad: null }], lab_bots: bots, lab_snapshots: [] });
    expect((await guardarSnapshotsIntradia(cliente, 700)).benchmark).toBe(false);
    const otro = clienteFalso({ lab_config: [{ usuario_id: "u1", voo_cantidad: 1.4 }], lab_bots: bots, lab_snapshots: [] });
    expect((await guardarSnapshotsIntradia(otro.cliente, null)).benchmark).toBe(false);
  });
});
