import { describe, expect, it } from "vitest";
import { armarBriefing, MAX_CARACTERES_BRIEFING, type DatosCompletos, type EntradaBriefing } from "./briefing";

const completos: DatosCompletos = {
  noticias: [{ texto: "NVDA presentó un chip nuevo", sentimiento: 0.7, relevancia: 0.9, tickers: ["NVDA"], tema: null }],
  macro: [{ nombre: "Tasa de la Fed", valor: "3.88%", variacion: "0 pp", al: "2026-10-01" }],
  fundamentales: [{ ticker: "NVDA", pe: 29.2, margen_neto: 63.7 }],
  presentaciones_sec: [{ ticker: "AAPL", formulario: "8-K", descripcion: "Resultados trimestrales", fecha: "2026-10-01" }],
  calendario_proximos_7_dias: [{ fecha: "2026-10-14", descripcion: "Inflación de EE.UU. (CPI)" }],
  diario: [{ fecha: "2026-10-02", resumen: "Rueda positiva con QQQ en máximos", puntos_clave: ["QQQ +1%"], a_mirar: ["CPI"], tono: "positivo" }],
  senales_de_hoy: [{ ticker: "QQQ", evento: "maximo_52s", etiqueta: "Nuevo máximo de 52 semanas", a5: null, a20: null }],
  lecciones: [{ fecha: "2026-09-30", ticker: "KO", leccion: "Comprar tras una caída fuerte rindió poco a 5 ruedas" }],
};

const entrada = (parcial: Partial<EntradaBriefing> = {}): EntradaBriefing => ({
  fecha: "2026-10-05",
  horaNuevaYork: "10:30",
  disparador: "diaria",
  portafolio: {
    valorTotalUsd: 1_000,
    efectivoUsd: 700,
    capitalInicialUsd: 1_000,
    posiciones: [{ ticker: "VOO", cantidad: 0.4, valorUsd: 300, costoPromedio: 700, pnlPct: 7.14 }],
    operacionesHoy: 0,
    diasDesdeInicio: 3,
  },
  limites: { maxPctPorPosicion: 20, minPctEfectivo: 10, maxOperacionesPorDia: 3 },
  indicadores: [{ ticker: "VOO", precio: 707.35, variacion_dia: 0.73, variacion_semana: 1.2, variacion_mes: 3.1, rsi14: 54, sma50: 690, sma200: 660, distancia_max52s: -1.05, volatilidad20: 12.5, volumen_relativo: 1.1 }],
  completos,
  ...parcial,
});

describe("perfil solo_precios (bot C)", () => {
  const { briefing, recortes } = armarBriefing("solo_precios", entrada({ evento: { tipo: "vix", ticker: null, detalle: { variacion_pct: 22 } } }));
  const texto = JSON.stringify(briefing);

  it("nunca incluye noticias, macro, fundamentales, calendario, diario, señales ni lecciones, aunque vengan en la entrada", () => {
    for (const clave of ["noticias", "macro", "fundamentales", "presentaciones_sec", "calendario", "diario", "senales", "lecciones", "evento_que_disparo"]) {
      expect(Object.keys(briefing).some((k) => k.includes(clave)), `no debería tener ${clave}`).toBe(false);
    }
    for (const fragmento of ["NVDA presentó un chip", "Tasa de la Fed", "Inflación de EE.UU.", "Rueda positiva", "Comprar tras una caída", "Resultados trimestrales", "pe\":29.2"]) {
      expect(texto).not.toContain(fragmento);
    }
    expect(recortes).toEqual([]);
  });

  it("sí incluye portafolio, límites e indicadores técnicos con las medias ya calculadas", () => {
    expect(Object.keys(briefing)).toEqual(["fecha", "hora_nueva_york", "disparador", "portafolio", "limites", "universo"]);
    const [voo] = briefing.universo as Array<Record<string, unknown>>;
    expect(voo).toMatchObject({ ticker: "VOO", precio: 707.35, rsi14: 54, vs_media50_pct: 2.51, vs_media200_pct: 7.17, vs_max52s_pct: -1.05 });
    expect(briefing.portafolio).toMatchObject({ valor_total_usd: 1000, efectivo_pct: 70, rendimiento_desde_inicio_pct: 0, dias_desde_inicio: 3 });
  });

  it("es mucho más chico que el completo", () => {
    const completo = JSON.stringify(armarBriefing("completo", entrada()).briefing);
    expect(texto.length).toBeLessThan(completo.length);
  });
});

describe("perfil completo (bots A y B)", () => {
  it("incluye todas las secciones", () => {
    const { briefing } = armarBriefing("completo", entrada());
    for (const clave of ["noticias", "macro", "fundamentales", "presentaciones_sec", "calendario_proximos_7_dias", "diario", "senales_de_hoy", "lecciones"]) {
      expect(briefing, clave).toHaveProperty(clave);
    }
    expect(JSON.stringify(briefing)).toContain("NVDA presentó un chip");
  });

  it("agrega qué evento disparó la decisión, solo para el perfil completo", () => {
    const evento = { tipo: "vix", ticker: null, detalle: { variacion_pct: 22 } };
    const { briefing } = armarBriefing("completo", entrada({ disparador: "evento", evento }));
    expect(briefing.evento_que_disparo_esta_decision).toEqual(evento);
    expect(briefing.disparador).toBe("evento");
  });

  it("sin datos completos devuelve solo la base, sin romper", () => {
    const { briefing } = armarBriefing("completo", entrada({ completos: undefined }));
    expect(briefing).not.toHaveProperty("noticias");
  });
});

describe("tope de tamaño", () => {
  const muchas = <T,>(n: number, hacer: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => hacer(i));
  const enorme: DatosCompletos = {
    noticias: muchas(40, (i) => ({ texto: `Noticia número ${i} `.repeat(30), sentimiento: 0.1, relevancia: 0.9 - i / 100, tickers: ["NVDA"], tema: null })),
    macro: muchas(17, (i) => ({ nombre: `Serie ${i}`, valor: "1", variacion: "0", al: "2026-10-01" })),
    fundamentales: muchas(11, (i) => ({ ticker: `T${i}`, detalle: "x".repeat(400) })),
    presentaciones_sec: muchas(8, (i) => ({ ticker: "AAPL", formulario: "8-K", descripcion: "d".repeat(200), fecha: `2026-10-0${i % 9}` })),
    calendario_proximos_7_dias: muchas(12, (i) => ({ fecha: "2026-10-10", descripcion: `Evento ${i} `.repeat(20) })),
    diario: muchas(5, (i) => ({ fecha: `2026-09-${10 + i}`, resumen: "r".repeat(900), puntos_clave: ["p".repeat(150)], a_mirar: ["a".repeat(100)], tono: "neutral" })),
    senales_de_hoy: muchas(10, (i) => ({ ticker: `T${i}`, evento: "rsi_bajo", etiqueta: "RSI baja de 30 (sobrevendida)", a5: null, a20: null })),
    lecciones: muchas(10, (i) => ({ fecha: `2026-09-${10 + i}`, ticker: "KO", leccion: "l".repeat(300) })),
  };

  it("respeta el tope de caracteres recortando secciones y dejando constancia de qué se recortó", () => {
    const { briefing, recortes } = armarBriefing("completo", entrada({ completos: enorme }));
    expect(JSON.stringify(briefing).length).toBeLessThanOrEqual(MAX_CARACTERES_BRIEFING);
    expect(recortes.length).toBeGreaterThan(0);
    expect(recortes.some((r) => r.startsWith("lecciones"))).toBe(true);
  });

  it("no toca el portafolio ni los indicadores, que es lo imprescindible para decidir", () => {
    const { briefing } = armarBriefing("completo", entrada({ completos: enorme }));
    expect(briefing.portafolio).toBeDefined();
    expect((briefing.universo as unknown[]).length).toBe(1);
  });

  it("un briefing que ya entra no se recorta", () => {
    expect(armarBriefing("completo", entrada()).recortes).toEqual([]);
  });
});
