import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor, crearClienteServicio } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabaseAuth = await crearClienteServidor();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { endpoint, keys } = await request.json();
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: "Suscripción inválida" }, { status: 400 });
  }

  const supabaseServicio = crearClienteServicio();
  const { error } = await supabaseServicio.from("push_subscriptions").upsert(
    {
      usuario_id: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const supabaseAuth = await crearClienteServidor();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { endpoint } = await request.json();
  const supabaseServicio = crearClienteServicio();
  await supabaseServicio
    .from("push_subscriptions")
    .delete()
    .eq("usuario_id", user.id)
    .eq("endpoint", endpoint);

  return NextResponse.json({ ok: true });
}
