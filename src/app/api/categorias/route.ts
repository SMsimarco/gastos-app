import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

const EMOJIS_DISPONIBLES = ["🏷️", "💳", "🎯", "📌", "⭐", "🔖", "🎨", "🧩"];

export async function POST(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { nombre, tipo, emoji } = await request.json();
  if (!nombre || !tipo) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("categorias")
    .insert({
      usuario_id: user.id,
      nombre: nombre.trim(),
      tipo,
      emoji: emoji || EMOJIS_DISPONIBLES[Math.floor(Math.random() * EMOJIS_DISPONIBLES.length)],
      color: "#8b8f94",
      orden: 999,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ categoria: data });
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
  const { error } = await supabase.from("categorias").delete().eq("id", id).eq("usuario_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
