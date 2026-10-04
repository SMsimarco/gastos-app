import { afterEach, describe, expect, it, vi } from "vitest";
import { construirOrden, enviarOrdenPaper, obtenerCuentaPaper, ORIGEN_PAPER, parsearCuenta, parsearOrden, parsearPosiciones, validarUrlPaper } from "./alpacaPaper";

describe("validarUrlPaper: imposible operar fuera de paper", () => {
  it("acepta únicamente el origen de paper trading", () => {
    expect(validarUrlPaper(`${ORIGEN_PAPER}/v2/orders`)).toBe("https://paper-api.alpaca.markets/v2/orders");
  });

  it("rechaza la URL de trading real y cualquier otra", () => {
    expect(() => validarUrlPaper("https://api.alpaca.markets/v2/orders")).toThrow(/paper/i);
    expect(() => validarUrlPaper("http://paper-api.alpaca.markets/v2/orders")).toThrow(/paper/i);
    expect(() => validarUrlPaper("https://data.alpaca.markets/v2/orders")).toThrow(/paper/i);
    expect(() => validarUrlPaper("https://paper-api.alpaca.markets.evil.com/v2/orders")).toThrow(/paper/i);
    expect(() => validarUrlPaper("https://paper-api.alpaca.markets:8443/v2/orders")).toThrow(/paper/i);
  });

  it("rechaza trucos con usuario@ y URLs inválidas", () => {
    expect(() => validarUrlPaper("https://paper-api.alpaca.markets@api.alpaca.markets/v2/orders")).toThrow(/paper/i);
    expect(() => validarUrlPaper("https://user:pass@paper-api.alpaca.markets/v2/orders")).toThrow(/paper/i);
    expect(() => validarUrlPaper("no es una url")).toThrow();
  });
});

describe("las llamadas siempre van a paper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("enviarOrdenPaper pega a paper-api con las keys de la cuenta del bot y nunca a otro host", async () => {
    vi.stubEnv("ALPACA_BOT_B_KEY_ID", "PKTEST");
    vi.stubEnv("ALPACA_BOT_B_SECRET_KEY", "SECRETO");
    const pedidos: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      pedidos.push({ url, init });
      return new Response(JSON.stringify({ id: "orden-1", status: "accepted" }), { status: 200 });
    });
    const orden = await enviarOrdenPaper("B", { ticker: "voo", lado: "buy", monto: 100 });
    expect(orden).toMatchObject({ id: "orden-1", estado: "accepted" });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toBe("https://paper-api.alpaca.markets/v2/orders");
    expect((pedidos[0].init.headers as Record<string, string>)["APCA-API-KEY-ID"]).toBe("PKTEST");
    expect(JSON.parse(pedidos[0].init.body as string)).toEqual({ symbol: "VOO", side: "buy", type: "market", time_in_force: "day", notional: "100.00" });
  });

  it("sin keys de la cuenta no hace ningún pedido", async () => {
    const fetchEspia = vi.fn();
    vi.stubGlobal("fetch", fetchEspia);
    await expect(obtenerCuentaPaper("C")).rejects.toThrow(/ALPACA_BOT_C/);
    expect(fetchEspia).not.toHaveBeenCalled();
  });

  it("un error de Alpaca llega como error con el detalle, no como éxito", async () => {
    vi.stubEnv("ALPACA_BOT_A_KEY_ID", "PK");
    vi.stubEnv("ALPACA_BOT_A_SECRET_KEY", "S");
    vi.stubGlobal("fetch", async () => new Response("insufficient buying power", { status: 403 }));
    await expect(enviarOrdenPaper("A", { ticker: "VOO", lado: "buy", monto: 5000 })).rejects.toThrow(/403.*insufficient/);
  });
});

describe("construirOrden", () => {
  it("compra por monto con dos decimales hacia abajo, a mercado y válida por el día", () => {
    expect(construirOrden({ ticker: "nvda", lado: "buy", monto: 123.456 })).toEqual({ symbol: "NVDA", side: "buy", type: "market", time_in_force: "day", notional: "123.45" });
  });
  it("venta total por cantidad", () => {
    expect(construirOrden({ ticker: "VOO", lado: "sell", cantidad: 1.5 })).toMatchObject({ side: "sell", qty: "1.5" });
  });
  it("rechaza montos menores a US$1 y cantidades nulas", () => {
    expect(() => construirOrden({ ticker: "VOO", lado: "buy", monto: 0.5 })).toThrow(/US\$1/);
    expect(() => construirOrden({ ticker: "VOO", lado: "buy" })).toThrow();
    expect(() => construirOrden({ ticker: "VOO", lado: "sell", cantidad: 0 })).toThrow();
  });
});

describe("parsers", () => {
  it("parsearCuenta toma saldo y bloqueo", () => {
    expect(parsearCuenta({ account_number: "PA123", status: "ACTIVE", equity: "1000", cash: "850.5", trading_blocked: false })).toEqual({ numero: "PA123", estado: "ACTIVE", equity: 1000, efectivo: 850.5, bloqueada: false });
    expect(() => parsearCuenta({})).toThrow();
  });
  it("parsearPosiciones descarta filas inválidas y redondea el P&L", () => {
    const filas = parsearPosiciones([
      { symbol: "voo", qty: "0.5", market_value: "350", avg_entry_price: "690", current_price: "700", unrealized_plpc: "0.014492" },
      { symbol: "XXX", qty: "0", market_value: "0" },
    ]);
    expect(filas).toEqual([{ ticker: "VOO", cantidad: 0.5, valorMercado: 350, costoPromedio: 690, precioActual: 700, pnlPct: 1.45 }]);
  });
  it("parsearOrden entiende una orden sin ejecutar y una ejecutada", () => {
    expect(parsearOrden({ id: "a", status: "accepted", filled_avg_price: null, filled_qty: "0" })).toEqual({ id: "a", estado: "accepted", precioPromedio: null, cantidadEjecutada: null });
    expect(parsearOrden({ id: "b", status: "filled", filled_avg_price: "700.1", filled_qty: "0.1428" })).toEqual({ id: "b", estado: "filled", precioPromedio: 700.1, cantidadEjecutada: 0.1428 });
  });
});
