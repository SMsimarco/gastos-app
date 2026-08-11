import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { nombre, monto_objetivo } = await request.json();
  if (!nombre || !monto_objetivo) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("metas_ahorro")
    .insert({ usuario_id: user.id, nombre, monto_objetivo })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ meta: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await request.json();
  const { error } = await supabase.from("metas_ahorro").delete().eq("id", id).eq("usuario_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
