import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

// Detalle de una corrida de un bot (SIMULADO): el briefing EXACTO que vio la IA y lo que respondió. Con la sesión
// del usuario y RLS: cada usuario solo puede abrir sus propias corridas.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });
  const { data, error } = await supabase
    .from("lab_corridas")
    .select("id, ts, disparador, modelo, tokens_entrada, tokens_salida, costo_usd, estado, error, briefing, respuesta_ia")
    .eq("usuario_id", user.id)
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  return NextResponse.json({ corrida: data });
}
