import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

const CAMPOS_EDITABLES = [
  "pct_gastos", "pct_largo_plazo", "pct_aprender", "emergencia_primero",
  "meses_emergencia", "gasto_mensual_manual", "minimo_compra_usd",
  "fecha_objetivo_depto", "monto_objetivo_depto_usd", "anios_transicion",
] as const;

export async function PATCH(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  const cambios: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (campo in body) cambios[campo] = body[campo] === "" ? null : body[campo];
  }
  if (Object.keys(cambios).length === 0) return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });

  const porcentajes = ["pct_gastos", "pct_largo_plazo", "pct_aprender"] as const;
  if (porcentajes.some((campo) => campo in cambios)) {
    const { data: actual } = await supabase
      .from("config_plan")
      .select("pct_gastos, pct_largo_plazo, pct_aprender")
      .eq("usuario_id", user.id)
      .single();
    const valores = porcentajes.map((campo) => Number(cambios[campo] ?? actual?.[campo]));
    if (!valores.every((valor) => Number.isInteger(valor) && valor >= 0 && valor <= 100) || valores.reduce((a, b) => a + b, 0) !== 100) {
      return NextResponse.json({ error: "Los porcentajes deben ser enteros y sumar 100" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("config_plan")
    .update(cambios)
    .eq("usuario_id", user.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ config: data });
}
