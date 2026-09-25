import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

const CLAVES_VALIDAS = ["gastos", "emergencia", "depto", "aprender"] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clave: string }> }
) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { clave } = await params;
  if (!CLAVES_VALIDAS.includes(clave as (typeof CLAVES_VALIDAS)[number])) {
    return NextResponse.json({ error: "Bolsillo inválido" }, { status: 400 });
  }

  const { saldo_real, tc_usado } = await request.json();
  if (saldo_real === undefined || saldo_real === null || Number.isNaN(Number(saldo_real))) {
    return NextResponse.json({ error: "Falta saldo_real" }, { status: 400 });
  }

  const { data: bolsillo } = await supabase
    .from("bolsillos")
    .select("id, saldo")
    .eq("usuario_id", user.id)
    .eq("clave", clave)
    .single();

  if (!bolsillo) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const diferencia = Number((Number(saldo_real) - bolsillo.saldo).toFixed(2));
  if (diferencia === 0) {
    return NextResponse.json({ ok: true, sinCambios: true });
  }

  const { error } = await supabase.rpc("aplicar_movimiento_bolsillo", {
    p_usuario_id: user.id,
    p_bolsillo_id: bolsillo.id,
    p_tipo: "ajuste",
    p_monto: diferencia,
    p_tc_usado: tc_usado ? Number(tc_usado) : null,
    p_reparto_id: null,
    p_nota: "Ajuste manual para cuadrar con el saldo real de ARQ",
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: actualizado } = await supabase
    .from("bolsillos")
    .select("id, clave, nombre, moneda, saldo, meta, orden")
    .eq("usuario_id", user.id)
    .eq("clave", clave)
    .single();

  return NextResponse.json({ bolsillo: actualizado });
}
