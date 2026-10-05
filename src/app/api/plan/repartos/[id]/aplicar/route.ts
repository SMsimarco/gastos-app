import { after, NextRequest, NextResponse } from "next/server";
import { crearClienteServicio, crearClienteServidor } from "@/lib/supabase/server";
import { enviarAvisosAprender } from "@/lib/inversiones/aprenderAvisos";
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
    const resultado = await aplicarRepartoUsuario(supabase, user.id, id, tcUsado);
    // Después de responder: si aprender llegó al mínimo, avisa por push y Telegram. Usa service_role porque manda
    // push y escribe alertas_enviadas; filtra siempre por el usuario_id de la sesión. Nunca rompe el reparto.
    after(async () => {
      await enviarAvisosAprender(crearClienteServicio(), user.id);
    });
    return NextResponse.json(resultado);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "No pude aplicar el reparto";
    return NextResponse.json({ error: mensaje }, { status: mensaje === "No encontrado" ? 404 : 409 });
  }
}
