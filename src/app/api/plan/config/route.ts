import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

const CAMPOS_EDITABLES = [
  "meses_emergencia",
  "meses_cobertura_gastos",
  "pct_depto",
  "gasto_mensual_manual",
  "umbral_compra_usd",
] as const;

export async function PATCH(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const cambios: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (campo in body) cambios[campo] = body[campo] === "" ? null : body[campo];
  }
  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("config_plan")
    .update(cambios)
    .eq("usuario_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}
