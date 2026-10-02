import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

const CAMPOS = ["tesis", "toma_ganancia_pct", "stop_revision_pct", "tasa_anual", "en_politica"] as const;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  const cambios: Record<string, unknown> = {};
  for (const campo of CAMPOS) if (campo in body) cambios[campo] = body[campo] === "" ? null : body[campo];
  if (Object.keys(cambios).length === 0) return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });

  const { data, error } = await supabase
    .from("activos")
    .update(cambios)
    .eq("id", id)
    .eq("usuario_id", user.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ activo: data });
}
