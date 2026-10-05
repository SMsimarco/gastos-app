import { describe, expect, it } from "vitest";
import { armarDashboardCategorias, type FilaCategoriaSql } from "./dashboardCategorias";

const fila = (nombre: string, ars: number | string, cantidad: number | string, usd: number | string = 0): FilaCategoriaSql => ({
  categoria_id: nombre, categoria_nombre: nombre, categoria_emoji: "x", categoria_color: "#000", total_ars: ars, total_usd: usd, cantidad,
});

describe("armarDashboardCategorias", () => {
  it("ordena de mayor a menor, calcula el porcentaje de cada una y el total general", () => {
    const dashboard = armarDashboardCategorias([fila("Ocio", 25_000, 3), fila("Supermercado", 75_000, 10), fila("Deportes", 0, 0), fila("Salud", 0, 0)]);
    expect(dashboard.totalArs).toBe(100_000);
    expect(dashboard.cantidad).toBe(13);
    expect(dashboard.conGastos.map((f) => `${f.nombre} ${f.totalArs} ${f.porcentaje}%`)).toEqual(["Supermercado 75000 75%", "Ocio 25000 25%"]);
    expect(dashboard.sinGastos.map((f) => f.nombre)).toEqual(["Deportes", "Salud"]);
  });

  it("la suma de los totales de las categorías da el total general", () => {
    const filas = [fila("A", 1234.5, 2, 1), fila("B", 765.5, 1, 0.5), fila("C", 0, 0)];
    const dashboard = armarDashboardCategorias(filas);
    expect(dashboard.conGastos.reduce((total, f) => total + f.totalArs, 0)).toBe(dashboard.totalArs);
    expect(dashboard.totalArs).toBe(2000);
    expect(dashboard.totalUsd).toBe(1.5);
  });

  it("acepta los numeric de Postgres que llegan como texto", () => {
    const dashboard = armarDashboardCategorias([fila("Ocio", "12500.50", "2"), fila("Ropa", "0", "0")]);
    expect(dashboard.totalArs).toBe(12500.5);
    expect(dashboard.conGastos[0].cantidad).toBe(2);
  });

  it("sin gastos en el período todo queda en cero y sin dividir por cero", () => {
    const dashboard = armarDashboardCategorias([fila("Ocio", 0, 0), fila("Ropa", 0, 0)]);
    expect(dashboard.totalArs).toBe(0);
    expect(dashboard.conGastos).toEqual([]);
    expect(dashboard.sinGastos).toHaveLength(2);
    expect(dashboard.sinGastos.every((f) => f.porcentaje === 0)).toBe(true);
  });

  it("en un empate ordena por nombre", () => {
    expect(armarDashboardCategorias([fila("Ropa", 10, 1), fila("Ocio", 10, 1)]).conGastos.map((f) => f.nombre)).toEqual(["Ocio", "Ropa"]);
  });
});
