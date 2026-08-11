import type { SupabaseClient } from "@supabase/supabase-js";
import type { Movimiento } from "./gemini";
import { detectarDuplicado } from "./duplicados";

type CategoriaInfo = { id: string; emoji: string; nombre: string };

async function resolverCategoria(
  supabase: SupabaseClient,
  item: Movimiento,
  usuarioId: string
): Promise<CategoriaInfo> {
  const { data: reglas } = await supabase
    .from("reglas_comercio")
    .select("patron, categorias(id, emoji, nombre)")
    .eq("usuario_id", usuarioId);

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

// Suma n meses a una fecha ISO (YYYY-MM-DD), recortando al ultimo dia valido
// del mes destino (ej. 31 ene + 1 mes = 28/29 feb, no "3 de marzo").
function sumarMeses(fechaISO: string, n: number): string {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1 + n, 1));
  const ultimoDiaDelMes = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 0)).getUTCDate();
  fecha.setUTCDate(Math.min(dia, ultimoDiaDelMes));
  return fecha.toISOString().slice(0, 10);
}

export async function guardarMovimiento(
  supabase: SupabaseClient,
  item: Movimiento,
  fuente: "audio" | "texto" | "foto",
  usuarioId: string
) {
  const categoria = await resolverCategoria(supabase, item, usuarioId);
  const tcUsado = await obtenerUltimoTC(supabase);

  const cuotasTotal = Math.max(1, Math.floor(item.cuotas) || 1);
  const montoArsTotal = item.moneda === "ARS" ? item.monto : tcUsado ? Number((item.monto * tcUsado).toFixed(2)) : item.monto;
  const posibleDuplicado = await detectarDuplicado(
    supabase,
    usuarioId,
    item.fecha,
    item.tipo,
    montoArsTotal,
    item.comercio,
    item.descripcion
  );
  const montoUsdTotal = item.moneda === "ARS"
    ? (tcUsado ? Number((item.monto / tcUsado).toFixed(2)) : null)
    : item.monto;

  const montoArsCuota = Number((montoArsTotal / cuotasTotal).toFixed(2));
  const montoUsdCuota = montoUsdTotal !== null ? Number((montoUsdTotal / cuotasTotal).toFixed(2)) : null;

  const base = {
    usuario_id: usuarioId,
    tipo: item.tipo,
    tc_usado: tcUsado,
    moneda_origen: item.moneda,
    categoria_id: categoria.id,
    comercio: item.comercio || null,
    descripcion: item.descripcion,
    metodo_pago: item.metodo_pago || null,
    fuente,
    confianza: item.confianza,
  };

  const { data: padre, error } = await supabase
    .from("movimientos")
    .insert({
      ...base,
      fecha: item.fecha,
      monto_ars: montoArsCuota,
      monto_usd: montoUsdCuota,
      cuotas_total: cuotasTotal,
      cuota_nro: 1,
      transcripcion_raw: item.transcripcion_raw,
    })
    .select()
    .single();

  if (error) throw new Error(`No pude insertar el movimiento: ${error.message}`);

  if (cuotasTotal > 1) {
    const hijos = Array.from({ length: cuotasTotal - 1 }, (_, i) => ({
      ...base,
      fecha: sumarMeses(item.fecha, i + 1),
      monto_ars: montoArsCuota,
      monto_usd: montoUsdCuota,
      cuotas_total: cuotasTotal,
      cuota_nro: i + 2,
      movimiento_padre_id: padre.id,
      transcripcion_raw: null,
    }));

    const { error: errorHijos } = await supabase.from("movimientos").insert(hijos);
    if (errorHijos) throw new Error(`No pude insertar las cuotas restantes: ${errorHijos.message}`);
  }

  return { ...padre, categoriaEmoji: categoria.emoji, categoriaNombre: categoria.nombre, posibleDuplicado };
}
