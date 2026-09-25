import { NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { obtenerConfigPlan, obtenerGastoMensualArs } from "@/lib/planData";

export async function GET() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const [{ data: bolsillos }, config, gastoMensualArs, { data: repartoPendiente }] = await Promise.all([
    supabase.from("bolsillos").select("id, clave, nombre, moneda, saldo, meta, orden").order("orden"),
    obtenerConfigPlan(supabase, user.id),
    obtenerGastoMensualArs(supabase, user.id),
    supabase
      .from("repartos")
      .select("id, monto_ars, tc_referencia, detalle, estado, created_at")
      .eq("estado", "pendiente")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    bolsillos: bolsillos ?? [],
    config,
    gastoMensualArs,
    repartoPendiente: repartoPendiente ?? null,
  });
}
