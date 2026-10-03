import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { aplicarRepartoUsuario } from "@/lib/planData";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const tcUsado = Number(body.tc_usado);
  if (!Number.isFinite(tcUsado) || tcUsado <= 0) {
    return NextResponse.json({ error: "tc_usado inválido" }, { status: 400 });
  }

  try {
    return NextResponse.json(await aplicarRepartoUsuario(supabase, user.id, id, tcUsado));
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "No pude aplicar el reparto";
    return NextResponse.json({ error: mensaje }, { status: mensaje === "No encontrado" ? 404 : 409 });
  }
}
