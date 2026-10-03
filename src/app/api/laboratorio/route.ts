import { NextResponse } from "next/server";
import { obtenerPanelEnVivo } from "@/lib/laboratorio/panelData";
import { crearClienteServidor } from "@/lib/supabase/server";

// Panel en vivo del laboratorio (SIMULADO). Con la sesión del usuario y RLS; no usa service_role.
export async function GET() {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.json({ panel: await obtenerPanelEnVivo(supabase, user.id) });
}
