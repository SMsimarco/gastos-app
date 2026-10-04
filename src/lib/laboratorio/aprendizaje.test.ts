import { describe, expect, it } from "vitest";
import { armarHechos, construirPromptDiario, normalizarDiario } from "./diario";
import { armarSenales, estadisticaParaSenal, recortarDiarios, type EstadisticaDB } from "./memoria";
import type { FilaMacroPanel } from "./panel";

const fila = (parcial: Partial<EstadisticaDB>): EstadisticaDB => ({
  evento: "rsi_bajo",
  ticker: "*",
  horizonte: 5,
  n: 100,
  media: 1.2,
  mediana: 0.9,
  pct_positivo: 58,
  media_base: 0.4,
  ...parcial,
});

describe("estadisticaParaSenal", () => {
  it("usa la del ticker si tiene casos suficientes y calcula la ventaja contra un día cualquiera", () => {
    const resultado = estadisticaParaSenal([fila({ ticker: "NVDA", n: 30, media: 2, media_base: 0.5 }), fila({})], "rsi_bajo", "NVDA", 5);
    expect(resultado).toMatchObject({ origen: "ticker", n: 30, media: 2, ventaja: 1.5 });
  });
  it("si el ticker tiene pocos casos cae a la del universo", () => {
    const resultado = estadisticaParaSenal([fila({ ticker: "NVDA", n: 5 }), fila({ n: 200 })], "rsi_bajo", "NVDA", 5);
    expect(resultado).toMatchObject({ origen: "universo", n: 200, ventaja: 0.8 });
  });
  it("con pocos casos en todos lados no devuelve nada: es ruido", () => {
    expect(estadisticaParaSenal([fila({ n: 19 })], "rsi_bajo", "NVDA", 5)).toBeNull();
    expect(estadisticaParaSenal([], "rsi_bajo", "NVDA", 5)).toBeNull();
  });
  it("no mezcla eventos ni horizontes distintos", () => {
    expect(estadisticaParaSenal([fila({ evento: "rsi_alto" })], "rsi_bajo", "NVDA", 5)).toBeNull();
    expect(estadisticaParaSenal([fila({ horizonte: 20 })], "rsi_bajo", "NVDA", 5)).toBeNull();
  });
  it("una fila sin media (null) no se usa", () => {
    expect(estadisticaParaSenal([fila({ media: null })], "rsi_bajo", "NVDA", 5)).toBeNull();
  });
});

describe("armarSenales", () => {
  it("agrega la etiqueta en español y las estadísticas a 5 y 20 ruedas", () => {
    const [senal] = armarSenales([{ ticker: "NVDA", evento: "rsi_bajo" }], [fila({}), fila({ horizonte: 20, media: 3 })]);
    expect(senal.etiqueta).toBe("RSI baja de 30 (sobrevendida)");
    expect(senal.a5?.media).toBe(1.2);
    expect(senal.a20?.media).toBe(3);
  });
});

describe("recortarDiarios", () => {
  const diario = (fecha: string, largo: number) => ({ fecha, resumen: "x".repeat(largo), puntos_clave: [], a_mirar: [], tono: "neutral" });
  it("se queda con las más nuevas, hasta el máximo de días", () => {
    const resultado = recortarDiarios([diario("10", 10), diario("09", 10), diario("08", 10), diario("07", 10)], 2);
    expect(resultado.map((d) => d.fecha)).toEqual(["10", "09"]);
  });
  it("si se pasa del tope de caracteres descarta primero las más viejas, pero nunca la última", () => {
    const resultado = recortarDiarios([diario("10", 1_500), diario("09", 1_500), diario("08", 1_500)], 5, 3_000);
    expect(resultado.map((d) => d.fecha)).toEqual(["10", "09"]);
    expect(recortarDiarios([diario("10", 9_999)], 5, 100)).toHaveLength(1);
  });
});

describe("armarHechos", () => {
  const indicador = (ticker: string, variacion: number) => ({ ticker, cierre: 100, variacion_dia: variacion, rsi14: 50, distancia_max52s: -1, volumen_relativo: 1 });
  const macro = (serie: string, fecha: string): FilaMacroPanel => ({ serie, nombre: serie, unidad: "%", grupo: "eeuu", valor: 4.3, fecha, variacion: -0.25, tipoVariacion: "pp" });

  it("elige los 8 mayores movimientos y siempre incluye VOO y QQQ como referencia", () => {
    const indicadores = [...Array.from({ length: 12 }, (_, i) => indicador(`T${i}`, 10 - i)), indicador("VOO", 0.1), indicador("QQQ", 0.2)];
    const hechos = armarHechos({ fecha: "2026-10-05", indicadores, macro: [], noticias: [], eventos: [], filings: [], calendario: [], senales: [] });
    const tickers = hechos.mercado.map((fila) => fila.ticker);
    expect(tickers).toContain("T0");
    expect(tickers).not.toContain("T9");
    expect(tickers).toEqual(expect.arrayContaining(["VOO", "QQQ"]));
    expect(hechos.mercado).toHaveLength(10);
  });

  it("deja afuera el macro viejo, ordena las noticias por relevancia y limita el calendario a 7 días", () => {
    const hechos = armarHechos({
      fecha: "2026-10-05",
      indicadores: [],
      macro: [macro("DFF", "2026-10-04"), macro("UMCSENT", "2026-08-01")],
      noticias: [
        { resumen: "poco relevante", titular: "a", sentimiento: 0, relevancia: 0.1, tickers: [], tema: null },
        { resumen: null, titular: "muy relevante", sentimiento: 0.5, relevancia: 0.9, tickers: ["NVDA"], tema: null },
      ],
      eventos: [],
      filings: [],
      calendario: [
        { fecha: "2026-10-07", tipo: "macro", ticker: null, detalle: { descripcion: "Inflación de EE.UU. (CPI)" } },
        { fecha: "2026-10-20", tipo: "balance", ticker: "AAPL", detalle: {} },
        { fecha: "2026-10-04", tipo: "balance", ticker: "KO", detalle: {} },
      ],
      senales: [{ ticker: "NVDA", evento: "rsi_bajo" }],
    });
    expect(hechos.macro.map((fila) => fila.nombre)).toEqual(["DFF"]);
    expect(hechos.noticias[0].texto).toBe("muy relevante");
    expect(hechos.calendario_proximos_7_dias).toEqual([{ fecha: "2026-10-07", descripcion: "Inflación de EE.UU. (CPI)" }]);
    expect(hechos.senales_de_hoy).toEqual([{ ticker: "NVDA", evento: "RSI baja de 30 (sobrevendida)" }]);
  });
});

describe("construirPromptDiario", () => {
  it("incluye los hechos y las reglas de no inventar ni recomendar", () => {
    const hechos = armarHechos({ fecha: "2026-10-05", indicadores: [{ ticker: "VOO", cierre: 707.35, variacion_dia: 0.73, rsi14: 54, distancia_max52s: -1, volumen_relativo: 1.1 }], macro: [], noticias: [], eventos: [], filings: [], calendario: [], senales: [] });
    const prompt = construirPromptDiario(hechos);
    expect(prompt).toContain("2026-10-05");
    expect(prompt).toContain("707.35");
    expect(prompt).toContain("No inventes");
    expect(prompt).toContain("No des recomendaciones");
  });
});

describe("normalizarDiario", () => {
  it("acota largos y cantidades y corrige un tono inválido", () => {
    const resultado = normalizarDiario({
      resumen: `  ${"a".repeat(2_000)}  `,
      puntos_clave: ["uno", "", "dos", "tres", "cuatro", "cinco", "seis", 7],
      a_mirar: ["a", "b", "c", "d"],
      tono: "eufórico",
    });
    expect(resultado?.resumen).toHaveLength(1_200);
    expect(resultado?.puntos_clave).toEqual(["uno", "dos", "tres", "cuatro", "cinco"]);
    expect(resultado?.a_mirar).toHaveLength(3);
    expect(resultado?.tono).toBe("neutral");
  });
  it("rechaza una respuesta sin resumen o que no es un objeto", () => {
    expect(normalizarDiario({ resumen: "  ", puntos_clave: [], a_mirar: [], tono: "mixto" })).toBeNull();
    expect(normalizarDiario("hola")).toBeNull();
    expect(normalizarDiario(null)).toBeNull();
  });
});
