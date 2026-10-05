import { describe, expect, it } from "vitest";
import { evaluarCandidatos, PESOS_DEFAULT, type DatosMercado, type EstadoAprender } from "./aprender";
import { DISCLAIMER_FINANCIERO } from "./avisos";
import {
  MAX_LINEAS_AVISO,
  numerosInventados,
  redactarAlertaAprender,
  redactarAvisoAprender,
  redactarFaltaAprender,
  redactarNoEstaEnLista,
  redactarPorQueNo,
  redactarPorQueSugerido,
  redactarResumenAprender,
  validarTextoAprender,
} from "./aprenderTextos";

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

function estado(cambios: Partial<EstadoAprender> = {}): EstadoAprender {
  const tickers = ["MSFT", "KO", "AAPL"];
  return {
    hoy: "2026-10-05",
    saldoAprenderUsd: 105,
    minimoCompraUsd: 100,
    pesos: PESOS_DEFAULT,
    activos: tickers.map((ticker) => ({ ticker, tesis: "t", tomaGananciaPct: null, stopRevisionPct: null, gananciaPct: 0, valorPosicionUsd: 0 })),
    datos: { MSFT: datos("MSFT", { proximoBalance: "2026-10-14" }), KO: datos("KO"), AAPL: datos("AAPL") },
    voo: null,
    ...cambios,
  };
}

describe("textos de aprender", () => {
  it("el aviso tiene el largo permitido, la opción de esperar, el descargo y no usa palabras prohibidas", () => {
    const texto = redactarAvisoAprender(evaluarCandidatos(estado()));
    expect(validarTextoAprender(texto, { maxLineas: MAX_LINEAS_AVISO })).toEqual([]);
    expect(texto.split("\n").length).toBeLessThanOrEqual(MAX_LINEAS_AVISO);
    expect(texto).toContain("Ya tenés US$105");
    expect(texto).toContain("presenta balance en 9 días");
    expect(texto.trimEnd().endsWith(DISCLAIMER_FINANCIERO)).toBe(true);
  });

  it("con el saldo bajo solo dice cuánto falta", () => {
    const texto = redactarAvisoAprender(evaluarCandidatos(estado({ saldoAprenderUsd: 30 })));
    expect(texto).toContain("te faltan US$70");
    expect(texto).not.toContain("Opciones");
    expect(validarTextoAprender(texto, { exigirEsperar: false })).toEqual([]);
  });

  it("el validador detecta las palabras prohibidas, el largo y la falta del descargo o de la opción de esperar", () => {
    for (const palabra of ["oportunidad única", "seguro", "garantizado", "no podés perder"]) {
      expect(validarTextoAprender(`Comprá ya, es ${palabra}. Esperá si querés.\n${DISCLAIMER_FINANCIERO}`).join(" ")).toContain("Palabra prohibida");
    }
    expect(validarTextoAprender(`x\n${DISCLAIMER_FINANCIERO}`).join(" ")).toContain("opción de esperar");
    expect(validarTextoAprender("Podés esperar.").join(" ")).toContain("descargo");
    expect(validarTextoAprender(`Esperá. ${"a".repeat(800)}\n${DISCLAIMER_FINANCIERO}`).join(" ")).toContain("Largo");
    // "inseguro" o "aseguramos" no son la palabra prohibida
    expect(validarTextoAprender(`Esperá, es normal sentirse inseguro.\n${DISCLAIMER_FINANCIERO}`)).toEqual([]);
  });

  it("alertas, falta, consultas y resumen terminan con el descargo y pasan el validador", () => {
    const resultado = evaluarCandidatos(estado());
    const textos = [
      redactarAlertaAprender({ tipo: "objetivo_ganancia", mensaje: "MSFT llegó a tu objetivo de +30%: tu regla es tomar ganancia acá." }),
      redactarFaltaAprender({ saldoUsd: 20, faltaUsd: 80 }),
      redactarPorQueSugerido(resultado.candidatos[0]),
      redactarPorQueNo("NVDA", { ticker: "NVDA", motivo: "balance", detalle: "Presenta balance en 2 días (07/10).", queCambiaria: "Después del balance se vuelve a evaluar." }),
      redactarNoEstaEnLista("NVDA"),
    ];
    for (const texto of textos) expect(validarTextoAprender(texto, { exigirEsperar: false, maxLargo: 2500 })).toEqual([]);
  });

  it("la ficha explicada muestra los dos lados y avisa si hay pocos casos de historial", () => {
    const resultado = evaluarCandidatos(estado({ historial: { valuacion: { casos: 10, aciertos: 6 } } }));
    const texto = redactarPorQueSugerido(resultado.candidatos.find((c) => c.ticker === "MSFT")!);
    expect(texto).toContain("6 de 10 le ganaron a VOO; con menos de 30 casos puede ser suerte");
    expect(texto).toContain("esperar o sumar a VOO");
    expect(texto).toContain("Qué cambiaría");
  });

  it("el resumen semanal compara cada posición contra VOO", () => {
    const lineas = redactarResumenAprender({ saldoUsd: 40, faltaUsd: 60, posiciones: [{ ticker: "KO", gananciaPct: 4.2, vooPct: 2.1 }, { ticker: "MSFT", gananciaPct: -3, vooPct: null }], alertas: [{ mensaje: "KO llegó a tu objetivo." }], aprendizaje: "Aprendí algo." });
    expect(lineas[0]).toContain("te faltan US$60");
    expect(lineas[1]).toBe("KO: +4% (VOO en el mismo período: +2%).");
    expect(lineas[2]).toContain("sin dato de VOO");
    expect(lineas.at(-1)).toBe("Aprendí algo.");
  });
});

describe("números inventados", () => {
  it("detecta números que no están en los hechos ni en el texto base", () => {
    expect(numerosInventados("Tenés US$105 y MSFT cae 12%.", ["US$105 y 12"])).toEqual([]);
    expect(numerosInventados("Tenés US$105 y subirá 30%.", ["US$105"])).toEqual(["30"]);
    expect(numerosInventados("Sube 2,5%", ["2.5"])).toEqual([]);
  });
});
