import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor, crearClienteServicio } from "@/lib/supabase/server";

const CAMPOS_EDITABLES = ["monto_ars", "categoria_id", "descripcion", "comercio", "metodo_pago"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabaseAuth = await crearClienteServidor();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const cambios: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (campo in body) cambios[campo] = body[campo];
  }
  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }

  const supabaseServicio = crearClienteServicio();

  if ("monto_ars" in cambios) {
    const { data: actual } = await supabaseServicio
      .from("movimientos")
      .select("moneda_origen, tc_usado")
      .eq("id", id)
      .eq("usuario_id", user.id)
      .single();

    if (actual?.tc_usado) {
      const montoArs = Number(cambios.monto_ars);
      cambios.monto_usd =
        actual.moneda_origen === "ARS"
          ? Number((montoArs / actual.tc_usado).toFixed(2))
          : Number((montoArs * actual.tc_usado).toFixed(2));
    }
  }

  const { data, error } = await supabaseServicio
    .from("movimientos")
    .update(cambios)
    .eq("id", id)
    .eq("usuario_id", user.id)
    .select("id, tipo, fecha, monto_ars, monto_usd, comercio, descripcion, metodo_pago, categoria_id, categorias(nombre, emoji)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ movimiento: data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabaseAuth = await crearClienteServidor();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const supabaseServicio = crearClienteServicio();
  const { error } = await supabaseServicio
    .from("movimientos")
    .delete()
    .eq("id", id)
    .eq("usuario_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
