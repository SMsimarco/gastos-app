import { NextRequest, NextResponse } from "next/server";
import { fechaNuevaYork } from "@/lib/laboratorio/config";
import { activarLaboratorio, desactivarLaboratorio, validarCambiosConfig } from "@/lib/laboratorio/bots/gestion";
import { crearClienteServidor } from "@/lib/supabase/server";

// Activar o pausar el laboratorio y cambiar límites y universo. Con la sesión del usuario y RLS.
export async function PATCH(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const validacion = validarCambiosConfig(await request.json().catch(() => null));
  if (!validacion.ok) return NextResponse.json({ error: validacion.error }, { status: 400 });
  const { activo, ...resto } = validacion.cambios;

  try {
    // La configuración se crea la primera vez que el usuario abre la pestaña; por si no existe todavía.
    await supabase.from("lab_config").upsert({ usuario_id: user.id }, { onConflict: "usuario_id", ignoreDuplicates: true });
    if (Object.keys(resto).length > 0) {
      const { error } = await supabase.from("lab_config").update(resto).eq("usuario_id", user.id);
      if (error) throw new Error(error.message);
    }
    if (activo === true) await activarLaboratorio(supabase, user.id, fechaNuevaYork(new Date()));
    if (activo === false) await desactivarLaboratorio(supabase, user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error desconocido" }, { status: 500 });
  }
}
