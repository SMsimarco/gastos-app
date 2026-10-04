import type { SupabaseClient } from "@supabase/supabase-js";
import { mensajeDeError } from "../fuentes/http";
import { obtenerCuentaPaper, obtenerPosicionesPaper, type CuentaBot } from "./alpacaPaper";

const MINUTOS_ENTRE_SNAPSHOTS = 10;

// Valor intradía de cada bot (y del benchmark VOO) para el gráfico de "hoy". Lo llama el monitor cada 15 minutos
// con el mercado abierto. Nunca puede romper al monitor: cada bot falla por separado y se devuelve el error.
export async function guardarSnapshotsIntradia(supabase: SupabaseClient, precioVoo: number | null): Promise<{ bots: number; benchmark: boolean; omitido?: string; errores: string[] }> {
  const { data: configs } = await supabase.from("lab_config").select("usuario_id, voo_cantidad").eq("activo", true);
  let bots = 0;
  let benchmark = false;
  const errores: string[] = [];
  for (const config of configs ?? []) {
    const usuarioId = config.usuario_id as string;
    // Si ya hay un snapshot intradía reciente de este usuario, no se repite (el monitor corre cada 15 minutos).
    const { data: ultimo } = await supabase.from("lab_snapshots").select("ts").eq("usuario_id", usuarioId).eq("tipo", "intradia").order("ts", { ascending: false }).limit(1);
    if (ultimo?.[0] && Date.now() - new Date(ultimo[0].ts as string).getTime() < MINUTOS_ENTRE_SNAPSHOTS * 60_000) return { bots, benchmark, omitido: "reciente", errores };

    const { data: lista } = await supabase.from("lab_bots").select("id, clave, alpaca_cuenta").eq("usuario_id", usuarioId);
    for (const bot of lista ?? []) {
      try {
        const cuenta = bot.alpaca_cuenta as CuentaBot;
        const [estado, posiciones, costo] = await Promise.all([
          obtenerCuentaPaper(cuenta),
          obtenerPosicionesPaper(cuenta),
          supabase.from("lab_snapshots").select("costo_ia_acumulado_usd").eq("usuario_id", usuarioId).eq("bot_id", bot.id as string).eq("tipo", "cierre").order("ts", { ascending: false }).limit(1),
        ]);
        const { error } = await supabase.from("lab_snapshots").insert({
          bot_id: bot.id,
          usuario_id: usuarioId,
          tipo: "intradia",
          valor_usd: estado.equity,
          efectivo_usd: estado.efectivo,
          // El costo de IA acumulado se recalcula en el cierre; acá se arrastra el último conocido.
          costo_ia_acumulado_usd: Number(costo.data?.[0]?.costo_ia_acumulado_usd ?? 0),
          posiciones: posiciones.map((posicion) => ({ ticker: posicion.ticker, cantidad: posicion.cantidad, valor_usd: posicion.valorMercado, resultado_pct: posicion.pnlPct })),
        });
        if (error) throw new Error(error.message);
        bots += 1;
      } catch (error) {
        errores.push(`Bot ${bot.clave}: ${mensajeDeError(error)}`);
      }
    }
    if (config.voo_cantidad && precioVoo) {
      const { error } = await supabase.from("lab_snapshots").insert({ bot_id: null, usuario_id: usuarioId, tipo: "intradia", valor_usd: Math.round(Number(config.voo_cantidad) * precioVoo * 100) / 100, efectivo_usd: 0, costo_ia_acumulado_usd: 0 });
      if (error) errores.push(`VOO: ${error.message}`);
      else benchmark = true;
    }
  }
  return { bots, benchmark, errores };
}
