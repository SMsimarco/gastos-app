import { NextRequest, NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/server";
import { validarSecretoLab } from "@/lib/laboratorio/auth";
import { ejecutarFundamentales, ejecutarTareaLab } from "@/lib/laboratorio/recoleccion";

// Laboratorio (SIMULADO). Fundamentales, analistas, sorpresas, insiders (Finnhub) y hechos
// materiales de la SEC. Lo llama pg_cron con el header Authorization: Bearer LAB_CRON_SECRET.
// Usa service_role porque escribe tablas globales de datos de mercado (sin usuario_id).
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const rechazo = validarSecretoLab(request);
  if (rechazo) return rechazo;
  const { status, cuerpo } = await ejecutarTareaLab(crearClienteServicio(), "fundamentales", ejecutarFundamentales);
  return NextResponse.json(cuerpo, { status });
}
