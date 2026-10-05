import { describe, expect, it } from "vitest";
import {
  evaluarCandidatos,
  explicarTicker,
  PESOS_DEFAULT,
  puntajeCalidad,
  puntajeCaida,
  puntajeMomento,
  puntajeNoticias,
  puntajeTendencia,
  puntajeValuacion,
  type ActivoAprender,
  type DatosMercado,
  type EstadoAprender,
} from "./aprender";

const HOY = "2026-10-05";

function datos(ticker: string, cambios: Partial<DatosMercado> = {}): DatosMercado {
  return {
    ticker,
    precio: { valor: 100, fecha: "2026-10-05", fuente: "Alpaca" },
    indicadores: { fecha: "2026-10-05", cierre: 100, sma200: 100, distanciaMax52s: -10, volatilidad20: 20 },
    fundamentales: { fecha: "2026-10-03", pe: 20, crecimientoIngresos: 10, margenNeto: 15 },
    peProm5a: { valor: 20, fecha: "2026-10-03" },
    noticias: { sentimiento: 0, cantidad: 5, usadas: [{ titular: "Titular", url: "https://x.test/1", fuente: "Alpaca", publicadoAt: "2026-10-04T10:00:00Z" }], fechaUltima: "2026-10-04" },
    proximoBalance: null,
    ...cambios,
  };
}

function activo(ticker: string, cambios: Partial<ActivoAprender> = {}): ActivoAprender {
  return { ticker, tesis: `Tesis ${ticker}`, tomaGananciaPct: null, stopRevisionPct: null, gananciaPct: 0, valorPosicionUsd: 0, ...cambios };
}

function estado(cambios: Partial<EstadoAprender> = {}, tickers: string[] = ["MSFT", "KO", "AAPL"]): EstadoAprender {
  return {
    hoy: HOY,
    saldoAprenderUsd: 120,
    minimoCompraUsd: 100,
    pesos: PESOS_DEFAULT,
    activos: tickers.map((ticker) => activo(ticker)),
    datos: Object.fromEntries(tickers.map((ticker) => [ticker, datos(ticker)])),
    voo: datos("VOO", { fundamentales: null, peProm5a: null }),
    ...cambios,
  };
}

describe("componentes del puntaje", () => {
  it("valuación: más barata que su promedio suma, más cara resta, sin dato es null", () => {
    expect(puntajeValuacion(24, 40)).toBe(1); // 40% más barata = tope
    expect(puntajeValuacion(20, 20)).toBe(0);
    expect(puntajeValuacion(60, 40)).toBe(-1);
    expect(puntajeValuacion(null, 40)).toBeNull();
    expect(puntajeValuacion(28, null)).toBeNull();
  });

  it("momento: abajo del máximo suma, en el máximo resta; la tendencia se enfría si corrió demasiado", () => {
    expect(puntajeCaida(0)).toBe(-0.5);
    expect(puntajeCaida(-20)).toBe(1);
    expect(puntajeCaida(-40)).toBe(1);
    expect(puntajeTendencia(-30)).toBe(-1);
    expect(puntajeTendencia(15)).toBe(1);
    expect(puntajeTendencia(50)).toBe(0);
    expect(puntajeMomento(-20, 15)).toBe(1);
    expect(puntajeMomento(null, null)).toBeNull();
  });

  it("calidad: crecimiento y margen, con uno solo también alcanza", () => {
    expect(puntajeCalidad(20, 25)).toBe(1);
    expect(puntajeCalidad(0, 5)).toBe(0);
    expect(puntajeCalidad(20, null)).toBe(1);
    expect(puntajeCalidad(null, null)).toBeNull();
  });

  it("noticias: necesita al menos 3 noticias", () => {
    expect(puntajeNoticias(0.5, 5)).toBe(1);
    expect(puntajeNoticias(-0.5, 5)).toBe(-1);
    expect(puntajeNoticias(0.9, 2)).toBeNull();
    expect(puntajeNoticias(null, 10)).toBeNull();
  });
});

describe("evaluarCandidatos", () => {
  it("con el saldo bajo el mínimo solo dice cuánto falta", () => {
    const resultado = evaluarCandidatos(estado({ saldoAprenderUsd: 40 }));
    expect(resultado.puedeComprar).toBe(false);
    expect(resultado.faltaUsd).toBe(60);
    expect(resultado.candidatos).toEqual([]);
    expect(resultado.excluidos).toEqual([]);
    expect(resultado.opcionEsperar.motivo).toContain("US$60");
  });

  it("con la lista vacía no inventa candidatos", () => {
    const resultado = evaluarCandidatos(estado({ activos: [], datos: {} }));
    expect(resultado.puedeComprar).toBe(true);
    expect(resultado.candidatos).toEqual([]);
    expect(resultado.advertencias.join(" ")).toContain("lista de aprender está vacía");
  });

  it("devuelve hasta 3 candidatos ordenados por puntaje, con la opción de esperar", () => {
    const ds = {
      MSFT: datos("MSFT", { fundamentales: { fecha: "2026-10-03", pe: 28, crecimientoIngresos: 15, margenNeto: 35 }, peProm5a: { valor: 32, fecha: "2026-10-03" } }),
      KO: datos("KO"),
      AAPL: datos("AAPL", { fundamentales: { fecha: "2026-10-03", pe: 40, crecimientoIngresos: 2, margenNeto: 10 }, peProm5a: { valor: 30, fecha: "2026-10-03" } }),
      NVDA: datos("NVDA", { fundamentales: { fecha: "2026-10-03", pe: 30, crecimientoIngresos: 60, margenNeto: 50 }, peProm5a: { valor: 50, fecha: "2026-10-03" } }),
    };
    const resultado = evaluarCandidatos(estado({ datos: ds, activos: ["MSFT", "KO", "AAPL", "NVDA"].map((t) => activo(t)) }));
    expect(resultado.candidatos).toHaveLength(3);
    expect(resultado.candidatos.map((c) => c.ticker)).toEqual(["NVDA", "MSFT", "KO"]);
    expect(resultado.excluidos).toEqual([expect.objectContaining({ ticker: "AAPL", motivo: "puntaje_bajo" })]);
    expect(resultado.opcionEsperar.accion).toBe("esperar_o_sumar_a_voo");
    expect(resultado.opcionEsperar.motivo.length).toBeGreaterThan(0);
  });

  it("cada candidato trae la ficha completa y la suma de los aportes da el puntaje", () => {
    const resultado = evaluarCandidatos(estado());
    for (const candidato of resultado.candidatos) {
      expect(candidato.componentes.map((fila) => fila.criterio)).toEqual(["valuacion", "momento", "calidad", "noticias", "riesgo"]);
      for (const fila of candidato.componentes) {
        expect(fila.dato.length).toBeGreaterThan(0);
        expect(fila.referencia.length).toBeGreaterThan(0);
        expect(fila.fuente.length).toBeGreaterThan(0);
        expect(fila.enCriollo.length).toBeGreaterThan(0);
        if (!fila.sinDato) expect(fila.fecha).not.toBeNull();
      }
      const suma = candidato.componentes.reduce((total, fila) => total + (fila.aporte ?? 0), 0);
      expect(suma).toBeCloseTo(candidato.puntaje, 1);
      expect(candidato.noticias.length).toBeGreaterThan(0);
    }
  });

  it("sin dato de valuación el peso se reparte entre los otros componentes", () => {
    const sinPe = datos("ETF", { fundamentales: null, peProm5a: null });
    const resultado = evaluarCandidatos(estado({ datos: { ETF: sinPe }, activos: [activo("ETF")] }));
    const ficha = resultado.candidatos[0];
    const valuacion = ficha.componentes.find((fila) => fila.criterio === "valuacion")!;
    expect(valuacion.sinDato).toBe(true);
    expect(valuacion.aporte).toBeNull();
    const pesos = ficha.componentes.filter((fila) => fila.aporte !== null).reduce((total, fila) => total + fila.pesoEfectivo, 0);
    expect(pesos).toBeCloseTo(100, 0);
    expect(ficha.porQueNo.join(" ")).toContain("Sin dato de valuación");
  });

  it("el riesgo se marca pero no suma ni resta", () => {
    const base = evaluarCandidatos(estado({ datos: { MSFT: datos("MSFT") }, activos: [activo("MSFT")] })).candidatos[0];
    const conBalance = evaluarCandidatos(estado({ datos: { MSFT: datos("MSFT", { proximoBalance: "2026-10-12" }) }, activos: [activo("MSFT")] })).candidatos[0];
    const riesgo = conBalance.componentes.find((fila) => fila.criterio === "riesgo")!;
    expect(riesgo.marcado).toBe(true);
    expect(riesgo.aporte).toBeNull();
    expect(conBalance.puntaje).toBe(base.puntaje);
    expect(conBalance.balanceEnDias).toBe(7);
  });

  it("excluye por balance en menos de 3 días, por precio viejo y explica cada motivo", () => {
    const ds = {
      MSFT: datos("MSFT", { proximoBalance: "2026-10-07" }),
      KO: datos("KO", { precio: { valor: 60, fecha: "2026-09-20", fuente: "Alpaca" }, indicadores: { fecha: "2026-09-20", cierre: 60, sma200: 60, distanciaMax52s: -5, volatilidad20: 15 } }),
      AAPL: datos("AAPL"),
    };
    const resultado = evaluarCandidatos(estado({ datos: ds }));
    expect(resultado.candidatos.map((c) => c.ticker)).toEqual(["AAPL"]);
    const motivos = Object.fromEntries(resultado.excluidos.map((e) => [e.ticker, e.motivo]));
    expect(motivos).toEqual({ MSFT: "balance", KO: "sin_precio" });
    for (const excluido of resultado.excluidos) {
      expect(excluido.detalle.length).toBeGreaterThan(0);
      expect(excluido.queCambiaria.length).toBeGreaterThan(0);
    }
    expect(resultado.advertencias.join(" ")).toContain("menos de 2");
  });

  it("no sugiere sumar a un ticker que quedaría con más de 50% del bolsillo", () => {
    const activos = [activo("MSFT", { valorPosicionUsd: 300 }), activo("KO", { valorPosicionUsd: 40 }), activo("AAPL")];
    const resultado = evaluarCandidatos(estado({ saldoAprenderUsd: 120, activos, datos: { MSFT: datos("MSFT"), KO: datos("KO"), AAPL: datos("AAPL") } }));
    const msft = resultado.excluidos.find((e) => e.ticker === "MSFT");
    expect(msft?.motivo).toBe("concentracion");
    expect(msft?.detalle).toContain("65%");
    // KO: (40 + 120) / 460 = 35%: puede sumar
    expect(resultado.candidatos.map((c) => c.ticker).sort()).toEqual(["AAPL", "KO"]);
  });

  it("excluye si sumar el saldo supera el 50% aunque hoy esté debajo", () => {
    const activos = [activo("MSFT", { valorPosicionUsd: 130 }), activo("KO", { valorPosicionUsd: 100 })];
    const resultado = evaluarCandidatos(estado({ saldoAprenderUsd: 120, activos, datos: { MSFT: datos("MSFT"), KO: datos("KO") } }));
    // MSFT: 130/350 = 37% hoy, (130+120)/350 = 71% después
    expect(resultado.excluidos.find((e) => e.ticker === "MSFT")?.motivo).toBe("concentracion");
  });

  it("en un empate ordena por ticker y el resultado es siempre el mismo", () => {
    const resultado = evaluarCandidatos(estado({}, ["MSFT", "KO", "AAPL"]));
    expect(resultado.candidatos.map((c) => c.puntaje)).toEqual([resultado.candidatos[0].puntaje, resultado.candidatos[0].puntaje, resultado.candidatos[0].puntaje]);
    expect(resultado.candidatos.map((c) => c.ticker)).toEqual(["AAPL", "KO", "MSFT"]);
  });

  it("informa toma de ganancia y revisión de tesis con las reglas de sugerencias.ts", () => {
    const activos = [activo("MSFT", { tomaGananciaPct: 30, gananciaPct: 35, valorPosicionUsd: 10 }), activo("KO", { stopRevisionPct: 20, gananciaPct: -25, valorPosicionUsd: 10 })];
    const resultado = evaluarCandidatos(estado({ saldoAprenderUsd: 5, activos, datos: {} }));
    expect(resultado.alertas.map((a) => a.tipo).sort()).toEqual(["objetivo_ganancia", "revisar_tesis"]);
    expect(resultado.candidatos).toEqual([]);
  });

  it("agrega el puntaje de VOO para comparar con los mismos criterios", () => {
    const resultado = evaluarCandidatos(estado());
    expect(resultado.voo?.componentes).toHaveLength(5);
    expect(resultado.voo?.componentes.find((fila) => fila.criterio === "valuacion")?.sinDato).toBe(true);
  });

  it("el historial del criterio avisa si hay menos de 30 casos", () => {
    const resultado = evaluarCandidatos(estado({ historial: { valuacion: { casos: 10, aciertos: 6 }, momento: { casos: 40, aciertos: 25 } } }));
    const fichas = resultado.candidatos[0].componentes;
    expect(fichas.find((fila) => fila.criterio === "valuacion")?.historial).toEqual({ casos: 10, aciertos: 6, pocosCasos: true });
    expect(fichas.find((fila) => fila.criterio === "momento")?.historial?.pocosCasos).toBe(false);
  });

  it("nada de lo que devuelve sugiere vender VOO ni tocar emergencia o gastos", () => {
    const resultado = evaluarCandidatos(estado());
    const texto = JSON.stringify(resultado).toLowerCase();
    expect(texto).not.toMatch(/vend(er|é|a)\b.*voo|emergencia|gastos|largo plazo/);
    expect(resultado.opcionEsperar.accion).toBe("esperar_o_sumar_a_voo");
  });

  it("explicarTicker distingue sugerido, excluido y fuera de la lista", () => {
    const resultado = evaluarCandidatos(estado({ datos: { MSFT: datos("MSFT", { proximoBalance: "2026-10-06" }), KO: datos("KO") }, activos: [activo("MSFT"), activo("KO")] }));
    expect(explicarTicker(resultado, "ko").estado).toBe("sugerido");
    expect(explicarTicker(resultado, "MSFT").estado).toBe("excluido");
    expect(explicarTicker(resultado, "NVDA").estado).toBe("no_esta");
  });
});
