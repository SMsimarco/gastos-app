import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor, crearClienteServicio } from "@/lib/supabase/server";
import { urlFirmadaTicket } from "@/lib/storage";

export async function GET(
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

  const { data: movimiento } = await supabaseServicio
    .from("movimientos")
    .select("foto_path")
    .eq("id", id)
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (!movimiento?.foto_path) {
    return NextResponse.json({ error: "Sin foto" }, { status: 404 });
  }

  const url = await urlFirmadaTicket(supabaseServicio, movimiento.foto_path);
  if (!url) {
    return NextResponse.json({ error: "No pude generar la URL" }, { status: 500 });
  }

  return NextResponse.json({ url });
}
