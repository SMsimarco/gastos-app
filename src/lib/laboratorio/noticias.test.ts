import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./gemini", () => ({ llamarGeminiJson: vi.fn() }));

import { llamarGeminiJson } from "./gemini";
import {
  construirPromptResumen,
  elegirTickers,
  filasDeNoticias,
  normalizarResumenes,
  resumirNoticiasPendientes,
} from "./noticias";

const UNIVERSO = ["VOO", "NVDA", "AAPL"];

describe("elegirTickers", () => {
  it("se queda con los del universo y elige el primero como principal", () => {
    expect(elegirTickers(["tsla", "nvda", "AAPL"], UNIVERSO)).toEqual({ ticker: "NVDA", tickers: ["NVDA", "AAPL"] });
  });
  it("si ninguno es del universo no hay ticker principal", () => {
    expect(elegirTickers(["TSLA"], UNIVERSO)).toEqual({ ticker: null, tickers: [] });
  });
});

describe("filasDeNoticias", () => {
  it("deduplica por URL, descarta noticias de empresas fuera del universo y deja las globales sin ticker", () => {
    const filas = filasDeNoticias({
      universo: UNIVERSO,
      empresa: [
        { fuente: "alpaca:x", titular: "NVDA sube", url: "https://a/1", publicadoAt: "2026-10-05T10:00:00Z", resumenFuente: null, tickers: ["NVDA"] },
        { fuente: "alpaca:x", titular: "TSLA baja", url: "https://a/2", publicadoAt: "2026-10-05T10:00:00Z", resumenFuente: null, tickers: ["TSLA"] },
      ],
      globales: [
        { tema: "fed", titular: "La Fed", url: "https://g/1", publicadoAt: "2026-10-05T11:00:00Z", dominio: "reuters.com" },
        { tema: "inflacion", titular: "NVDA sube (repetida)", url: "https://a/1", publicadoAt: "2026-10-05T10:00:00Z", dominio: "x.com" },
      ],
    });
    expect(filas.map((fila) => fila.url)).toEqual(["https://a/1", "https://g/1"]);
    expect(filas[0]).toMatchObject({ ticker: "NVDA", tema: null });
    expect(filas[1]).toMatchObject({ ticker: null, tickers: [], tema: "fed", fuente: "gdelt:reuters.com" });
  });
});

describe("normalizarResumenes", () => {
  it("acota rangos, filtra tickers fuera del universo y descarta índices inválidos", () => {
    const resultado = normalizarResumenes(
      [
        { indice: 0, resumen: "  Chip nuevo ", sentimiento: 3, relevancia: -2, tickers: ["nvda", "TSLA"] },
        { indice: 7, resumen: "no existe", sentimiento: 0, relevancia: 0, tickers: [] },
        { indice: 1, resumen: "", sentimiento: 0, relevancia: 0.5, tickers: [] },
        { indice: 1, resumen: "ok", sentimiento: "x", relevancia: 0.5, tickers: [] },
      ],
      2,
      UNIVERSO
    );
    expect([...resultado.keys()]).toEqual([0]);
    expect(resultado.get(0)).toEqual({ resumen: "Chip nuevo", sentimiento: 1, relevancia: 0, tickers: ["NVDA"] });
  });
  it("una respuesta que no es un array no rompe", () => {
    expect(normalizarResumenes({ error: true }, 3, UNIVERSO).size).toBe(0);
  });
});

describe("construirPromptResumen", () => {
  it("incluye todas las noticias del lote con su índice y el universo", () => {
    const prompt = construirPromptResumen(
      [
        { id: "a", titular: "Titular uno", ticker: "NVDA", tickers: ["NVDA"], tema: null },
        { id: "b", titular: "Titular dos", ticker: null, tickers: [], tema: "fed" },
      ],
      UNIVERSO
    );
    expect(prompt).toContain("VOO, NVDA, AAPL");
    expect(prompt).toContain('"indice":0');
    expect(prompt).toContain('"indice":1');
    expect(prompt).toContain("Titular dos");
  });
});

type Tablas = { pendientes: unknown[]; costos: Array<{ costo_usd: number }> };

function clienteFalso({ pendientes, costos }: Tablas) {
  const insertados: Array<{ tabla: string; fila: unknown }> = [];
  const cliente = {
    from: (tabla: string) => {
      const resultado = tabla === "lab_costos_ia" ? costos : pendientes;
      const consulta: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "gte", "order", "limit", "update"]) consulta[metodo] = () => consulta;
      consulta.insert = (fila: unknown) => {
        insertados.push({ tabla, fila });
        return Promise.resolve({ error: null });
      };
      consulta.then = (resolver: (valor: unknown) => unknown) => resolver({ data: resultado, error: null });
      return consulta;
    },
  } as unknown as SupabaseClient;
  return { cliente, insertados };
}

const PENDIENTE = { id: "n1", titular: "NVDA anuncia chip", ticker: "NVDA", tickers: ["NVDA"], tema: null };

describe("resumirNoticiasPendientes", () => {
  beforeEach(() => {
    vi.mocked(llamarGeminiJson).mockReset();
  });

  it("con el tope alcanzado no llama a la IA", async () => {
    const { cliente } = clienteFalso({ pendientes: [PENDIENTE], costos: [{ costo_usd: 6 }, { costo_usd: 4 }] });
    const resultado = await resumirNoticiasPendientes(cliente, { universo: UNIVERSO, modelo: "gemini-3.5-flash-lite", topeIaUsd: 10 });
    expect(resultado.estado).toBe("sin_presupuesto");
    expect(llamarGeminiJson).not.toHaveBeenCalled();
  });

  it("sin noticias pendientes no llama a la IA", async () => {
    const { cliente } = clienteFalso({ pendientes: [], costos: [] });
    const resultado = await resumirNoticiasPendientes(cliente, { universo: UNIVERSO, modelo: "gemini-3.5-flash-lite", topeIaUsd: 10 });
    expect(resultado.estado).toBe("sin_pendientes");
    expect(llamarGeminiJson).not.toHaveBeenCalled();
  });

  it("resume todo el lote en UNA sola llamada y registra el costo", async () => {
    vi.mocked(llamarGeminiJson).mockResolvedValue({
      data: [
        { indice: 0, resumen: "Chip nuevo", sentimiento: 0.6, relevancia: 0.9, tickers: ["NVDA"] },
        { indice: 1, resumen: "Fed sin cambios", sentimiento: 0, relevancia: 0.5, tickers: [] },
      ],
      tokensEntrada: 1_000,
      tokensSalida: 200,
    });
    const { cliente, insertados } = clienteFalso({
      pendientes: [PENDIENTE, { id: "n2", titular: "La Fed", ticker: null, tickers: [], tema: "fed" }],
      costos: [],
    });
    const resultado = await resumirNoticiasPendientes(cliente, { universo: UNIVERSO, modelo: "gemini-3.5-flash-lite", topeIaUsd: 10 });
    expect(resultado).toMatchObject({ estado: "ok", resumidas: 2 });
    expect(llamarGeminiJson).toHaveBeenCalledTimes(1);
    expect(insertados).toHaveLength(1);
    expect(insertados[0].tabla).toBe("lab_costos_ia");
    expect(resultado.costoUsd).toBeCloseTo((1_000 * 0.3 + 200 * 2.5) / 1_000_000, 6);
  });

  it("si la IA falla devuelve error sin reintentar y las noticias quedan pendientes", async () => {
    vi.mocked(llamarGeminiJson).mockImplementation(async () => {
      throw new Error("Gemini falló: 500");
    });
    const { cliente, insertados } = clienteFalso({ pendientes: [PENDIENTE], costos: [] });
    const resultado = await resumirNoticiasPendientes(cliente, { universo: UNIVERSO, modelo: "gemini-3.5-flash-lite", topeIaUsd: 10 });
    expect(resultado).toMatchObject({ estado: "error", resumidas: 0 });
    expect(llamarGeminiJson).toHaveBeenCalledTimes(1);
    expect(insertados).toHaveLength(0);
  });
});
