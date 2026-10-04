import { describe, expect, it } from "vitest";
import { temaPorPalabrasClave } from "./temas";

describe("temaPorPalabrasClave", () => {
  it("asigna los 7 temas con titulares reales de Alpaca/Benzinga", () => {
    expect(temaPorPalabrasClave("Fed Hike Odds Collapse to 16% on Prediction Markets After Soft Jobs Report")).toBe("fed");
    expect(temaPorPalabrasClave("Chicago Fed President Austan Goolsbee Says Rate Hike Or Pause On The Table")).toBe("fed");
    expect(temaPorPalabrasClave("US CPI Rises More Than Expected As Inflation Reaccelerates")).toBe("inflacion");
    expect(temaPorPalabrasClave("Crude Oil Down Over 1%; US Factory Orders Edge Higher In August")).toBe("petroleo");
    expect(temaPorPalabrasClave("China demands copper supply commitments for Anglo Teck merger approval")).toBe("china");
    expect(temaPorPalabrasClave("Ceasefire talks stall as missiles hit Kyiv overnight")).toBe("guerra");
    expect(temaPorPalabrasClave("Senate races tighten ahead of the November election")).toBe("elecciones_eeuu");
    expect(temaPorPalabrasClave("Milei announces new measures for Argentina's economy")).toBe("argentina");
  });

  it("no asigna tema a titulares sin relación", () => {
    expect(temaPorPalabrasClave("72% Of Americans Are Doing This With Their Money")).toBeNull();
    expect(temaPorPalabrasClave("This Week in TSLA: Elon Musk Trims Optimus Memory")).toBeNull();
  });

  it("descarta notas de analistas sobre una empresa aunque nombren un tema", () => {
    expect(temaPorPalabrasClave("Truist Securities Maintains Buy on Magnolia Oil & Gas, Raises Price Target to $35")).toBeNull();
  });

  it("no confunde palabras que contienen la clave (fed dentro de 'federated')", () => {
    expect(temaPorPalabrasClave("Federated Hermes reports quarterly flows")).toBeNull();
  });
});
