import type { SupabaseClient } from "@supabase/supabase-js";
import { costoLlamadaUsd, inicioDeMesUtc } from "./presupuesto";

// Lo gastado en IA en el mes, sumando todas las llamadas del laboratorio (resúmenes, diario, bots).
export async function gastoDelMes(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.from("lab_costos_ia").select("costo_usd").gte("ts", inicioDeMesUtc(new Date()));
  return (data ?? []).reduce((total, fila) => total + Number(fila.costo_usd), 0);
}

// Registra una llamada a la IA y devuelve su costo. Se registra aunque después falle algo: ya se gastó.
export async function registrarCostoIa(
  supabase: SupabaseClient,
  params: { tipo: string; modelo: string; tokensEntrada: number; tokensSalida: number; detalle?: Record<string, unknown> }
): Promise<number> {
  const costoUsd = costoLlamadaUsd(params.modelo, params.tokensEntrada, params.tokensSalida);
  await supabase.from("lab_costos_ia").insert({
    tipo: params.tipo,
    modelo: params.modelo,
    tokens_entrada: params.tokensEntrada,
    tokens_salida: params.tokensSalida,
    costo_usd: costoUsd,
    detalle: params.detalle ?? {},
  });
  return costoUsd;
}
