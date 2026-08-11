import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const { monto } = await request.json();
  if (!monto || monto <= 0) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }

  const { data: meta } = await supabase
    .from("metas_ahorro")
    .select("monto_actual")
    .eq("id", id)
    .eq("usuario_id", user.id)
    .single();

  if (!meta) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const { data, error } = await supabase
    .from("metas_ahorro")
    .update({ monto_actual: meta.monto_actual + Number(monto) })
    .eq("id", id)
    .eq("usuario_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ meta: data });
}
