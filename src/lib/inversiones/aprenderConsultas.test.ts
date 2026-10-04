import { describe, expect, it, vi } from "vitest";

vi.mock("./aprenderPanel", () => ({ obtenerPanelAprender: vi.fn() }));

import { evaluarCandidatos, PESOS_DEFAULT, type DatosMercado, type EstadoAprender } from "./aprender";
import { interpretarConsultaAprender, respuestaPorTicker, responderConsultaAprender } from "./aprenderConsultas";
import { obtenerPanelAprender } from "./aprenderPanel";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validarTextoAprender } from "./aprenderTextos";

describe("interpretarConsultaAprender", () => {
  it("reconoce las preguntas del bolsillo aprender", () => {
    expect(interpretarConsultaAprender("¿qué hago con lo de aprender?")).toEqual({ tipo: "estado" });
    expect(interpretarConsultaAprender("¿cómo viene aprender?")).toEqual({ tipo: "estado" });
    expect(interpretarConsultaAprender("¿por qué me sugerís MSFT?")).toEqual({ tipo: "por_que", ticker: "MSFT" });
    expect(interpretarConsultaAprender("¿por qué no NVDA?")).toEqual({ tipo: "por_que_no", ticker: "NVDA" });
    expect(interpretarConsultaAprender("¿qué tiene que pasar para que compre KO?")).toEqual({ tipo: "que_pasa", ticker: "KO" });
  });

  it("usa el ticker que ya extrajo el clasificador aunque venga en minúsculas", () => {
    expect(interpretarConsultaAprender("¿por qué no ko?", "ko")).toEqual({ tipo: "por_que_no", ticker: "KO" });
  });

  it("no toma las preguntas que no son de aprender", () => {
    expect(interpretarConsultaAprender("¿cuánto tengo en total?")).toBeNull();
    expect(interpretarConsultaAprender("¿me conviene comprar VOO?")).toBeNull();
    expect(interpretarConsultaAprender("¿por qué no hay nada pendiente?")).toBeNull();
  });
});

function datos(ticker: string, cambios: Partial<DatosMercado> = {}): DatosMercado {
  return {
    ticker,
    precio: { valor: 100, fecha: "2026-10-05", fuente: "Alpaca" },
    indicadores: { fecha: "2026-10-05", cierre: 100, sma200: 100, distanciaMax52s: -12, volatilidad20: 20 },
    fundamentales: { fecha: "2026-10-03", pe: 28, crecimientoIngresos: 10, margenNeto: 15 },
    peProm5a: { valor: 32, fecha: "2026-10-03" },
    noticias: { sentimiento: 0.1, cantidad: 5, usadas: [], fechaUltima: "2026-10-04" },
    proximoBalance: null,
    ...cambios,
  };
}

describe("respuestaPorTicker", () => {
  const estado: EstadoAprender = {
    hoy: "2026-10-05",
    saldoAprenderUsd: 120,
    minimoCompraUsd: 100,
    pesos: PESOS_DEFAULT,
    activos: ["MSFT", "KO"].map((ticker) => ({ ticker, tesis: "t", tomaGananciaPct: null, stopRevisionPct: null, gananciaPct: 0, valorPosicionUsd: 0 })),
    datos: { MSFT: datos("MSFT"), KO: datos("KO", { proximoBalance: "2026-10-06" }) },
    voo: null,
  };
  const resultado = evaluarCandidatos(estado);

  it("explica por qué sugiere un ticker con su ficha completa", () => {
    const texto = respuestaPorTicker(resultado, "por_que", "MSFT");
    expect(texto).toContain("MSFT tiene");
    expect(texto).toContain("valuación");
    expect(validarTextoAprender(texto, { maxLargo: 2500 })).toEqual([]);
  });

  it("explica por qué un ticker quedó afuera y qué tendría que cambiar", () => {
    const texto = respuestaPorTicker(resultado, "que_pasa", "KO");
    expect(texto).toContain("Presenta balance en 1 día");
    expect(texto).toContain("Qué tendría que cambiar");
  });

  it("si el ticker no está en la lista de aprender lo dice", () => {
    expect(respuestaPorTicker(resultado, "por_que_no", "NVDA")).toContain("no está en tu lista de aprender");
  });
});

describe("responderConsultaAprender con el saldo bajo el mínimo", () => {
  it("solo dice cuánto falta, también cuando preguntan por un ticker de la lista", async () => {
    vi.mocked(obtenerPanelAprender).mockResolvedValue({ puedeComprar: false, saldoUsd: 36, faltaUsd: 64, candidatos: [], excluidos: [], voo: null, opcionEsperar: { accion: "esperar_o_sumar_a_voo", motivo: "x" }, alertas: [], advertencias: [], rendimiento: null } as unknown as Awaited<ReturnType<typeof obtenerPanelAprender>>);
    const cliente = {} as SupabaseClient;
    for (const pregunta of ["¿qué hago con lo de aprender?", "¿por qué me sugerís MSFT?"]) {
      const texto = (await responderConsultaAprender(cliente, "u1", pregunta))!;
      expect(texto).toContain("te faltan US$64");
      expect(texto).not.toContain("no está en tu lista");
      expect(texto).not.toMatch(/VOO|Opciones/);
      expect(texto.trimEnd().endsWith("Sugerencia según tu plan, no asesoramiento financiero.")).toBe(true);
    }
    expect(await responderConsultaAprender(cliente, "u1", "¿cuánto tengo en total?")).toBeNull();
  });
});
