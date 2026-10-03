import { describe, expect, it } from "vitest";
import { hayErrores } from "./recoleccion";
import { resumirMacro, ultimaEjecucionPorTarea, variacionDelDia } from "./panel";

describe("variacionDelDia", () => {
  const fila = { fecha: "2026-10-02", cierre: 100, cierre_anterior: 98 };

  it("durante la rueda siguiente al último cierre calculado, compara contra ese cierre", () => {
    // 5/10/2026 es lunes: los indicadores todavía son del viernes 2/10.
    expect(variacionDelDia({ valor: 103, ts: "2026-10-05T15:00:00Z" }, fila)).toBe(3);
  });

  it("si los indicadores ya incluyen la rueda de hoy, compara contra el cierre anterior", () => {
    expect(variacionDelDia({ valor: 100, ts: "2026-10-02T19:50:00Z" }, fila)).toBe(2.04);
  });

  it("un precio más viejo que los indicadores no tiene variación", () => {
    expect(variacionDelDia({ valor: 100, ts: "2026-10-01T15:00:00Z" }, fila)).toBeNull();
  });

  it("sin cierre anterior devuelve null", () => {
    expect(variacionDelDia({ valor: 100, ts: "2026-10-02T15:00:00Z" }, { ...fila, cierre_anterior: null })).toBeNull();
  });
});

describe("resumirMacro", () => {
  it("el VIX se muestra con variación porcentual contra la observación anterior", () => {
    const fila = resumirMacro("VIXCLS", [
      { fecha: "2026-10-02", valor: 22 },
      { fecha: "2026-10-01", valor: 20 },
    ]);
    expect(fila).toMatchObject({ valor: 22, variacion: 10, tipoVariacion: "pct" });
  });

  it("la tasa de la Fed se muestra con diferencia en puntos", () => {
    const fila = resumirMacro("DFF", [
      { fecha: "2026-10-02", valor: 4.33 },
      { fecha: "2026-10-01", valor: 4.58 },
    ]);
    expect(fila).toMatchObject({ variacion: -0.25, tipoVariacion: "pp" });
  });

  it("el CPI se muestra como inflación interanual", () => {
    const filas = Array.from({ length: 14 }, (_, i) => {
      const fecha = new Date(Date.UTC(2026, 8 - i, 1)).toISOString().slice(0, 10); // septiembre 2026 hacia atrás
      return { fecha, valor: i === 0 ? 309 : i === 12 ? 300 : 305 };
    });
    expect(resumirMacro("CPIAUCSL", filas)).toMatchObject({ variacion: 3, tipoVariacion: "interanual" });
  });

  it("una serie desconocida o vacía devuelve null", () => {
    expect(resumirMacro("XXX", [{ fecha: "2026-10-02", valor: 1 }])).toBeNull();
    expect(resumirMacro("VIXCLS", [])).toBeNull();
  });
});

describe("ultimaEjecucionPorTarea", () => {
  it("se queda con la más nueva de cada tarea", () => {
    const resultado = ultimaEjecucionPorTarea([
      { tarea: "monitor", ts: "2026-10-05T15:00:00Z", ok: true, error: null },
      { tarea: "noticias", ts: "2026-10-05T14:30:00Z", ok: false, error: "GDELT caído" },
      { tarea: "monitor", ts: "2026-10-05T14:45:00Z", ok: false, error: "viejo" },
    ]);
    expect(resultado.map((fila) => [fila.tarea, fila.ok])).toEqual([["monitor", true], ["noticias", false]]);
  });
});

describe("hayErrores", () => {
  it("detecta errores anidados de fuentes, de la IA y de bloques enteros", () => {
    expect(hayErrores({ recoleccion: { errores: [{ fuente: "gdelt", error: "x" }] } })).toBe(true);
    expect(hayErrores({ resumen: { estado: "error", error: "Gemini falló" } })).toBe(true);
    expect(hayErrores({ macro: { error: "FRED caído" } })).toBe(true);
  });
  it("sin presupuesto o sin pendientes no son errores", () => {
    expect(hayErrores({ recoleccion: { errores: [], nuevas: 3 }, resumen: { estado: "sin_presupuesto" } })).toBe(false);
  });
});
