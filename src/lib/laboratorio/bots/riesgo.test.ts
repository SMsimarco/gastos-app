import { describe, expect, it } from "vitest";
import { aplicarRiesgo, drawdownPct, type EstadoRiesgo, type LimitesRiesgo, type Propuesta } from "./riesgo";

const limites: LimitesRiesgo = {
  universo: ["VOO", "QQQ", "NVDA", "AAPL", "KO"],
  maxPctPorPosicion: 20,
  minPctEfectivo: 10,
  maxOperacionesPorDia: 3,
  drawdownPausaPct: 25,
};

const estadoBase: EstadoRiesgo = { valorTotalUsd: 1_000, efectivoUsd: 1_000, posiciones: [], operacionesHoy: 0, picoUsd: 1_000 };

const propuesta = (parcial: Partial<Propuesta> & Pick<Propuesta, "ticker">): Propuesta => ({
  accion: "comprar",
  montoUsd: 100,
  razon: "porque sí",
  confianza: "media",
  ...parcial,
});

describe("universo", () => {
  it("descarta tickers fuera del universo y deja el motivo", () => {
    const { decisiones } = aplicarRiesgo([propuesta({ ticker: "TSLA" }), propuesta({ ticker: "nvda" })], estadoBase, limites);
    expect(decisiones[0]).toMatchObject({ ticker: "TSLA", aprobada: false, montoAprobadoUsd: 0 });
    expect(decisiones[0].ajuste).toContain("fuera del universo");
    expect(decisiones[1]).toMatchObject({ ticker: "NVDA", aprobada: true, montoAprobadoUsd: 100 });
  });
});

describe("mantener", () => {
  it("es una respuesta válida: queda aprobada sin monto ni orden", () => {
    const { decisiones } = aplicarRiesgo([propuesta({ ticker: "VOO", accion: "mantener", montoUsd: 0 })], estadoBase, limites);
    expect(decisiones[0]).toMatchObject({ aprobada: true, montoAprobadoUsd: 0, ajuste: null });
  });
  it("una lista vacía de propuestas tampoco rompe", () => {
    expect(aplicarRiesgo([], estadoBase, limites)).toEqual({ decisiones: [], pausar: null });
  });
});

describe("máximo por posición (20%)", () => {
  it("recorta una compra para no pasar el 20% del valor total", () => {
    const { decisiones } = aplicarRiesgo([propuesta({ ticker: "NVDA", montoUsd: 500 })], estadoBase, limites);
    expect(decisiones[0].montoAprobadoUsd).toBe(200);
    expect(decisiones[0].ajuste).toContain("máximo por posición 20%");
  });
  it("cuenta lo que ya tiene en esa posición", () => {
    const estado = { ...estadoBase, efectivoUsd: 850, posiciones: [{ ticker: "NVDA", valorUsd: 150 }] };
    expect(aplicarRiesgo([propuesta({ ticker: "NVDA", montoUsd: 500 })], estado, limites).decisiones[0].montoAprobadoUsd).toBe(50);
  });
  it("si ya está en el máximo, descarta la compra", () => {
    const estado = { ...estadoBase, efectivoUsd: 800, posiciones: [{ ticker: "NVDA", valorUsd: 200 }] };
    const [decision] = aplicarRiesgo([propuesta({ ticker: "NVDA" })], estado, limites).decisiones;
    expect(decision.aprobada).toBe(false);
    expect(decision.ajuste).toContain("máximo por posición");
  });
  it("dos compras del mismo ticker en la misma corrida comparten el tope", () => {
    const { decisiones } = aplicarRiesgo([propuesta({ ticker: "KO", montoUsd: 150 }), propuesta({ ticker: "KO", montoUsd: 150 })], estadoBase, limites);
    expect(decisiones[0].montoAprobadoUsd).toBe(150);
    expect(decisiones[1].montoAprobadoUsd).toBe(50);
  });
});

describe("efectivo mínimo (10%)", () => {
  it("recorta las compras para dejar al menos el 10% en efectivo", () => {
    const estado = { ...estadoBase, valorTotalUsd: 1_000, efectivoUsd: 250, posiciones: [{ ticker: "VOO", valorUsd: 750 }] };
    const { decisiones } = aplicarRiesgo([propuesta({ ticker: "KO", montoUsd: 150 })], estado, limites);
    expect(decisiones[0].montoAprobadoUsd).toBe(150); // 250 - 100 de mínimo = 150 disponibles
    const grande = aplicarRiesgo([propuesta({ ticker: "KO", montoUsd: 190 })], estado, limites).decisiones[0];
    expect(grande.montoAprobadoUsd).toBe(150);
    expect(grande.ajuste).toContain("efectivo mínimo 10%");
  });
  it("compras sucesivas van consumiendo el efectivo disponible", () => {
    const estado = { ...estadoBase, valorTotalUsd: 1_000, efectivoUsd: 300, posiciones: [{ ticker: "VOO", valorUsd: 700 }] };
    const { decisiones } = aplicarRiesgo([propuesta({ ticker: "KO", montoUsd: 150 }), propuesta({ ticker: "AAPL", montoUsd: 150 })], estado, limites);
    expect(decisiones[0].montoAprobadoUsd).toBe(150);
    expect(decisiones[1].montoAprobadoUsd).toBe(50); // 300 - 100 mínimo - 150 ya comprados
  });
  it("sin efectivo por encima del mínimo descarta la compra", () => {
    const estado = { ...estadoBase, efectivoUsd: 100, posiciones: [{ ticker: "VOO", valorUsd: 900 }] };
    const [decision] = aplicarRiesgo([propuesta({ ticker: "KO" })], estado, limites).decisiones;
    expect(decision.aprobada).toBe(false);
    expect(decision.ajuste).toContain("efectivo");
  });
});

describe("ventas", () => {
  const conPosicion = { ...estadoBase, efectivoUsd: 800, posiciones: [{ ticker: "VOO", valorUsd: 200 }] };

  it("no permite vender lo que no hay", () => {
    const [decision] = aplicarRiesgo([propuesta({ ticker: "KO", accion: "vender" })], conPosicion, limites).decisiones;
    expect(decision.aprobada).toBe(false);
    expect(decision.ajuste).toContain("no hay posición");
  });
  it("recorta una venta al valor de la posición, y vender casi todo cierra la posición completa", () => {
    const [decision] = aplicarRiesgo([propuesta({ ticker: "VOO", accion: "vender", montoUsd: 500 })], conPosicion, limites).decisiones;
    expect(decision).toMatchObject({ aprobada: true, montoAprobadoUsd: 200, ventaTotal: true });
    expect(decision.ajuste).toContain("recortada");
  });
  it("una venta parcial se aprueba tal cual", () => {
    const [decision] = aplicarRiesgo([propuesta({ ticker: "VOO", accion: "vender", montoUsd: 50 })], conPosicion, limites).decisiones;
    expect(decision).toMatchObject({ aprobada: true, montoAprobadoUsd: 50, ventaTotal: false, ajuste: null });
  });
  it("dos ventas del mismo ticker no pueden vender más que la posición", () => {
    const { decisiones } = aplicarRiesgo([propuesta({ ticker: "VOO", accion: "vender", montoUsd: 150 }), propuesta({ ticker: "VOO", accion: "vender", montoUsd: 150 })], conPosicion, limites);
    expect(decisiones[0].montoAprobadoUsd).toBeGreaterThan(0);
    expect(decisiones[0].montoAprobadoUsd + decisiones[1].montoAprobadoUsd).toBeLessThanOrEqual(200);
  });
  it("el efectivo de una venta NO se usa para comprar en la misma corrida", () => {
    const estado = { ...estadoBase, efectivoUsd: 100, posiciones: [{ ticker: "VOO", valorUsd: 900 }] };
    const { decisiones } = aplicarRiesgo([propuesta({ ticker: "VOO", accion: "vender", montoUsd: 500 }), propuesta({ ticker: "KO", montoUsd: 150 })], estado, limites);
    expect(decisiones[0].aprobada).toBe(true);
    expect(decisiones[1].aprobada).toBe(false); // sigue sin efectivo por encima del mínimo
  });
});

describe("máximo de operaciones por día", () => {
  it("corta en 3 y prioriza por confianza", () => {
    const { decisiones } = aplicarRiesgo(
      [
        propuesta({ ticker: "VOO", confianza: "baja" }),
        propuesta({ ticker: "QQQ", confianza: "alta" }),
        propuesta({ ticker: "NVDA", confianza: "media" }),
        propuesta({ ticker: "AAPL", confianza: "alta" }),
        propuesta({ ticker: "KO", confianza: "media" }),
      ],
      estadoBase,
      limites
    );
    const aprobadas = decisiones.filter((d) => d.aprobada).map((d) => d.ticker);
    expect(aprobadas.sort()).toEqual(["AAPL", "NVDA", "QQQ"]);
    expect(decisiones.find((d) => d.ticker === "VOO")?.ajuste).toContain("máximo de 3 operaciones");
    expect(decisiones.find((d) => d.ticker === "KO")?.aprobada).toBe(false);
  });
  it("descuenta las operaciones que ya hubo hoy", () => {
    const { decisiones } = aplicarRiesgo([propuesta({ ticker: "VOO" }), propuesta({ ticker: "QQQ" })], { ...estadoBase, operacionesHoy: 2 }, limites);
    expect(decisiones.filter((d) => d.aprobada)).toHaveLength(1);
    expect(aplicarRiesgo([propuesta({ ticker: "VOO" })], { ...estadoBase, operacionesHoy: 3 }, limites).decisiones[0].aprobada).toBe(false);
  });
  it("mantener no cuenta como operación", () => {
    const { decisiones } = aplicarRiesgo(
      [propuesta({ ticker: "VOO", accion: "mantener", montoUsd: 0 }), propuesta({ ticker: "QQQ", accion: "mantener", montoUsd: 0 }), propuesta({ ticker: "NVDA", accion: "mantener", montoUsd: 0 }), propuesta({ ticker: "KO" })],
      estadoBase,
      limites
    );
    expect(decisiones[3].aprobada).toBe(true);
  });
});

describe("drawdown", () => {
  it("calcula la caída desde el pico", () => {
    expect(drawdownPct(750, 1_000)).toBe(25);
    expect(drawdownPct(1_200, 1_000)).toBe(0);
    expect(drawdownPct(500, 0)).toBe(0);
  });
  it("con 25% o más de caída no aprueba compras y pausa el bot, pero deja vender", () => {
    const estado = { valorTotalUsd: 740, efectivoUsd: 340, posiciones: [{ ticker: "VOO", valorUsd: 400 }], operacionesHoy: 0, picoUsd: 1_000 };
    const resultado = aplicarRiesgo([propuesta({ ticker: "KO" }), propuesta({ ticker: "VOO", accion: "vender", montoUsd: 100 })], estado, limites);
    expect(resultado.pausar?.motivo).toContain("Drawdown");
    expect(resultado.decisiones[0].aprobada).toBe(false);
    expect(resultado.decisiones[0].ajuste).toContain("pausa por drawdown");
    expect(resultado.decisiones[1].aprobada).toBe(true);
  });
  it("con menos de 25% de caída sigue operando normal", () => {
    const estado = { valorTotalUsd: 800, efectivoUsd: 800, posiciones: [], operacionesHoy: 0, picoUsd: 1_000 };
    const resultado = aplicarRiesgo([propuesta({ ticker: "KO", montoUsd: 100 })], estado, limites);
    expect(resultado.pausar).toBeNull();
    expect(resultado.decisiones[0].aprobada).toBe(true);
  });
});

describe("montos inválidos", () => {
  it("descarta montos cero, negativos o no numéricos", () => {
    const { decisiones } = aplicarRiesgo([propuesta({ ticker: "KO", montoUsd: 0 }), propuesta({ ticker: "AAPL", montoUsd: -50 }), propuesta({ ticker: "VOO", montoUsd: Number.NaN })], estadoBase, limites);
    expect(decisiones.every((d) => !d.aprobada)).toBe(true);
  });
  it("una compra que queda en menos de US$1 después de los recortes se descarta", () => {
    const estado = { ...estadoBase, efectivoUsd: 100.5, posiciones: [{ ticker: "VOO", valorUsd: 899.5 }] };
    expect(aplicarRiesgo([propuesta({ ticker: "KO" })], estado, limites).decisiones[0].aprobada).toBe(false);
  });
});

describe("caso combinado", () => {
  it("aplica universo, operaciones, ventas, posición y efectivo juntos, y cada recorte deja su motivo", () => {
    const estado: EstadoRiesgo = { valorTotalUsd: 1_000, efectivoUsd: 300, posiciones: [{ ticker: "VOO", valorUsd: 400 }, { ticker: "KO", valorUsd: 300 }], operacionesHoy: 0, picoUsd: 1_100 };
    const { decisiones, pausar } = aplicarRiesgo(
      [
        propuesta({ ticker: "TSLA", confianza: "alta" }), // fuera del universo
        propuesta({ ticker: "KO", accion: "vender", montoUsd: 400, confianza: "alta" }), // recortada y cierra la posición
        propuesta({ ticker: "NVDA", montoUsd: 400, confianza: "alta" }), // recortada por posición (200) y por efectivo (200 disponibles)
        propuesta({ ticker: "AAPL", montoUsd: 300, confianza: "media" }), // sin efectivo (300 - 100 - 200 = 0)
        propuesta({ ticker: "QQQ", montoUsd: 100, confianza: "baja" }), // no entra: máximo de operaciones
      ],
      estado,
      limites
    );
    expect(pausar).toBeNull();
    const por = (t: string) => decisiones.find((d) => d.ticker === t)!;
    expect(por("TSLA").ajuste).toContain("fuera del universo");
    expect(por("KO")).toMatchObject({ aprobada: true, montoAprobadoUsd: 300, ventaTotal: true });
    expect(por("NVDA")).toMatchObject({ aprobada: true, montoAprobadoUsd: 200 });
    expect(por("NVDA").ajuste).toContain("máximo por posición");
    expect(por("AAPL").aprobada).toBe(false);
    expect(por("QQQ").ajuste).toContain("máximo de 3 operaciones");
    expect(decisiones.every((d) => d.aprobada || d.ajuste)).toBe(true); // nada se descarta sin motivo
  });
});
