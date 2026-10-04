import { NextRequest, NextResponse } from "next/server";
import { esClaveDeBot, validarCambiosBot } from "@/lib/laboratorio/bots/gestion";
import { crearClienteServidor } from "@/lib/supabase/server";

// Pausar un bot o cambiar su estrategia. Con la sesión del usuario y RLS.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ clave: string }> }) {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { clave } = await params;
  const claveNormalizada = clave.toUpperCase();
  if (!esClaveDeBot(claveNormalizada)) return NextResponse.json({ error: "El bot tiene que ser A, B o C" }, { status: 400 });
  const validacion = validarCambiosBot(await request.json().catch(() => null));
  if (!validacion.ok) return NextResponse.json({ error: validacion.error }, { status: 400 });

  const { data, error } = await supabase.from("lab_bots").update(validacion.cambios).eq("usuario_id", user.id).eq("clave", claveNormalizada).select("clave");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Ese bot todavía no existe: activá el laboratorio primero" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
