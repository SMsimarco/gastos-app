import { describe, expect, it } from "vitest";
import { PESOS_DEFAULT } from "./aprender";
import { calcularHistorialCriterios, descripcionPropuesta, fechaDeMedicion, lineaDiarioAprendizaje, proponerCambioPesos, rendimientoPct, type ResultadoMedido } from "./aprenderHistorial";

function caso(aportes: ResultadoMedido["aportes"], ganoAVoo: boolean, semanas = 4): ResultadoMedido {
  return { ticker: "MSFT", semanas, ganoAVoo, aportes };
}

describe("historial de criterios", () => {
  it("rendimiento y fecha de medición", () => {
    expect(rendimientoPct(100, 108.5)).toBe(8.5);
    expect(rendimientoPct(0, 5)).toBe(0);
    expect(fechaDeMedicion("2026-10-05", 4)).toBe("2026-11-02");
    expect(fechaDeMedicion("2026-10-05", 12)).toBe("2026-12-28");
  });

  it("cuenta solo los casos donde el criterio sumó y cuántos le ganaron a VOO", () => {
    const historial = calcularHistorialCriterios([
      caso({ valuacion: 10, momento: -5 }, true),
      caso({ valuacion: 8, momento: 3 }, false),
      caso({ valuacion: -2, momento: 6 }, true),
      caso({ valuacion: 9 }, true, 1), // otro horizonte: no cuenta
    ]);
    expect(historial.valuacion).toEqual({ casos: 2, aciertos: 1 });
    expect(historial.momento).toEqual({ casos: 2, aciertos: 1 });
    expect(historial.calidad).toBeUndefined();
  });
});

describe("propuesta de pesos", () => {
  it("no propone nada con menos de 30 casos", () => {
    expect(proponerCambioPesos(PESOS_DEFAULT, { valuacion: { casos: 29, aciertos: 25 }, momento: { casos: 29, aciertos: 5 } })).toBeNull();
  });

  it("no propone nada si ningún criterio se aparta claramente del promedio", () => {
    expect(proponerCambioPesos(PESOS_DEFAULT, { valuacion: { casos: 30, aciertos: 16 }, momento: { casos: 30, aciertos: 14 } })).toBeNull();
  });

  it("mueve 5 puntos del criterio que falló al que más acertó y los pesos siguen sumando 100", () => {
    const propuesta = proponerCambioPesos(PESOS_DEFAULT, {
      valuacion: { casos: 40, aciertos: 30 }, // 75%
      momento: { casos: 40, aciertos: 10 }, // 25%
      calidad: { casos: 40, aciertos: 20 }, // 50%
    })!;
    expect(propuesta.pesosPropuestos).toEqual({ valuacion: 35, momento: 20, calidad: 25, noticias: 20 });
    expect(Object.values(propuesta.pesosPropuestos).reduce((a, b) => a + b, 0)).toBe(100);
    expect(propuesta.evidencia.find((fila) => fila.criterio === "valuacion")?.veredicto).toBe("acerto_mas");
    expect(descripcionPropuesta(PESOS_DEFAULT, propuesta)).toContain("valuación de 30 a 35");
  });

  it("si solo uno acertó más, saca el peso del criterio de mayor peso que sigue siendo normal", () => {
    const propuesta = proponerCambioPesos(PESOS_DEFAULT, { valuacion: { casos: 40, aciertos: 32 }, momento: { casos: 40, aciertos: 16 }, calidad: { casos: 40, aciertos: 16 } })!;
    expect(Object.values(propuesta.pesosPropuestos).reduce((a, b) => a + b, 0)).toBe(100);
    expect(propuesta.pesosPropuestos.valuacion).toBe(35);
  });

  it("nunca baja un peso por debajo de 5", () => {
    const propuesta = proponerCambioPesos({ valuacion: 10, momento: 5, calidad: 5, noticias: 80 }, { valuacion: { casos: 40, aciertos: 38 }, momento: { casos: 40, aciertos: 2 }, calidad: { casos: 40, aciertos: 20 } });
    expect(propuesta).toBeNull();
  });
});

describe("diario del domingo", () => {
  it("resume lo medido en la semana y avisa si son pocos casos", () => {
    const linea = lineaDiarioAprendizaje([
      { ticker: "MSFT", semanas: 4, rendimientoPct: 5, vooPct: 2, ganoAVoo: true },
      { ticker: "NVDA", semanas: 4, rendimientoPct: -3, vooPct: 2, ganoAVoo: false },
    ])!;
    expect(linea).toContain("medí 2 sugerencias: 1 le ganó a VOO");
    expect(linea).toContain("NVDA a 4 semanas: −3% contra +2% de VOO");
    expect(linea).toContain("puede ser suerte");
  });
  it("sin mediciones no hay línea", () => {
    expect(lineaDiarioAprendizaje([])).toBeNull();
  });
});

import { medicionesPendientes, precioAlCierre } from "./aprenderHistorial";

describe("mediciones contra VOO", () => {
  const serie = (puntos: Array<[string, number]>) => puntos.map(([fecha, precio]) => ({ fecha, precio }));

  it("precioAlCierre toma el último cierre hasta la fecha y respeta la tolerancia", () => {
    const datos = serie([["2026-10-30", 100], ["2026-11-02", 110]]);
    expect(precioAlCierre(datos, "2026-11-01")?.precio).toBe(100); // fin de semana
    expect(precioAlCierre(datos, "2026-11-02")?.precio).toBe(110);
    expect(precioAlCierre(datos, "2026-11-20")).toBeNull(); // dato demasiado viejo
    expect(precioAlCierre(datos, "2026-10-01")).toBeNull();
  });

  const sugerencia = { id: "s1", fecha: "2026-10-05", vooPrecio: 500, candidatos: [{ ticker: "MSFT", precio: 400, aportes: { valuacion: 10 } }, { ticker: "KO", precio: 60, aportes: { calidad: 5 } }] };
  const cierres = {
    VOO: serie([["2026-10-12", 505], ["2026-11-02", 520]]),
    MSFT: serie([["2026-10-12", 412], ["2026-11-02", 396]]),
    KO: serie([["2026-10-12", 60], ["2026-11-02", 63]]),
  };

  it("mide a 1 y 4 semanas lo que ya se cumplió, lo haya comprado o no, y compara con VOO", () => {
    const filas = medicionesPendientes({ hoy: "2026-11-03", sugerencias: [sugerencia], yaMedidas: new Set(), cierres });
    expect(filas.map((fila) => `${fila.ticker}${fila.semanas}`).sort()).toEqual(["KO1", "KO4", "MSFT1", "MSFT4"]);
    const msft1 = filas.find((fila) => fila.ticker === "MSFT" && fila.semanas === 1)!;
    expect(msft1.rendimientoPct).toBe(3); // 400 -> 412
    expect(msft1.vooPct).toBe(1); // 500 -> 505
    expect(msft1.ganoAVoo).toBe(true);
    const msft4 = filas.find((fila) => fila.ticker === "MSFT" && fila.semanas === 4)!;
    expect(msft4.rendimientoPct).toBe(-1);
    expect(msft4.ganoAVoo).toBe(false);
    expect(msft4.aportes).toEqual({ valuacion: 10 });
  });

  it("no repite lo ya medido ni mide lo que todavía no se cumplió", () => {
    const yaMedidas = new Set(["s1|MSFT|1", "s1|KO|1"]);
    const filas = medicionesPendientes({ hoy: "2026-11-03", sugerencias: [sugerencia], yaMedidas, cierres });
    expect(filas.every((fila) => fila.semanas === 4)).toBe(true);
    expect(medicionesPendientes({ hoy: "2026-10-10", sugerencias: [sugerencia], yaMedidas: new Set(), cierres })).toEqual([]);
  });

  it("sin precio de VOO o sin precio inicial no mide", () => {
    expect(medicionesPendientes({ hoy: "2026-11-03", sugerencias: [{ ...sugerencia, vooPrecio: null }], yaMedidas: new Set(), cierres })).toEqual([]);
    expect(medicionesPendientes({ hoy: "2026-11-03", sugerencias: [{ ...sugerencia, candidatos: [{ ticker: "MSFT", precio: null, aportes: {} }] }], yaMedidas: new Set(), cierres })).toEqual([]);
  });
});
