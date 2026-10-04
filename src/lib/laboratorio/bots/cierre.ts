import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaNuevaYork } from "../config";
import { obtenerSnapshots } from "../fuentes/alpaca";
import { mensajeDeError } from "../fuentes/http";
import { obtenerCuentaPaper, obtenerOrdenPaper, obtenerPosicionesPaper, type CuentaBot } from "./alpacaPaper";
import type { FilaBot } from "./ejecutar";

const ESTADOS_FINALES = new Set(["filled", "canceled", "rejected", "expired", "done_for_day"]);

// Costo compartido de IA (resúmenes de noticias y diario de mercado): lo cargan los bots que usan esa
// información (perfil completo), a partes iguales. El bot C no usa noticias ni diario, así que no lo paga.
export function repartirCostoCompartido(costoCompartidoUsd: number, bots: Array<{ clave: string; perfil_info: string }>): Record<string, number> {
  const completos = bots.filter((bot) => bot.perfil_info === "completo");
  const parte = completos.length > 0 ? costoCompartidoUsd / completos.length : 0;
  return Object.fromEntries(bots.map((bot) => [bot.clave, bot.perfil_info === "completo" ? Math.round(parte * 1_000_000) / 1_000_000 : 0]));
}

async function conciliarOrdenes(supabase: SupabaseClient, bot: FilaBot) {
  const { data: pendientes } = await supabase
    .from("lab_decisiones")
    .select("id, orden_alpaca_id, estado_orden")
    .eq("usuario_id", bot.usuario_id)
    .eq("bot_id", bot.id)
    .not("orden_alpaca_id", "is", null);
  let actualizadas = 0;
  for (const fila of (pendientes ?? []).filter((item) => !ESTADOS_FINALES.has(item.estado_orden as string))) {
    try {
      const orden = await obtenerOrdenPaper(bot.alpaca_cuenta, fila.orden_alpaca_id as string);
      await supabase.from("lab_decisiones").update({ estado_orden: orden.estado, precio_ejecucion: orden.precioPromedio, cantidad_ejecutada: orden.cantidadEjecutada }).eq("id", fila.id as string).eq("usuario_id", bot.usuario_id);
      actualizadas += 1;
    } catch {
      // Se vuelve a intentar en el próximo cierre.
    }
  }
  return actualizadas;
}

export async function ejecutarCierre(supabase: SupabaseClient) {
  const ahora = new Date();
  const hoy = fechaNuevaYork(ahora);
  const { data: configs } = await supabase
    .from("lab_config")
    .select("usuario_id, fecha_inicio, inicio_real, voo_cantidad")
    .eq("activo", true);
  if (!configs || configs.length === 0) return { omitido: "laboratorio_inactivo" };

  const resultados: Array<Record<string, unknown>> = [];
  for (const config of configs) {
    const usuarioId = config.usuario_id as string;
    const { data: bots } = await supabase.from("lab_bots").select("id, usuario_id, clave, nombre, perfil_info, reactivo, alpaca_cuenta, estrategia_prompt, pausado").eq("usuario_id", usuarioId);
    const lista = (bots ?? []) as FilaBot[];

    const desde = (config.inicio_real as string | null) ?? (config.fecha_inicio ? `${config.fecha_inicio}T00:00:00Z` : ahora.toISOString());
    const { data: compartidos } = await supabase.from("lab_costos_ia").select("costo_usd").in("tipo", ["resumen_noticias", "diario_mercado"]).gte("ts", desde);
    const partes = repartirCostoCompartido((compartidos ?? []).reduce((total, fila) => total + Number(fila.costo_usd), 0), lista);

    for (const bot of lista) {
      try {
        const conciliadas = await conciliarOrdenes(supabase, bot);
        const { data: previo } = await supabase.from("lab_snapshots").select("ts").eq("usuario_id", usuarioId).eq("bot_id", bot.id).eq("tipo", "cierre").order("ts", { ascending: false }).limit(1);
        if (previo?.[0] && fechaNuevaYork(new Date(previo[0].ts as string)) === hoy) {
          resultados.push({ bot: bot.clave, snapshot: "ya_existia", conciliadas });
          continue;
        }
        const [cuenta, posiciones, costos] = await Promise.all([
          obtenerCuentaPaper(bot.alpaca_cuenta as CuentaBot),
          obtenerPosicionesPaper(bot.alpaca_cuenta as CuentaBot),
          supabase.from("lab_corridas").select("costo_usd").eq("usuario_id", usuarioId).eq("bot_id", bot.id),
        ]);
        const costoPropio = (costos.data ?? []).reduce((total, fila) => total + Number(fila.costo_usd), 0);
        const { error } = await supabase.from("lab_snapshots").insert({
          bot_id: bot.id,
          usuario_id: usuarioId,
          tipo: "cierre",
          valor_usd: cuenta.equity,
          efectivo_usd: cuenta.efectivo,
          costo_ia_acumulado_usd: Math.round((costoPropio + (partes[bot.clave] ?? 0)) * 1_000_000) / 1_000_000,
          posiciones: posiciones.map((posicion) => ({ ticker: posicion.ticker, cantidad: posicion.cantidad, valor_usd: posicion.valorMercado, resultado_pct: posicion.pnlPct })),
        });
        if (error) throw new Error(error.message);
        resultados.push({ bot: bot.clave, snapshot: "ok", equity: cuenta.equity, conciliadas });
      } catch (error) {
        resultados.push({ bot: bot.clave, error: mensajeDeError(error) });
      }
    }

    // Benchmark: VOO comprado virtualmente el día 1 y nunca tocado.
    if (config.voo_cantidad) {
      try {
        const { data: previo } = await supabase.from("lab_snapshots").select("ts").eq("usuario_id", usuarioId).is("bot_id", null).eq("tipo", "cierre").order("ts", { ascending: false }).limit(1);
        if (previo?.[0] && fechaNuevaYork(new Date(previo[0].ts as string)) === hoy) {
          resultados.push({ bot: "VOO", snapshot: "ya_existia" });
        } else {
          const [voo] = await obtenerSnapshots(["VOO"]);
          if (!voo) throw new Error("Sin precio de VOO");
          const valor = Math.round(Number(config.voo_cantidad) * voo.precio * 100) / 100;
          const { error } = await supabase.from("lab_snapshots").insert({ bot_id: null, usuario_id: usuarioId, tipo: "cierre", valor_usd: valor, efectivo_usd: 0, costo_ia_acumulado_usd: 0 });
          if (error) throw new Error(error.message);
          resultados.push({ bot: "VOO", snapshot: "ok", valor });
        }
      } catch (error) {
        resultados.push({ bot: "VOO", error: mensajeDeError(error) });
      }
    }
  }
  return { cierre: hoy, resultados };
}
