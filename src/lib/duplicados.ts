import type { SupabaseClient } from "@supabase/supabase-js";

export async function detectarDuplicado(
  supabase: SupabaseClient,
  usuarioId: string,
  fecha: string,
  tipo: string,
  montoArs: number,
  comercio: string | null,
  descripcion: string
): Promise<boolean> {
  const margen = Math.max(1, montoArs * 0.02);

  let query = supabase
    .from("movimientos")
    .select("id")
    .eq("usuario_id", usuarioId)
    .eq("fecha", fecha)
    .eq("tipo", tipo)
    .gte("monto_ars", montoArs - margen)
    .lte("monto_ars", montoArs + margen)
    .limit(1);

  if (comercio) {
    query = query.ilike("comercio", `%${comercio}%`);
  } else {
    query = query.ilike("descripcion", `%${descripcion.slice(0, 20)}%`);
  }

  const { data } = await query;
  return !!data && data.length > 0;
}
