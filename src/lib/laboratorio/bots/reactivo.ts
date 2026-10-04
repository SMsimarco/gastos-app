// Decisiones por evento del bot reactivo (SIMULADO). Estas funciones arman el contexto que el monitor necesita
// para decidir si un evento despierta al bot A: sus posiciones reales, los precios de su última decisión (el
// movimiento de 3% se mide contra ahí) y cuántas decisiones por evento ya hizo hoy.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaNuevaYork } from "../config";
import { obtenerPosicionesPaper } from "./alpacaPaper";
import type { FilaBot, FilaConfig } from "./ejecutar";

export type ResumenDisparos = { diariaHecha: boolean; disparosHoy: number; ultimoDisparo: Date | null };

// `corridas` de un bot (más recientes primero o en cualquier orden). Una decisión diaria cuenta como hecha
// aunque haya quedado sin presupuesto: el monitor no debe ir por delante de ella.
export function resumirDisparos(corridas: Array<{ ts: string; disparador: string; estado: string }>, hoy: string): ResumenDisparos {
  let diariaHecha = false;
  let disparosHoy = 0;
  let ultimoDisparo: Date | null = null;
  for (const corrida of corridas) {
    if (fechaNuevaYork(new Date(corrida.ts)) !== hoy || corrida.estado === "simulada") continue;
    if (corrida.disparador === "diaria" && ["ok", "sin_cambios", "sin_presupuesto"].includes(corrida.estado)) diariaHecha = true;
    if (corrida.disparador === "evento") {
      disparosHoy += 1;
      const momento = new Date(corrida.ts);
      if (ultimoDisparo === null || momento > ultimoDisparo) ultimoDisparo = momento;
    }
  }
  return { diariaHecha, disparosHoy, ultimoDisparo };
}

// Precios que vio el bot en su última decisión: la referencia contra la que se mide el movimiento de 3%.
export function referenciasDeBriefing(briefing: unknown): Record<string, number> {
  const universo = (briefing as { universo?: Array<{ ticker?: unknown; precio?: unknown }> } | null)?.universo;
  if (!Array.isArray(universo)) return {};
  const referencias: Record<string, number> = {};
  for (const fila of universo) {
    const precio = Number(fila?.precio);
    if (typeof fila?.ticker === "string" && Number.isFinite(precio) && precio > 0) referencias[fila.ticker] = precio;
  }
  return referencias;
}

export type ContextoReactivo = {
  bot: FilaBot;
  config: FilaConfig;
  posiciones: string[];
  referencias: Record<string, number>;
} & ResumenDisparos;

// Devuelve null si no hay un bot reactivo activo (laboratorio inactivo o bot pausado).
export async function leerContextoReactivo(supabase: SupabaseClient, hoy: string): Promise<ContextoReactivo | null> {
  const { data: configs } = await supabase
    .from("lab_config")
    .select("usuario_id, activo, fecha_inicio, capital_inicial_usd, universo, max_pct_por_posicion, min_pct_efectivo, max_operaciones_por_dia, drawdown_pausa_pct, voo_precio_inicio, voo_cantidad")
    .eq("activo", true);
  for (const config of (configs ?? []) as FilaConfig[]) {
    const { data: bots } = await supabase
      .from("lab_bots")
      .select("id, usuario_id, clave, nombre, perfil_info, reactivo, alpaca_cuenta, estrategia_prompt, pausado")
      .eq("usuario_id", config.usuario_id)
      .eq("reactivo", true)
      .eq("pausado", false)
      .limit(1);
    const bot = (bots?.[0] ?? null) as FilaBot | null;
    if (!bot) continue;

    const [{ data: corridas }, { data: ultima }, posiciones] = await Promise.all([
      supabase.from("lab_corridas").select("ts, disparador, estado").eq("usuario_id", bot.usuario_id).eq("bot_id", bot.id).gte("ts", new Date(Date.now() - 30 * 3_600_000).toISOString()),
      supabase.from("lab_corridas").select("briefing").eq("usuario_id", bot.usuario_id).eq("bot_id", bot.id).neq("estado", "error").order("ts", { ascending: false }).limit(1),
      obtenerPosicionesPaper(bot.alpaca_cuenta).catch(() => []),
    ]);
    return {
      bot,
      config,
      posiciones: posiciones.map((posicion) => posicion.ticker),
      referencias: referenciasDeBriefing(ultima?.[0]?.briefing),
      ...resumirDisparos((corridas ?? []) as Array<{ ts: string; disparador: string; estado: string }>, hoy),
    };
  }
  return null;
}
