import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { descartarRepartoUsuario } from "@/lib/planData";

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

  try {
    return NextResponse.json(await descartarRepartoUsuario(supabase, user.id, id));
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "No pude descartar el reparto";
    return NextResponse.json({ error: mensaje }, { status: mensaje === "No encontrado" ? 404 : 409 });
  }
}
