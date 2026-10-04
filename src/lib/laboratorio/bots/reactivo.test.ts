import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../telegram", () => ({ enviarMensajeTelegram: vi.fn() }));

import { enviarMensajeTelegram } from "../../telegram";
import { describirEventoMercado, enviarAvisoLab, MAX_AVISOS_LAB_POR_DIA, redactarAvisoEvento, redactarResumenLab } from "./avisos";
import type { LaboratorioBotsPanel } from "./panelBots";
import { referenciasDeBriefing, resumirDisparos } from "./reactivo";

describe("resumirDisparos", () => {
  const hoy = "2026-10-05";
  it("cuenta las decisiones por evento de hoy y devuelve la última, e ignora las de otros días y las simuladas", () => {
    const resultado = resumirDisparos(
      [
        { ts: "2026-10-05T14:30:00Z", disparador: "diaria", estado: "ok" },
        { ts: "2026-10-05T16:00:00Z", disparador: "evento", estado: "ok" },
        { ts: "2026-10-05T17:15:00Z", disparador: "evento", estado: "sin_cambios" },
        { ts: "2026-10-05T18:00:00Z", disparador: "evento", estado: "simulada" },
        { ts: "2026-10-02T16:00:00Z", disparador: "evento", estado: "ok" },
      ],
      hoy
    );
    expect(resultado.diariaHecha).toBe(true);
    expect(resultado.disparosHoy).toBe(2);
    expect(resultado.ultimoDisparo?.toISOString()).toBe("2026-10-05T17:15:00.000Z");
  });
  it("la decisión diaria con error NO cuenta como hecha: el monitor espera a que el cron la reintente", () => {
    expect(resumirDisparos([{ ts: "2026-10-05T14:30:00Z", disparador: "diaria", estado: "error" }], hoy).diariaHecha).toBe(false);
    expect(resumirDisparos([{ ts: "2026-10-05T14:30:00Z", disparador: "diaria", estado: "sin_presupuesto" }], hoy).diariaHecha).toBe(true);
  });
  it("sin corridas: nada hecho", () => {
    expect(resumirDisparos([], hoy)).toEqual({ diariaHecha: false, disparosHoy: 0, ultimoDisparo: null });
  });
});

describe("referenciasDeBriefing", () => {
  it("toma el precio que vio el bot de cada ticker en su última decisión", () => {
    expect(referenciasDeBriefing({ universo: [{ ticker: "NVDA", precio: 234.1 }, { ticker: "KO", precio: 85.66 }, { ticker: "X", precio: 0 }, { precio: 5 }] })).toEqual({ NVDA: 234.1, KO: 85.66 });
  });
  it("un briefing vacío o raro no rompe", () => {
    expect(referenciasDeBriefing(null)).toEqual({});
    expect(referenciasDeBriefing({})).toEqual({});
    expect(referenciasDeBriefing({ universo: "no" })).toEqual({});
  });
});

describe("redactar avisos", () => {
  const evento = { tipo: "movimiento", ticker: "NVDA", detalle: { variacion_pct: -4.2 } };
  it("describe cada tipo de evento", () => {
    expect(describirEventoMercado("movimiento", "NVDA", { variacion_pct: -4.2 })).toBe("NVDA se movió -4.20% desde la última decisión del bot");
    expect(describirEventoMercado("vix", null, { variacion_pct: 22 })).toBe("el VIX subió +22.00%");
    expect(describirEventoMercado("balance_hoy", "AAPL", {})).toBe("AAPL presenta balance hoy");
    expect(describirEventoMercado("noticia_relevante", "NVDA", { titular: "Nuevo chip" })).toContain("Nuevo chip");
  });
  it("un aviso de compra dice SIMULADO, qué hizo y por qué, y el pie de no asesoramiento", () => {
    const texto = redactarAvisoEvento({
      bot: "A",
      evento,
      decisiones: [{ ticker: "NVDA", accion: "comprar", montoAprobadoUsd: 150, razon: "Cayó sin noticias y el RSI quedó bajo.", aprobada: true, ajuste: null }],
      resumenMercado: "",
      estado: "ok",
    });
    expect(texto.startsWith("SIMULADO — plata ficticia")).toBe(true);
    expect(texto).toContain("Bot A decidió por un evento: NVDA se movió -4.20%");
    expect(texto).toContain("Compró US$150.00 de NVDA porque cayó sin noticias");
    expect(texto).toContain("no es asesoramiento financiero");
  });
  it("si no operó lo dice, y si la IA falló o no hay presupuesto también", () => {
    const base = { bot: "A", evento, decisiones: [{ ticker: "NVDA", accion: "mantener", montoAprobadoUsd: 0, razon: "x", aprobada: true, ajuste: null }], resumenMercado: "Sin cambios.", estado: "sin_cambios" };
    expect(redactarAvisoEvento(base)).toContain("Decidió no operar. Sin cambios.");
    expect(redactarAvisoEvento({ ...base, estado: "error" })).toContain("falló la IA");
    expect(redactarAvisoEvento({ ...base, estado: "sin_presupuesto" })).toContain("tope mensual de IA");
  });
  it("las decisiones descartadas por el gestor de riesgo no aparecen como operaciones", () => {
    const texto = redactarAvisoEvento({ bot: "A", evento, decisiones: [{ ticker: "TSLA", accion: "comprar", montoAprobadoUsd: 0, razon: "x", aprobada: false, ajuste: "Descartada: fuera del universo" }], resumenMercado: "", estado: "sin_cambios" });
    expect(texto).not.toContain("TSLA");
    expect(texto).toContain("Decidió no operar");
  });
});

describe("redactarResumenLab", () => {
  const panel = (parcial: Partial<LaboratorioBotsPanel>): LaboratorioBotsPanel => ({
    activo: true,
    fechaInicio: "2026-10-05",
    capitalInicialUsd: 1_000,
    diasTranscurridos: 7,
    diasTotales: 182,
    benchmark: { valorUsd: 1_010, rendimientoPct: 1 },
    bots: [
      { clave: "A", nombre: "A", perfil: "completo", reactivo: true, pausado: false, motivoPausa: null, valorUsd: 1_025, efectivoUsd: 500, rendimientoPct: 2.5, costoIaUsd: 0.1, lecciones: [], posiciones: [], ultimaCorrida: null, historial: [] },
      { clave: "B", nombre: "B", perfil: "completo", reactivo: false, pausado: false, motivoPausa: null, valorUsd: 990, efectivoUsd: 600, rendimientoPct: -1, costoIaUsd: 0.1, lecciones: [], posiciones: [], ultimaCorrida: null, historial: [] },
      { clave: "C", nombre: "C", perfil: "solo_precios", reactivo: false, pausado: false, motivoPausa: null, valorUsd: 1_012, efectivoUsd: 400, rendimientoPct: 1.2, costoIaUsd: 0.05, lecciones: [], posiciones: [], ultimaCorrida: null, historial: [] },
    ],
    ...parcial,
  });
  it("ordena los bots y el benchmark de mejor a peor, con el día de la corrida y la advertencia", () => {
    const lineas = redactarResumenLab(panel({}));
    expect(lineas[0]).toContain("SIMULADO");
    expect(lineas[0]).toContain("día 7 de 182");
    expect(lineas.slice(1, 5)).toEqual([
      "1. Bot A: US$1025.00 (+2.50%)",
      "2. Bot C: US$1012.00 (+1.20%)",
      "3. VOO sin tocar: US$1010.00 (+1.00%)",
      "4. Bot B: US$990.00 (-1.00%)",
    ]);
    expect(lineas.at(-1)).toContain("poco para descartar suerte");
  });
  it("con el laboratorio inactivo no agrega nada y sin cierres avisa que no hay datos", () => {
    expect(redactarResumenLab(panel({ activo: false }))).toEqual([]);
    expect(redactarResumenLab(panel({ bots: [], benchmark: null }))).toEqual(["Laboratorio (SIMULADO): todavía sin datos de cierre."]);
  });
});

describe("enviarAvisoLab: máximo de 3 por día", () => {
  afterEach(() => vi.mocked(enviarMensajeTelegram).mockReset());

  function clienteFalso(opciones: { vinculo: boolean; clavesTomadas: string[] }) {
    const reservas: string[] = [];
    const borradas: string[] = [];
    const cliente = {
      from: (tabla: string) => {
        if (tabla === "telegram_vinculos") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opciones.vinculo ? { chat_id: 123 } : null }) }) }) };
        }
        return {
          insert: async (fila: { clave: string }) => {
            if (opciones.clavesTomadas.includes(fila.clave)) return { error: { code: "23505" } };
            reservas.push(fila.clave);
            return { error: null };
          },
          delete: () => ({ eq: () => ({ eq: (_c: string, clave: string) => ({ eq: async () => { borradas.push(clave); return {}; } }) }) }),
        };
      },
    } as unknown as SupabaseClient;
    return { cliente, reservas, borradas };
  }

  it("reserva la primera clave libre y manda el mensaje", async () => {
    const { cliente, reservas } = clienteFalso({ vinculo: true, clavesTomadas: ["lab_aviso_1"] });
    expect(await enviarAvisoLab(cliente, "u1", "hola")).toBe("enviado");
    expect(reservas).toEqual(["lab_aviso_2"]);
    expect(enviarMensajeTelegram).toHaveBeenCalledWith(123, "hola");
  });
  it("con las tres reservas del día tomadas no manda nada", async () => {
    const { cliente } = clienteFalso({ vinculo: true, clavesTomadas: ["lab_aviso_1", "lab_aviso_2", "lab_aviso_3"] });
    expect(MAX_AVISOS_LAB_POR_DIA).toBe(3);
    expect(await enviarAvisoLab(cliente, "u1", "hola")).toBe("sin_cupo");
    expect(enviarMensajeTelegram).not.toHaveBeenCalled();
  });
  it("sin Telegram vinculado no reserva cupo ni manda", async () => {
    const { cliente, reservas } = clienteFalso({ vinculo: false, clavesTomadas: [] });
    expect(await enviarAvisoLab(cliente, "u1", "hola")).toBe("sin_telegram");
    expect(reservas).toEqual([]);
  });
  it("si Telegram falla libera la reserva para no gastar el cupo", async () => {
    vi.mocked(enviarMensajeTelegram).mockImplementation(async () => {
      throw new Error("Telegram caído");
    });
    const { cliente, reservas, borradas } = clienteFalso({ vinculo: true, clavesTomadas: [] });
    expect(await enviarAvisoLab(cliente, "u1", "hola")).toBe("error");
    expect(reservas).toEqual(["lab_aviso_1"]);
    expect(borradas).toEqual(["lab_aviso_1"]);
  });
});
