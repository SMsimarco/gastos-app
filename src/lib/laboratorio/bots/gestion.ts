// Gestión del laboratorio desde la pantalla (SIMULADO): activar o pausar, límites y estrategia. Las
// validaciones son puras; la activación usa el cliente del usuario (RLS), nunca service_role.
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOTS_POR_DEFECTO, ESTRATEGIA_DEFAULT } from "./decidir";

type Resultado<T> = { ok: true; cambios: T } | { ok: false; error: string };

function numeroEnRango(valor: unknown, minimo: number, maximo: number, nombre: string): number | string {
  const numero = Number(valor);
  if (typeof valor === "boolean" || valor === null || valor === "" || !Number.isFinite(numero) || numero < minimo || numero > maximo) {
    return `${nombre} tiene que ser un número entre ${minimo} y ${maximo}`;
  }
  return numero;
}

const RANGOS_CONFIG: Array<{ campo: string; minimo: number; maximo: number }> = [
  { campo: "max_pct_por_posicion", minimo: 1, maximo: 100 },
  { campo: "min_pct_efectivo", minimo: 0, maximo: 90 },
  { campo: "max_operaciones_por_dia", minimo: 0, maximo: 20 },
  { campo: "drawdown_pausa_pct", minimo: 1, maximo: 100 },
  { campo: "max_costo_ia_mensual_usd", minimo: 0, maximo: 1_000 },
  { campo: "max_decisiones_evento_por_dia", minimo: 0, maximo: 10 },
  { campo: "cooldown_evento_min", minimo: 0, maximo: 1_440 },
];

export function validarCambiosConfig(cuerpo: unknown): Resultado<Record<string, unknown>> {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return { ok: false, error: "El cuerpo tiene que ser un objeto" };
  const entrada = cuerpo as Record<string, unknown>;
  const cambios: Record<string, unknown> = {};
  const permitidos = new Set(["activo", "universo", ...RANGOS_CONFIG.map((rango) => rango.campo)]);
  const desconocidos = Object.keys(entrada).filter((clave) => !permitidos.has(clave));
  if (desconocidos.length > 0) return { ok: false, error: `Campos no permitidos: ${desconocidos.join(", ")}` };

  if ("activo" in entrada) {
    if (typeof entrada.activo !== "boolean") return { ok: false, error: "activo tiene que ser true o false" };
    cambios.activo = entrada.activo;
  }
  if ("universo" in entrada) {
    if (!Array.isArray(entrada.universo) || entrada.universo.length === 0 || entrada.universo.length > 30) return { ok: false, error: "universo tiene que ser una lista de 1 a 30 tickers" };
    const tickers = entrada.universo.map((ticker) => (typeof ticker === "string" ? ticker.trim().toUpperCase() : ""));
    if (tickers.some((ticker) => !/^[A-Z][A-Z0-9.-]{0,5}$/.test(ticker))) return { ok: false, error: "universo tiene un ticker inválido" };
    cambios.universo = [...new Set(tickers)];
  }
  for (const { campo, minimo, maximo } of RANGOS_CONFIG) {
    if (!(campo in entrada)) continue;
    const valor = numeroEnRango(entrada[campo], minimo, maximo, campo);
    if (typeof valor === "string") return { ok: false, error: valor };
    cambios[campo] = valor;
  }
  if (Object.keys(cambios).length === 0) return { ok: false, error: "No hay nada para cambiar" };
  return { ok: true, cambios };
}

export function validarCambiosBot(cuerpo: unknown): Resultado<Record<string, unknown>> {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return { ok: false, error: "El cuerpo tiene que ser un objeto" };
  const entrada = cuerpo as Record<string, unknown>;
  const desconocidos = Object.keys(entrada).filter((clave) => !["pausado", "estrategia_prompt"].includes(clave));
  if (desconocidos.length > 0) return { ok: false, error: `Campos no permitidos: ${desconocidos.join(", ")}` };
  const cambios: Record<string, unknown> = {};
  if ("pausado" in entrada) {
    if (typeof entrada.pausado !== "boolean") return { ok: false, error: "pausado tiene que ser true o false" };
    cambios.pausado = entrada.pausado;
    cambios.motivo_pausa = entrada.pausado ? "Pausado a mano" : null;
  }
  if ("estrategia_prompt" in entrada) {
    const texto = typeof entrada.estrategia_prompt === "string" ? entrada.estrategia_prompt.trim() : "";
    if (texto.length < 20 || texto.length > 2_000) return { ok: false, error: "La estrategia tiene que tener entre 20 y 2000 caracteres" };
    cambios.estrategia_prompt = texto;
  }
  if (Object.keys(cambios).length === 0) return { ok: false, error: "No hay nada para cambiar" };
  return { ok: true, cambios };
}

export function esClaveDeBot(valor: string): valor is "A" | "B" | "C" {
  return valor === "A" || valor === "B" || valor === "C";
}

// Crea los tres bots del usuario si todavía no existen (arrancan pausados).
export async function asegurarBots(supabase: SupabaseClient, usuarioId: string): Promise<void> {
  const { error } = await supabase.from("lab_bots").upsert(
    BOTS_POR_DEFECTO.map((bot) => ({ usuario_id: usuarioId, ...bot, estrategia_prompt: ESTRATEGIA_DEFAULT, pausado: true })),
    { onConflict: "usuario_id,clave", ignoreDuplicates: true }
  );
  if (error) throw new Error(`No pude crear los bots: ${error.message}`);
}

// Activa el laboratorio: crea los bots si faltan, marca la fecha de inicio de la corrida de 6 meses y los despausa.
export async function activarLaboratorio(supabase: SupabaseClient, usuarioId: string, hoyNuevaYork: string): Promise<void> {
  await asegurarBots(supabase, usuarioId);
  const { data: config } = await supabase.from("lab_config").select("fecha_inicio").eq("usuario_id", usuarioId).maybeSingle();
  const { error } = await supabase.from("lab_config").update({ activo: true, fecha_inicio: config?.fecha_inicio ?? hoyNuevaYork }).eq("usuario_id", usuarioId);
  if (error) throw new Error(`No pude activar el laboratorio: ${error.message}`);
  const { error: errorBots } = await supabase.from("lab_bots").update({ pausado: false, motivo_pausa: null }).eq("usuario_id", usuarioId);
  if (errorBots) throw new Error(`No pude activar los bots: ${errorBots.message}`);
}

export async function desactivarLaboratorio(supabase: SupabaseClient, usuarioId: string): Promise<void> {
  const { error } = await supabase.from("lab_config").update({ activo: false }).eq("usuario_id", usuarioId);
  if (error) throw new Error(`No pude pausar el laboratorio: ${error.message}`);
  await supabase.from("lab_bots").update({ pausado: true, motivo_pausa: "Laboratorio pausado" }).eq("usuario_id", usuarioId);
}
