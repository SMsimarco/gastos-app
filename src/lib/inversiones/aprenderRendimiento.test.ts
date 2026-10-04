import { describe, expect, it } from "vitest";
import { compararConVoo } from "./aprenderRendimiento";

const voo = [
  { fecha: "2026-08-03", precio: 500 },
  { fecha: "2026-09-01", precio: 520 },
];

describe("aprender contra VOO", () => {
  it("compara lo ganado con lo que habría ganado poniendo lo mismo en VOO el mismo día", () => {
    // Compró US$100 de MSFT el 3/8 (VOO a 500) y hoy vale US$110. VOO hoy 550: habría tenido 100 * 550/500 = 110.
    const resultado = compararConVoo({ flujos: [{ fecha: "2026-08-03", tipo: "compra", montoUsd: 100 }], valorActualUsd: 118, vooSerie: voo, vooActualUsd: 550 });
    expect(resultado.netoInvertidoUsd).toBe(100);
    expect(resultado.gananciaPct).toBe(18);
    expect(resultado.siVooValorUsd).toBe(110);
    expect(resultado.siVooPct).toBe(10);
    expect(resultado.diferenciaPuntos).toBe(8);
    expect(resultado.veredicto).toBe("gana");
  });

  it("dos compras en fechas distintas usan el precio de VOO de cada día", () => {
    const resultado = compararConVoo({
      flujos: [{ fecha: "2026-08-03", tipo: "compra", montoUsd: 100 }, { fecha: "2026-09-01", tipo: "compra", montoUsd: 104 }],
      valorActualUsd: 200,
      vooSerie: voo,
      vooActualUsd: 572, // 100*572/500 = 114,4 y 104*572/520 = 114,4
    });
    expect(resultado.siVooValorUsd).toBe(228.8);
    expect(resultado.veredicto).toBe("pierde");
  });

  it("los dividendos cobrados suman al resultado de aprender", () => {
    const resultado = compararConVoo({ flujos: [{ fecha: "2026-08-03", tipo: "compra", montoUsd: 100 }, { fecha: "2026-09-15", tipo: "dividendo", montoUsd: 3 }], valorActualUsd: 100, vooSerie: voo, vooActualUsd: 500 });
    expect(resultado.gananciaPct).toBe(3);
    expect(resultado.siVooPct).toBe(0);
    expect(resultado.veredicto).toBe("gana");
  });

  it("sin compras o sin precio de VOO no inventa un resultado", () => {
    expect(compararConVoo({ flujos: [], valorActualUsd: 0, vooSerie: voo, vooActualUsd: 550 }).veredicto).toBe("sin_datos");
    const sinVoo = compararConVoo({ flujos: [{ fecha: "2026-01-02", tipo: "compra", montoUsd: 100 }], valorActualUsd: 110, vooSerie: voo, vooActualUsd: 550 });
    expect(sinVoo.veredicto).toBe("sin_datos");
    expect(sinVoo.operacionesSinDatoVoo).toBe(1);
  });
});
