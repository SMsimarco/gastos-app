import type { SupabaseClient } from "@supabase/supabase-js";
import { interpretarPregunta } from "./gemini";

const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");

export async function responderConsulta(
  supabase: SupabaseClient,
  usuarioId: string,
  pregunta: string
): Promise<string> {
  const filtros = await interpretarPregunta(pregunta);

  let query = supabase
    .from("movimientos")
    .select("monto_ars, categorias(nombre)")
    .eq("usuario_id", usuarioId)
    .eq("tipo", filtros.tipo)
    .gte("fecha", filtros.desde)
    .lte("fecha", filtros.hasta);

  if (filtros.categoriaNombre) {
    const { data: cat } = await supabase
      .from("categorias")
      .select("id")
      .eq("nombre", filtros.categoriaNombre)
      .eq("tipo", filtros.tipo)
      .maybeSingle();
    if (cat) query = query.eq("categoria_id", cat.id);
  }

  const { data } = await query;
  const total = (data ?? []).reduce((acc, r) => acc + r.monto_ars, 0);
  const cantidad = (data ?? []).length;

  if (cantidad === 0) {
    return `No encontré movimientos${filtros.categoriaNombre ? ` de ${filtros.categoriaNombre}` : ""} en ese período.`;
  }

  const verbo = filtros.tipo === "gasto" ? "Gastaste" : "Ingresaste";
  const categoriaTexto = filtros.categoriaNombre ? ` en ${filtros.categoriaNombre}` : "";
  const periodoTexto = filtros.desde === filtros.hasta ? filtros.desde : `${filtros.desde} a ${filtros.hasta}`;

  return `${verbo} $${fmt(total)}${categoriaTexto} entre ${periodoTexto}.\n${cantidad} movimiento${cantidad === 1 ? "" : "s"}.`;
}
