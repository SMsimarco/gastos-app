import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConfigMonitor } from "./monitor";

export const UNIVERSO_DEFAULT = [
  "VOO", "QQQ", "VTI", "SCHD", "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "JPM", "XOM", "KO", "YPF", "VIST",
];

// Los ETF no tienen balances; se saltean en el calendario.
export const ETFS_UNIVERSO = new Set(["VOO", "QQQ", "VTI", "SCHD"]);

export type ContextoLab = {
  universo: string[];
  topeIaUsd: number;
  modeloResumen: string;
  modeloDecision: string;
  monitor: Pick<ConfigMonitor, "maxDecisionesEventoPorDia" | "cooldownEventoMin">;
};

type FilaConfig = {
  universo: string[];
  max_costo_ia_mensual_usd: number;
  modelo_resumen: string;
  modelo_decision: string;
  max_decisiones_evento_por_dia: number;
  cooldown_evento_min: number;
};

// Los endpoints /api/lab/* corren sin sesión (los llama pg_cron), así que leen la configuración
// de todos los usuarios con service_role: universo = unión, tope = el más chico (el más conservador).
export async function leerContextoLab(supabase: SupabaseClient): Promise<ContextoLab> {
  const { data } = await supabase
    .from("lab_config")
    .select("universo, max_costo_ia_mensual_usd, modelo_resumen, modelo_decision, max_decisiones_evento_por_dia, cooldown_evento_min");
  const filas = (data ?? []) as FilaConfig[];
  if (filas.length === 0) {
    return {
      universo: UNIVERSO_DEFAULT,
      topeIaUsd: 10,
      modeloResumen: "gemini-3.5-flash-lite",
      modeloDecision: "gemini-3.6-flash",
      monitor: { maxDecisionesEventoPorDia: 2, cooldownEventoMin: 60 },
    };
  }
  return {
    universo: [...new Set(filas.flatMap((fila) => fila.universo.map((ticker) => ticker.toUpperCase())))],
    topeIaUsd: Math.min(...filas.map((fila) => Number(fila.max_costo_ia_mensual_usd))),
    modeloResumen: filas[0].modelo_resumen,
    modeloDecision: filas[0].modelo_decision,
    monitor: {
      maxDecisionesEventoPorDia: Math.min(...filas.map((fila) => fila.max_decisiones_evento_por_dia)),
      cooldownEventoMin: Math.max(...filas.map((fila) => fila.cooldown_evento_min)),
    },
  };
}

// Fecha YYYY-MM-DD en hora de Nueva York (para claves de eventos y comparar contra la rueda).
export function fechaNuevaYork(fecha: Date): string {
  return fecha.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
