import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data } = await supabase
    .from("presupuesto_general")
    .select("monto, actualizado_at")
    .eq("usuario_id", user.id)
    .maybeSingle();

  return NextResponse.json({ monto: data?.monto ?? null, actualizadoAt: data?.actualizado_at ?? null });
}

export async function PUT(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { monto } = await request.json();
  const montoNum = Number(monto);
  if (!montoNum || montoNum <= 0) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("presupuesto_general")
    .upsert({ usuario_id: user.id, monto: montoNum, actualizado_at: new Date().toISOString() })
    .select("monto, actualizado_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ monto: data.monto, actualizadoAt: data.actualizado_at });
}

export async function DELETE() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { error } = await supabase.from("presupuesto_general").delete().eq("usuario_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
