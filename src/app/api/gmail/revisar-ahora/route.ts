import { NextResponse } from "next/server";
import { crearClienteServidor, crearClienteServicio } from "@/lib/supabase/server";
import { sincronizarGmailUsuario } from "@/lib/gmailSync";

export async function POST() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const supabaseServicio = crearClienteServicio();
  try {
    const resultado = await sincronizarGmailUsuario(supabaseServicio, user.id);
    return NextResponse.json(resultado);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error revisando el mail" },
      { status: 502 }
    );
  }
}
