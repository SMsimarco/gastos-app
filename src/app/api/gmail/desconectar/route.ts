import { NextResponse } from "next/server";
import { crearClienteServidor, crearClienteServicio } from "@/lib/supabase/server";
import { revocarToken } from "@/lib/gmail";

export async function POST() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const supabaseServicio = crearClienteServicio();
  const { data: integracion } = await supabaseServicio
    .from("gmail_integracion")
    .select("refresh_token")
    .eq("usuario_id", user.id)
    .single();

  if (integracion?.refresh_token) {
    await revocarToken(integracion.refresh_token);
  }

  const { error } = await supabaseServicio
    .from("gmail_integracion")
    .update({ activo: false, refresh_token: null })
    .eq("usuario_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
