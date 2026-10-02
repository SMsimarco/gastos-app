import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { calcularRepartoParaUsuario } from "@/lib/planData";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const tcUsado = Number(body.tc_usado);
  if (!Number.isFinite(tcUsado) || tcUsado <= 0) {
    return NextResponse.json({ error: "tc_usado inválido" }, { status: 400 });
  }

  const { data: reparto } = await supabase
    .from("repartos")
    .select("id, monto_ars, estado")
    .eq("id", id)
    .eq("usuario_id", user.id)
    .single();
  if (!reparto) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (reparto.estado !== "pendiente") {
    return NextResponse.json({ error: "Este reparto ya no está pendiente" }, { status: 409 });
  }

  const calculado = await calcularRepartoParaUsuario(supabase, user.id, Number(reparto.monto_ars), tcUsado);
  if (!calculado) {
    return NextResponse.json({ error: "No pude recalcular el reparto con esa cotización" }, { status: 422 });
  }

  const { error } = await supabase.rpc("aplicar_reparto", {
    p_usuario_id: user.id,
    p_reparto_id: reparto.id,
    p_tc_usado: tcUsado,
    p_detalle: calculado.detalle,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });

  const [{ data: repartoActualizado }, { data: bolsillos }] = await Promise.all([
    supabase.from("repartos").select("*").eq("id", reparto.id).single(),
    supabase.from("bolsillos").select("id, clave, nombre, moneda, saldo, meta, orden").order("orden"),
  ]);

  return NextResponse.json({ reparto: repartoActualizado, bolsillos: bolsillos ?? [] });
}
