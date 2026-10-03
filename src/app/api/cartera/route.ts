import { NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { obtenerCartera } from "@/lib/inversiones/carteraData";

export async function GET() {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    return NextResponse.json(await obtenerCartera(supabase, user.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No pude calcular la cartera" }, { status: 500 });
  }
}
