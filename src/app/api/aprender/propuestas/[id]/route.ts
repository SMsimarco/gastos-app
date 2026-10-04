import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { validarPesos } from "@/lib/inversiones/aprenderActivos";

// El usuario acepta o rechaza la propuesta mensual de cambio de pesos. Los pesos nunca cambian sin este OK.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const accion = body?.accion;
  if (accion !== "aceptar" && accion !== "rechazar") return NextResponse.json({ error: "La acción debe ser aceptar o rechazar" }, { status: 400 });

  const { data: propuesta } = await supabase.from("aprender_propuestas_pesos").select("id, estado, pesos_propuestos").eq("id", id).eq("usuario_id", user.id).maybeSingle();
  if (!propuesta) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (propuesta.estado !== "pendiente") return NextResponse.json({ error: "Esta propuesta ya fue resuelta" }, { status: 409 });

  if (accion === "aceptar") {
    const p = propuesta.pesos_propuestos as Record<string, unknown>;
    const validado = validarPesos(p);
    if (!validado.ok) return NextResponse.json({ error: validado.error }, { status: 400 });
    const { error } = await supabase.from("config_plan").update(validado.pesos).eq("usuario_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  const { error } = await supabase.from("aprender_propuestas_pesos").update({ estado: accion === "aceptar" ? "aceptada" : "rechazada", resuelta_at: new Date().toISOString() }).eq("id", id).eq("usuario_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, estado: accion === "aceptar" ? "aceptada" : "rechazada" });
}
