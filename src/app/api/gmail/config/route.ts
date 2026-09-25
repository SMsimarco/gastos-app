import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor, crearClienteServicio } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const supabaseServicio = crearClienteServicio();
  const { data } = await supabaseServicio
    .from("gmail_integracion")
    .select("activo, remitentes, ultimo_check")
    .eq("usuario_id", user.id)
    .maybeSingle();

  // Nunca devolvemos refresh_token acá, ni aunque exista la fila.
  return NextResponse.json({
    activo: data?.activo ?? false,
    remitentes: data?.remitentes ?? ["mercadopago.com.ar", "mercadopago.com"],
    ultimoCheck: data?.ultimo_check ?? null,
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { remitentes } = await request.json();
  if (!Array.isArray(remitentes) || remitentes.length === 0) {
    return NextResponse.json({ error: "Falta al menos un remitente" }, { status: 400 });
  }

  const supabaseServicio = crearClienteServicio();
  const { error } = await supabaseServicio
    .from("gmail_integracion")
    .update({ remitentes })
    .eq("usuario_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
