import { describe, expect, it } from "vitest";
import { generarSugerencias, type EstadoInversiones } from "./sugerencias";

const estadoBase: EstadoInversiones = {
  hoy: "2026-10-03",
  emergencia: { saldoUsd: 3_000, metaUsd: 3_000 },
  porInvertirUsd: 0,
  minimoCompraUsd: 100,
  activos: [],
  fechaObjetivoDepto: "2035-01-01",
  aniosTransicion: 3,
  valorAprenderUsd: 0,
  valorTotalCarteraUsd: 10_000,
  pctAprenderObjetivo: 10,
};

describe("generarSugerencias", () => {
  it("prioriza completar la emergencia", () => {
    const resultado = generarSugerencias({ ...estadoBase, emergencia: { saldoUsd: 800, metaUsd: 2_000 } });
    expect(resultado[0]).toMatchObject({ tipo: "completar_emergencia", prioridad: 700 });
    expect(resultado[0].mensaje).toContain("US$1.200,00");
  });

  it("avisa cuando por invertir alcanza el mínimo", () => {
    expect(generarSugerencias({ ...estadoBase, porInvertirUsd: 125 })[0]).toMatchObject({ tipo: "comprar_voo", prioridad: 600 });
  });

  it("detecta VOO al menos 10% debajo del máximo con saldo disponible", () => {
    const activos = [{ ticker: "VOO", bolsilloClave: "largo_plazo", gananciaPct: 0, precioActualUsd: 90, max52sUsd: 110, tomaGananciaPct: null, stopRevisionPct: null }];
    expect(generarSugerencias({ ...estadoBase, porInvertirUsd: 50, activos })[0]).toMatchObject({ tipo: "voo_bajo_maximo", prioridad: 500 });
  });

  it("aplica la regla de toma de ganancia solo a Aprender", () => {
    const activos = [{ ticker: "YPF", bolsilloClave: "aprender", gananciaPct: 22, precioActualUsd: 40, max52sUsd: 45, tomaGananciaPct: 20, stopRevisionPct: 15 }];
    expect(generarSugerencias({ ...estadoBase, activos })[0]).toMatchObject({ tipo: "objetivo_ganancia", prioridad: 400 });
  });

  it("pide revisar la tesis sin sugerir vender", () => {
    const activos = [{ ticker: "GGAL", bolsilloClave: "aprender", gananciaPct: -18, precioActualUsd: 20, max52sUsd: 30, tomaGananciaPct: 20, stopRevisionPct: 15 }];
    const resultado = generarSugerencias({ ...estadoBase, activos })[0];
    expect(resultado).toMatchObject({ tipo: "revisar_tesis", prioridad: 300 });
    expect(resultado.mensaje.toLowerCase()).not.toContain("vend");
  });

  it("inicia la transición al acercarse la fecha del departamento", () => {
    const resultado = generarSugerencias({ ...estadoBase, fechaObjetivoDepto: "2028-01-01" })[0];
    expect(resultado).toMatchObject({ tipo: "transicion_depto", prioridad: 200 });
  });

  it("frena nuevos aportes cuando Aprender supera su porcentaje", () => {
    const resultado = generarSugerencias({ ...estadoBase, valorAprenderUsd: 1_500 })[0];
    expect(resultado).toMatchObject({ tipo: "aprender_sobreponderado", prioridad: 100 });
  });

  it("ordena varias reglas por prioridad descendente", () => {
    const resultado = generarSugerencias({
      ...estadoBase,
      emergencia: { saldoUsd: 0, metaUsd: 2_000 },
      porInvertirUsd: 125,
      fechaObjetivoDepto: "2027-01-01",
      valorAprenderUsd: 2_000,
    });
    expect(resultado.map((item) => item.prioridad)).toEqual([700, 600, 200, 100]);
  });

  it("devuelve una lista vacía cuando el plan no requiere acciones", () => {
    expect(generarSugerencias(estadoBase)).toEqual([]);
  });
});
