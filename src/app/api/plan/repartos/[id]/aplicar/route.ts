import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import type { ResultadoReparto } from "@/lib/plan";

const CLAVES = ["gastos", "emergencia", "depto", "aprender"] as const;

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
  const body = await request.json().catch(() => ({}));

  const { data: reparto } = await supabase
    .from("repartos")
    .select("id, monto_ars, tc_referencia, detalle, estado")
    .eq("id", id)
    .eq("usuario_id", user.id)
    .single();

  if (!reparto) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (reparto.estado !== "pendiente") {
    return NextResponse.json({ error: "Este reparto ya no está pendiente" }, { status: 400 });
  }

  const tcUsado = body.tc_usado ? Number(body.tc_usado) : reparto.tc_referencia;
  if (!tcUsado || tcUsado <= 0) {
    return NextResponse.json({ error: "tc_usado inválido" }, { status: 400 });
  }

  const detalle = reparto.detalle as ResultadoReparto;

  const { data: bolsillos } = await supabase.from("bolsillos").select("id, clave").eq("usuario_id", user.id);
  const idPorClave = new Map((bolsillos ?? []).map((b) => [b.clave, b.id]));

  for (const clave of CLAVES) {
    const monto = detalle[clave];
    if (!monto || monto <= 0) continue;
    const bolsilloId = idPorClave.get(clave);
    if (!bolsilloId) continue;

    const { error } = await supabase.rpc("aplicar_movimiento_bolsillo", {
      p_usuario_id: user.id,
      p_bolsillo_id: bolsilloId,
      p_tipo: "aporte",
      p_monto: monto,
      p_tc_usado: clave === "gastos" ? null : tcUsado,
      p_reparto_id: reparto.id,
      p_nota: `Reparto de ingreso de $${Math.round(reparto.monto_ars).toLocaleString("es-AR")}`,
    });
    if (error) {
      return NextResponse.json({ error: `No pude aplicar ${clave}: ${error.message}` }, { status: 500 });
    }
  }

  const { data: repartoActualizado, error: errorUpdate } = await supabase
    .from("repartos")
    .update({ estado: "aplicado", aplicado_at: new Date().toISOString() })
    .eq("id", reparto.id)
    .eq("usuario_id", user.id)
    .select()
    .single();

  if (errorUpdate) {
    return NextResponse.json({ error: errorUpdate.message }, { status: 500 });
  }

  const { data: bolsillosActualizados } = await supabase
    .from("bolsillos")
    .select("id, clave, nombre, moneda, saldo, meta, orden")
    .eq("usuario_id", user.id)
    .order("orden");

  return NextResponse.json({ reparto: repartoActualizado, bolsillos: bolsillosActualizados ?? [] });
}
