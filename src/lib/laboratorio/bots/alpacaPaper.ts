// Cliente de Alpaca del laboratorio (SIMULADO). SOLO opera en paper trading: cada pedido valida que la
// URL sea exactamente https://paper-api.alpaca.markets. No existe modo real ni flag para activarlo:
// si la URL no es esa, tira error y no opera.
import { fetchConTimeout } from "../fuentes/http";

export const ORIGEN_PAPER = "https://paper-api.alpaca.markets";

// Devuelve la URL si apunta al paper trading de Alpaca; si no (incluye api.alpaca.markets, http,
// dominios parecidos y trucos con usuario@), tira error.
export function validarUrlPaper(url: string): string {
  let analizada: URL;
  try {
    analizada = new URL(url);
  } catch {
    throw new Error(`URL inválida, solo se opera en paper: ${url}`);
  }
  if (analizada.origin !== ORIGEN_PAPER || analizada.username || analizada.password) {
    throw new Error(`Solo se opera en paper trading (${ORIGEN_PAPER}); se rechazó ${analizada.origin}`);
  }
  return analizada.toString();
}

export type CuentaBot = "A" | "B" | "C";

function credenciales(cuenta: CuentaBot): Record<string, string> {
  const id = process.env[`ALPACA_BOT_${cuenta}_KEY_ID`];
  const secreto = process.env[`ALPACA_BOT_${cuenta}_SECRET_KEY`];
  if (!id || !secreto) throw new Error(`Faltan ALPACA_BOT_${cuenta}_KEY_ID / ALPACA_BOT_${cuenta}_SECRET_KEY`);
  return { "APCA-API-KEY-ID": id, "APCA-API-SECRET-KEY": secreto, Accept: "application/json", "Content-Type": "application/json" };
}

async function pedirPaper<T>(cuenta: CuentaBot, metodo: "GET" | "POST" | "DELETE", ruta: string, cuerpo?: unknown): Promise<T> {
  const url = validarUrlPaper(`${ORIGEN_PAPER}${ruta}`);
  const respuesta = await fetchConTimeout(url, { method: metodo, headers: credenciales(cuenta), body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  if (!respuesta.ok) {
    const detalle = (await respuesta.text()).slice(0, 200);
    throw new Error(`Alpaca paper respondió HTTP ${respuesta.status} en ${metodo} ${ruta}: ${detalle}`);
  }
  if (respuesta.status === 204) return undefined as T;
  return (await respuesta.json()) as T;
}

// --- Cuenta ---

export type EstadoCuenta = { numero: string; estado: string; equity: number; efectivo: number; bloqueada: boolean };

type CuentaAlpaca = { account_number?: string; status?: string; equity?: string; cash?: string; trading_blocked?: boolean; account_blocked?: boolean };

export function parsearCuenta(data: CuentaAlpaca): EstadoCuenta {
  const equity = Number(data.equity);
  const efectivo = Number(data.cash);
  if (!data.account_number || !Number.isFinite(equity) || !Number.isFinite(efectivo)) throw new Error("Respuesta de cuenta inválida");
  return { numero: data.account_number, estado: data.status ?? "desconocido", equity, efectivo, bloqueada: Boolean(data.trading_blocked || data.account_blocked) };
}

export async function obtenerCuentaPaper(cuenta: CuentaBot): Promise<EstadoCuenta> {
  return parsearCuenta(await pedirPaper<CuentaAlpaca>(cuenta, "GET", "/v2/account"));
}

// --- Posiciones ---

export type PosicionPaper = { ticker: string; cantidad: number; valorMercado: number; costoPromedio: number; precioActual: number; pnlPct: number };

type PosicionAlpaca = { symbol?: string; qty?: string; market_value?: string; avg_entry_price?: string; current_price?: string; unrealized_plpc?: string };

export function parsearPosiciones(filas: PosicionAlpaca[]): PosicionPaper[] {
  return filas.flatMap((fila) => {
    const cantidad = Number(fila.qty);
    const valorMercado = Number(fila.market_value);
    if (!fila.symbol || !Number.isFinite(cantidad) || !Number.isFinite(valorMercado) || cantidad <= 0) return [];
    return [{
      ticker: fila.symbol.toUpperCase(),
      cantidad,
      valorMercado,
      costoPromedio: Number(fila.avg_entry_price) || 0,
      precioActual: Number(fila.current_price) || 0,
      pnlPct: Math.round((Number(fila.unrealized_plpc) || 0) * 10_000) / 100,
    }];
  });
}

export async function obtenerPosicionesPaper(cuenta: CuentaBot): Promise<PosicionPaper[]> {
  return parsearPosiciones(await pedirPaper<PosicionAlpaca[]>(cuenta, "GET", "/v2/positions"));
}

// --- Órdenes ---

export type OrdenAEnviar = { ticker: string; lado: "buy" | "sell"; monto?: number; cantidad?: number };

// Orden a mercado válida solo por el día. Compra o venta parcial por monto (fraccionaria); venta total por cantidad.
export function construirOrden(orden: OrdenAEnviar): Record<string, string> {
  const base = { symbol: orden.ticker.toUpperCase(), side: orden.lado, type: "market", time_in_force: "day" };
  if (orden.cantidad !== undefined) {
    if (!(orden.cantidad > 0)) throw new Error("La cantidad de la orden debe ser mayor a cero");
    return { ...base, qty: String(Math.floor(orden.cantidad * 1e9) / 1e9) };
  }
  if (orden.monto === undefined || !(orden.monto >= 1)) throw new Error("El monto de la orden debe ser de al menos US$1");
  return { ...base, notional: (Math.floor(orden.monto * 100) / 100).toFixed(2) };
}

export type EstadoOrden = { id: string; estado: string; precioPromedio: number | null; cantidadEjecutada: number | null };

type OrdenAlpaca = { id?: string; status?: string; filled_avg_price?: string | null; filled_qty?: string | null };

export function parsearOrden(data: OrdenAlpaca): EstadoOrden {
  if (!data.id) throw new Error("Respuesta de orden inválida");
  const precio = Number(data.filled_avg_price);
  const cantidad = Number(data.filled_qty);
  return {
    id: data.id,
    estado: data.status ?? "desconocido",
    precioPromedio: Number.isFinite(precio) && precio > 0 ? precio : null,
    cantidadEjecutada: Number.isFinite(cantidad) && cantidad > 0 ? cantidad : null,
  };
}

export async function enviarOrdenPaper(cuenta: CuentaBot, orden: OrdenAEnviar): Promise<EstadoOrden> {
  return parsearOrden(await pedirPaper<OrdenAlpaca>(cuenta, "POST", "/v2/orders", construirOrden(orden)));
}

export async function obtenerOrdenPaper(cuenta: CuentaBot, id: string): Promise<EstadoOrden> {
  return parsearOrden(await pedirPaper<OrdenAlpaca>(cuenta, "GET", `/v2/orders/${encodeURIComponent(id)}`));
}

export async function cancelarOrdenPaper(cuenta: CuentaBot, id: string): Promise<void> {
  await pedirPaper<void>(cuenta, "DELETE", `/v2/orders/${encodeURIComponent(id)}`);
}
