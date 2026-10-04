import { afterEach, describe, expect, it, vi } from "vitest";
import type { PosicionPaper } from "./alpacaPaper";
import { enviarOrdenes } from "./ejecutar";
import type { DecisionRiesgo } from "./riesgo";

const decision = (parcial: Partial<DecisionRiesgo> & Pick<DecisionRiesgo, "ticker" | "accion">): DecisionRiesgo => ({
  razon: "x",
  confianza: "media",
  montoPropuestoUsd: 100,
  montoAprobadoUsd: 100,
  aprobada: true,
  ventaTotal: false,
  ajuste: null,
  ...parcial,
});

const posicion: PosicionPaper = { ticker: "VOO", cantidad: 0.4286, valorMercado: 300, costoPromedio: 690, precioActual: 700, pnlPct: 1.4 };

type Pedido = { metodo: string; url: string; cuerpo: Record<string, string> | null };

function simularAlpaca(respuestas: Array<{ status: number; cuerpo: unknown }>) {
  const pedidos: Pedido[] = [];
  let indice = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    pedidos.push({ metodo: init.method ?? "GET", url, cuerpo: init.body ? JSON.parse(init.body as string) : null });
    const respuesta = respuestas[Math.min(indice++, respuestas.length - 1)];
    return new Response(JSON.stringify(respuesta.cuerpo), { status: respuesta.status });
  });
  return pedidos;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("enviarOrdenes", () => {
  it("compra por monto, vende todo por cantidad, y solo manda las aprobadas que no son 'mantener'", async () => {
    vi.stubEnv("ALPACA_BOT_B_KEY_ID", "PK");
    vi.stubEnv("ALPACA_BOT_B_SECRET_KEY", "S");
    const pedidos = simularAlpaca([{ status: 200, cuerpo: { id: "o1", status: "filled", filled_avg_price: "700", filled_qty: "0.4286" } }]);
    const compra = decision({ ticker: "NVDA", accion: "comprar", montoAprobadoUsd: 150 });
    const ventaTotal = decision({ ticker: "VOO", accion: "vender", montoAprobadoUsd: 300, ventaTotal: true });
    const mantener = decision({ ticker: "KO", accion: "mantener", montoAprobadoUsd: 0 });
    const descartada = decision({ ticker: "TSLA", accion: "comprar", aprobada: false, montoAprobadoUsd: 0, ajuste: "Descartada: fuera del universo" });

    const resultados = await enviarOrdenes("B", [compra, ventaTotal, mantener, descartada], [posicion], 0);

    expect(pedidos).toHaveLength(2);
    // Las ventas van primero.
    expect(pedidos[0].cuerpo).toEqual({ symbol: "VOO", side: "sell", type: "market", time_in_force: "day", qty: "0.4286" });
    expect(pedidos[1].cuerpo).toEqual({ symbol: "NVDA", side: "buy", type: "market", time_in_force: "day", notional: "150.00" });
    expect(pedidos.every((pedido) => pedido.url.startsWith("https://paper-api.alpaca.markets/"))).toBe(true);
    expect(resultados.get(ventaTotal)).toEqual({ id: "o1", estado: "filled", precio: 700, cantidad: 0.4286 });
    expect(resultados.has(mantener)).toBe(false);
    expect(resultados.has(descartada)).toBe(false);
  });

  it("si la orden no se ejecuta enseguida, la vuelve a consultar hasta que quede en un estado final", async () => {
    vi.stubEnv("ALPACA_BOT_A_KEY_ID", "PK");
    vi.stubEnv("ALPACA_BOT_A_SECRET_KEY", "S");
    const pedidos = simularAlpaca([
      { status: 200, cuerpo: { id: "o2", status: "accepted" } },
      { status: 200, cuerpo: { id: "o2", status: "accepted" } },
      { status: 200, cuerpo: { id: "o2", status: "filled", filled_avg_price: "234.1", filled_qty: "0.64" } },
    ]);
    const compra = decision({ ticker: "NVDA", accion: "comprar", montoAprobadoUsd: 150 });
    const resultados = await enviarOrdenes("A", [compra], [], 0);
    expect(pedidos.map((pedido) => pedido.metodo)).toEqual(["POST", "GET", "GET"]);
    expect(resultados.get(compra)).toMatchObject({ estado: "filled", precio: 234.1 });
  });

  it("una orden que Alpaca rechaza queda registrada como error y no frena a las demás", async () => {
    vi.stubEnv("ALPACA_BOT_C_KEY_ID", "PK");
    vi.stubEnv("ALPACA_BOT_C_SECRET_KEY", "S");
    simularAlpaca([
      { status: 403, cuerpo: { message: "insufficient buying power" } },
      { status: 200, cuerpo: { id: "o3", status: "filled", filled_avg_price: "100", filled_qty: "1" } },
    ]);
    const mala = decision({ ticker: "NVDA", accion: "comprar", montoAprobadoUsd: 150 });
    const buena = decision({ ticker: "KO", accion: "comprar", montoAprobadoUsd: 100 });
    const resultados = await enviarOrdenes("C", [mala, buena], [], 0);
    expect(resultados.get(mala)?.id).toBeNull();
    expect(resultados.get(mala)?.estado).toMatch(/^error: .*403/);
    expect(resultados.get(buena)).toMatchObject({ id: "o3", estado: "filled" });
  });

  it("sin keys de la cuenta del bot no manda nada y lo deja como error", async () => {
    const pedidos = simularAlpaca([{ status: 200, cuerpo: { id: "x", status: "filled" } }]);
    const compra = decision({ ticker: "NVDA", accion: "comprar" });
    const resultados = await enviarOrdenes("A", [compra], [], 0);
    expect(pedidos).toHaveLength(0);
    expect(resultados.get(compra)?.estado).toMatch(/^error: .*ALPACA_BOT_A/);
  });
});
