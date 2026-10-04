import { describe, expect, it } from "vitest";
import { calcularSerie, eventosDeHoy, eventosEnIndice, estudiarEventos, MIN_CASOS, rsiSerie, smaSerie } from "./eventos";
import { media, rsi, type Barra } from "./indicadores";

// Serie pseudoaleatoria reproducible (sin Math.random, para que el test sea determinístico).
function caminata(n: number, semilla = 7, inicio = 100): number[] {
  let estado = semilla;
  const siguiente = () => {
    estado = (estado * 1_103_515_245 + 12_345) % 2_147_483_648;
    return estado / 2_147_483_648;
  };
  const cierres = [inicio];
  for (let i = 1; i < n; i++) cierres.push(Math.max(1, cierres[i - 1] * (1 + (siguiente() - 0.5) * 0.04)));
  return cierres;
}

function barras(cierres: number[]): Barra[] {
  return cierres.map((cierre, i) => ({ fecha: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), cierre, volumen: 1_000 }));
}

describe("series incrementales", () => {
  it("rsiSerie coincide en cada rueda con el RSI calculado solo con los datos hasta esa rueda", () => {
    const cierres = caminata(120);
    const serie = rsiSerie(cierres);
    for (const i of [14, 15, 40, 77, 119]) {
      expect(serie[i]).toBeCloseTo(rsi(cierres.slice(0, i + 1), 14)!, 9);
    }
    expect(serie[13]).toBeNull();
  });

  it("smaSerie coincide con el promedio de las últimas n ruedas", () => {
    const cierres = caminata(60);
    const serie = smaSerie(cierres, 20);
    expect(serie[18]).toBeNull();
    expect(serie[19]).toBeCloseTo(media(cierres.slice(0, 20), 20)!, 9);
    expect(serie[59]).toBeCloseTo(media(cierres, 20)!, 9);
  });
});

describe("eventosEnIndice", () => {
  it("detecta una suba y una caída de 3% o más con su fecha", () => {
    const cierres = [100, 100, 104, 104, 100, 100];
    const serie = calcularSerie(barras(cierres));
    expect(eventosEnIndice(serie, 2)).toContain("suba_fuerte");
    expect(eventosEnIndice(serie, 4)).toContain("caida_fuerte");
    expect(eventosEnIndice(serie, 3)).toEqual([]);
  });

  it("un nuevo máximo de 52 semanas necesita 252 ruedas de historia y superar a todas", () => {
    const cierres = [...Array.from({ length: 300 }, () => 100), 101];
    const serie = calcularSerie(barras(cierres));
    expect(eventosEnIndice(serie, 300)).toContain("maximo_52s");
    expect(eventosEnIndice(calcularSerie(barras(cierres.slice(0, 100).concat(101))), 100)).not.toContain("maximo_52s");
  });

  it("cruce de la media de 200 días: arriba cuando pasa de estar debajo a encima", () => {
    const cierres = [...Array.from({ length: 220 }, () => 100), 90, 110];
    const serie = calcularSerie(barras(cierres));
    expect(eventosEnIndice(serie, 221)).toContain("cruce_sma200_arriba");
    expect(eventosEnIndice(serie, 220)).toContain("cruce_sma200_abajo");
  });

  it("NO MIRA EL FUTURO: los eventos de una rueda son los mismos con la serie cortada ahí o completa", () => {
    const completa = caminata(700, 11);
    const serieCompleta = calcularSerie(barras(completa));
    for (const i of [30, 120, 260, 400, 555, 640]) {
      const serieCortada = calcularSerie(barras(completa.slice(0, i + 1)));
      expect(eventosEnIndice(serieCortada, i)).toEqual(eventosEnIndice(serieCompleta, i));
    }
  });
});

describe("eventosDeHoy", () => {
  it("devuelve la fecha y los eventos de la última rueda", () => {
    const resultado = eventosDeHoy(barras([100, 100, 100, 105]));
    expect(resultado).toEqual({ fecha: "2020-01-04", eventos: ["suba_fuerte"] });
  });
  it("con una sola rueda no hay nada", () => {
    expect(eventosDeHoy(barras([100]))).toBeNull();
  });
});

describe("estudiarEventos", () => {
  it("mide el retorno posterior desde el cierre del día del evento, con media, mediana y % positivo", () => {
    // Suba fuerte en la rueda 2 (100 -> 104). Siguiente rueda: 104 -> 106.08 (+2%). A 5 ruedas: 104 -> 109.2 (+5%).
    const cierres = [100, 100, 104, 106.08, 106.08, 106.08, 106.08, 109.2, 109.2];
    const { filas } = estudiarEventos({ AAA: barras(cierres) });
    const a1 = filas.find((fila) => fila.evento === "suba_fuerte" && fila.ticker === "AAA" && fila.horizonte === 1)!;
    const a5 = filas.find((fila) => fila.evento === "suba_fuerte" && fila.ticker === "AAA" && fila.horizonte === 5)!;
    expect(a1).toMatchObject({ n: 1, media: 2, mediana: 2, pctPositivo: 100 });
    expect(a5).toMatchObject({ n: 1, media: 5, pctPositivo: 100 });
    // A 20 ruedas todavía no pasó: no hay fila.
    expect(filas.some((fila) => fila.evento === "suba_fuerte" && fila.horizonte === 20)).toBe(false);
  });

  it("agrega todo el universo en ticker '*' y compara contra el retorno de cualquier día", () => {
    const a = [100, 100, 104, 104, 104, 104, 104];
    const b = [50, 50, 52, 52, 52, 52, 52];
    const { filas, desde, hasta } = estudiarEventos({ AAA: barras(a), BBB: barras(b) });
    const todos = filas.find((fila) => fila.evento === "suba_fuerte" && fila.ticker === "*" && fila.horizonte === 1)!;
    expect(todos.n).toBe(2);
    expect(todos.media).toBe(0); // después de la suba no se movió
    // Retornos a 1 rueda de cualquier día de cada serie: +4, 0, 0, 0, 0 => base 0,8.
    expect(todos.mediaBase).toBe(0.8);
    expect(desde).toBe("2020-01-01");
    expect(hasta).toBe("2020-01-07");
  });

  it("la mediana de varios casos y el porcentaje de veces que subió", () => {
    // Tres subas fuertes (+4%); el día siguiente rinde +1%, -1% y +2%.
    const cierres = [100, 100, 104, 105.04, 100, 100, 104, 102.96, 100, 100, 104, 106.08, 106.08];
    const { filas } = estudiarEventos({ AAA: barras(cierres) });
    const fila = filas.find((x) => x.evento === "suba_fuerte" && x.ticker === "AAA" && x.horizonte === 1)!;
    expect(fila.n).toBe(3);
    expect(fila.mediana).toBe(1);
    expect(fila.pctPositivo).toBeCloseTo(66.67, 1);
    expect(fila.media).toBeCloseTo((1 - 1 + 2) / 3, 1);
  });

  it("sin datos devuelve vacío", () => {
    expect(estudiarEventos({})).toEqual({ filas: [], desde: null, hasta: null });
  });

  it("el mínimo de casos para usar una estadística es 20", () => {
    expect(MIN_CASOS).toBe(20);
  });
});
