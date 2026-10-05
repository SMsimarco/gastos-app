import { NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { obtenerPanelAprender } from "@/lib/inversiones/aprenderPanel";

// Panel de "Aprender" (Fase 7): saldo, candidatos con su ficha, lista de activos, rendimiento contra VOO y lo que
// aprendió el asesor. Solo lectura, con la sesión del usuario (RLS).
export async function GET() {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  try {
    return NextResponse.json(await obtenerPanelAprender(supabase, user.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No pude armar el panel de aprender" }, { status: 500 });
  }
}
