import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { validarPesos } from "@/lib/inversiones/aprenderActivos";

// Edita los pesos del puntaje de aprender (suman 100) y el flag usar_historial_bots.
export async function PATCH(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  const cambios: Record<string, unknown> = {};
  if ("pesos" in body) {
    const validado = validarPesos(body.pesos ?? {});
    if (!validado.ok) return NextResponse.json({ error: validado.error }, { status: 400 });
    Object.assign(cambios, validado.pesos);
  }
  if ("usarHistorialBots" in body) cambios.usar_historial_bots = body.usarHistorialBots === true;
  if (Object.keys(cambios).length === 0) return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });

  const { data, error } = await supabase.from("config_plan").update(cambios).eq("usuario_id", user.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ config: data });
}
