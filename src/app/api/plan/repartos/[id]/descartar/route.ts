import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;

  const { data: reparto } = await supabase
    .from("repartos")
    .select("id, estado")
    .eq("id", id)
    .eq("usuario_id", user.id)
    .single();

  if (!reparto) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (reparto.estado !== "pendiente") {
    return NextResponse.json({ error: "Este reparto ya no está pendiente" }, { status: 400 });
  }

  const { error } = await supabase
    .from("repartos")
    .update({ estado: "descartado" })
    .eq("id", id)
    .eq("usuario_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
