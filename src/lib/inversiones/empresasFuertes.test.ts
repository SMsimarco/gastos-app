import { describe, expect, it } from "vitest";
import { DISCLAIMER_FINANCIERO } from "./avisos";
import { evaluarEmpresasFuertes, textoAlertaFuerte, textoAlertaVoo, textoResumenFuertes, umbralFuerte, type Observacion } from "./empresasFuertes";
import { validarTextoAprender } from "./aprenderTextos";
import { caidaDesdeMaximoPct, UMBRAL_VOO_BAJO_MAXIMO_PCT } from "./sugerencias";

function obs(ticker: string, variacionDia: number | null, cambios: Partial<Observacion> = {}): Observacion {
  return { ticker, fecha: "2026-10-05", variacionDia, variacionMes: 3, distanciaMax52s: -5, balanceEnDias: null, titular: null, ...cambios };
}

const TEXTOS_SIN_ESPERAR = { exigirEsperar: false, maxLargo: 1500 };

describe("evaluarEmpresasFuertes", () => {
  it("destaca solo las 3 que más se movieron, para arriba o para abajo, de mayor a menor", () => {
    const evaluacion = evaluarEmpresasFuertes([obs("MSFT", 2.5), obs("NVDA", -6.1), obs("KO", 0.4), obs("META", 3.2), obs("AMZN", -2.2), obs("VOO", 0.5)]);
    expect(evaluacion.destacadas.map((item) => item.ticker)).toEqual(["NVDA", "META", "MSFT"]);
    expect(evaluacion.voo?.ticker).toBe("VOO");
    expect(evaluacion.tranquilo).toBe(false);
  });

  it("si ninguna se movió 2% o más es un día tranquilo (VOO no cuenta como empresa)", () => {
    const evaluacion = evaluarEmpresasFuertes([obs("MSFT", 1.9), obs("KO", -0.3), obs("VOO", 4)]);
    expect(evaluacion.tranquilo).toBe(true);
    expect(evaluacion.destacadas).toEqual([]);
    expect(evaluacion.alertasFuertes).toEqual([]);
  });

  it("umbral de alerta fuerte: 5% para las grandes y 8% para YPF y VIST", () => {
    expect(umbralFuerte("MSFT")).toBe(5);
    expect(umbralFuerte("YPF")).toBe(8);
    expect(umbralFuerte("VIST")).toBe(8);
    const evaluacion = evaluarEmpresasFuertes([obs("MSFT", 5), obs("NVDA", -4.9), obs("YPF", 7.9), obs("VIST", -8.5), obs("KO", 5.1)]);
    expect(evaluacion.alertasFuertes.map((item) => item.ticker).sort()).toEqual(["KO", "MSFT", "VIST"]);
  });

  it("ignora los tickers sin variación y no falla sin datos", () => {
    expect(evaluarEmpresasFuertes([obs("MSFT", null)]).tranquilo).toBe(true);
    const vacio = evaluarEmpresasFuertes([]);
    expect(vacio.fecha).toBeNull();
    expect(vacio.voo).toBeNull();
  });

  it("en un empate ordena por ticker", () => {
    expect(evaluarEmpresasFuertes([obs("MSFT", 3), obs("AAPL", -3)]).destacadas.map((item) => item.ticker)).toEqual(["AAPL", "MSFT"]);
  });
});

describe("textos", () => {
  it("día tranquilo: una línea más el descargo, con VOO", () => {
    const texto = textoResumenFuertes(evaluarEmpresasFuertes([obs("MSFT", 1), obs("VOO", 0.3)]));
    expect(texto.split("\n")).toEqual(["Día tranquilo: ninguna de tus empresas se movió más de 2% (VOO +0,3%).", DISCLAIMER_FINANCIERO]);
  });

  it("resumen con movimientos: las 3 empresas, VOO, noticia, balance cercano y descargo, en criollo", () => {
    const texto = textoResumenFuertes(evaluarEmpresasFuertes([
      obs("NVDA", 6.1, { variacionMes: 12, distanciaMax52s: -3, titular: { texto: "Nueva línea de chips", fuente: "Alpaca" }, balanceEnDias: 4 }),
      obs("META", -3.2),
      obs("MSFT", 2.4),
      obs("KO", 0.1),
      obs("VOO", -0.4),
    ]));
    expect(texto).toContain("NVDA (Nvidia) subió 6,1% en el día; subió 12% en el mes; está 3% abajo de su máximo del año; presenta balance en 4 días");
    expect(texto).toContain("Noticia: Nueva línea de chips (Alpaca)");
    expect(texto).toContain("META (Meta) bajó 3,2% en el día");
    expect(texto).toContain("VOO bajó 0,4% en el día.");
    expect(texto).not.toContain("KO");
    expect(texto.trimEnd().endsWith(DISCLAIMER_FINANCIERO)).toBe(true);
    expect(validarTextoAprender(texto, TEXTOS_SIN_ESPERAR)).toEqual([]);
  });

  it("la alerta fuerte informa y deja la decisión al usuario, sin decir comprar ni vender", () => {
    const texto = textoAlertaFuerte(obs("YPF", -9.3, { variacionMes: -15, distanciaMax52s: -25 }));
    expect(texto).toContain("YPF se movió fuerte: bajó 9,3% en el día");
    expect(texto).toContain("esperar también es una opción");
    expect(texto).not.toMatch(/\b(vend[eé]|compr[aá])\b/i);
    expect(validarTextoAprender(texto, TEXTOS_SIN_ESPERAR)).toEqual([]);
  });

  it("el aviso de VOO habla de oportunidad de compra de largo plazo y nunca de vender", () => {
    const texto = textoAlertaVoo(11.2);
    expect(texto).toContain("VOO está 11% abajo de su máximo de 52 semanas");
    expect(texto).toContain("nunca es una señal para vender");
    expect(validarTextoAprender(texto, TEXTOS_SIN_ESPERAR)).toEqual([]);
  });
});

describe("regla de VOO de la Fase 4 reutilizada", () => {
  it("cae 10% o más desde el máximo de 52 semanas", () => {
    expect(UMBRAL_VOO_BAJO_MAXIMO_PCT).toBe(10);
    expect(caidaDesdeMaximoPct(630, 700)).toBe(10);
    expect(caidaDesdeMaximoPct(700, 700)).toBe(0);
    expect(caidaDesdeMaximoPct(500, 0)).toBe(0);
  });
});
