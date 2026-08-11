import type { SupabaseClient } from "@supabase/supabase-js";
import type { Movimiento } from "./gemini";

type CategoriaInfo = { id: string; emoji: string; nombre: string };

async function resolverCategoria(
  supabase: SupabaseClient,
  item: Movimiento
): Promise<CategoriaInfo> {
  const { data: reglas } = await supabase
    .from("reglas_comercio")
    .select("patron, categorias(id, emoji, nombre)");

  const textoBusqueda = `${item.comercio ?? ""} ${item.descripcion}`.toLowerCase();
  const regla = (reglas ?? []).find((r) =>
    textoBusqueda.includes(r.patron.toLowerCase())
  );
  const categoriaRegla = regla?.categorias as unknown as CategoriaInfo | undefined;
  if (categoriaRegla) return categoriaRegla;

  const { data: categorias } = await supabase
    .from("categorias")
    .select("id, emoji, nombre")
    .eq("nombre", item.categoria)
    .eq("tipo", item.tipo)
    .limit(1);

  if (categorias && categorias.length > 0) return categorias[0];

  return { id: null as unknown as string, emoji: "📦", nombre: item.categoria };
}

async function obtenerUltimoTC(supabase: SupabaseClient): Promise<number | null> {
  const { data } = await supabase
    .from("tipo_cambio")
    .select("oficial_venta")
    .order("fecha", { ascending: false })
    .limit(1);
  return data && data.length > 0 ? data[0].oficial_venta : null;
}

export async function guardarMovimiento(
  supabase: SupabaseClient,
  item: Movimiento,
  fuente: "audio" | "texto" | "foto"
) {
  const categoria = await resolverCategoria(supabase, item);
  const tcUsado = await obtenerUltimoTC(supabase);

  const montoArs = item.moneda === "ARS" ? item.monto : tcUsado ? Number((item.monto * tcUsado).toFixed(2)) : item.monto;
  const montoUsd = item.moneda === "ARS"
    ? (tcUsado ? Number((item.monto / tcUsado).toFixed(2)) : null)
    : item.monto;

  const { data, error } = await supabase
    .from("movimientos")
    .insert({
      tipo: item.tipo,
      fecha: item.fecha,
      monto_ars: montoArs,
      monto_usd: montoUsd,
      tc_usado: tcUsado,
      moneda_origen: item.moneda,
      categoria_id: categoria.id,
      comercio: item.comercio || null,
      descripcion: item.descripcion,
      metodo_pago: item.metodo_pago || null,
      cuotas_total: 1,
      cuota_nro: 1,
      fuente,
      transcripcion_raw: item.transcripcion_raw,
      confianza: item.confianza,
    })
    .select()
    .single();

  if (error) throw new Error(`No pude insertar el movimiento: ${error.message}`);

  return { ...data, categoriaEmoji: categoria.emoji, categoriaNombre: categoria.nombre };
}
