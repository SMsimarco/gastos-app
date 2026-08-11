import type { SupabaseClient } from "@supabase/supabase-js";

function primerDiaMes(fecha: string) {
  return `${fecha.slice(0, 7)}-01`;
}

function ultimoDiaMes(fecha: string) {
  const [anio, mes] = fecha.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
}

export async function chequearPresupuestoExcedido(
  supabase: SupabaseClient,
  usuarioId: string,
  categoriaId: string,
  categoriaNombre: string,
  fecha: string,
  montoDeEstaTransaccion: number
): Promise<{ categoriaNombre: string; presupuesto: number; gastado: number } | null> {
  const inicioMes = primerDiaMes(fecha);
  const finMes = ultimoDiaMes(fecha);

  const { data: presupuestoRow } = await supabase
    .from("presupuestos")
    .select("monto_mensual")
    .eq("usuario_id", usuarioId)
    .eq("categoria_id", categoriaId)
    .eq("mes", inicioMes)
    .maybeSingle();

  if (!presupuestoRow) return null;

  const { data: totalRow } = await supabase
    .from("movimientos")
    .select("monto_ars")
    .eq("usuario_id", usuarioId)
    .eq("categoria_id", categoriaId)
    .eq("tipo", "gasto")
    .gte("fecha", inicioMes)
    .lte("fecha", finMes);

  const totalConEste = (totalRow ?? []).reduce((acc, r) => acc + r.monto_ars, 0);
  const totalAntes = totalConEste - montoDeEstaTransaccion;
  const presupuesto = presupuestoRow.monto_mensual;

  if (totalAntes < presupuesto && totalConEste >= presupuesto) {
    return { categoriaNombre, presupuesto, gastado: totalConEste };
  }

  return null;
}
