import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListasCategorias } from "./gemini";

// service_role bypassea RLS, asi que hay que filtrar global-o-propia a mano.
export async function obtenerListasCategorias(
  supabase: SupabaseClient,
  usuarioId: string
): Promise<ListasCategorias> {
  const { data } = await supabase
    .from("categorias")
    .select("nombre, tipo")
    .or(`usuario_id.is.null,usuario_id.eq.${usuarioId}`)
    .order("orden");

  const filas = data ?? [];
  return {
    gasto: filas.filter((c) => c.tipo === "gasto").map((c) => c.nombre),
    ingreso: filas.filter((c) => c.tipo === "ingreso").map((c) => c.nombre),
  };
}
