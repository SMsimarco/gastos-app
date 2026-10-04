import { NextRequest, NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/server";
import { validarSecretoLab } from "@/lib/laboratorio/auth";
import { ejecutarAprendizaje } from "@/lib/laboratorio/aprendizaje";
import { ejecutarTareaLab } from "@/lib/laboratorio/recoleccion";

// Laboratorio (SIMULADO). Aprendizaje diario: señales de hoy, estadísticas de eventos (se recalculan
// una vez por semana) y el diario de mercado escrito por IA. Lo llama pg_cron con el header
// Authorization: Bearer LAB_CRON_SECRET. Usa service_role porque escribe tablas globales (sin usuario_id).
// `?forzar=estadisticas|diario|todo` fuerza esos pasos a mano.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const rechazo = validarSecretoLab(request);
  if (rechazo) return rechazo;
  const forzar = request.nextUrl.searchParams.get("forzar");
  const opciones = {
    forzarEstadisticas: forzar === "estadisticas" || forzar === "todo",
    forzarDiario: forzar === "diario" || forzar === "todo",
  };
  const { status, cuerpo } = await ejecutarTareaLab(crearClienteServicio(), "aprendizaje", (supabase) => ejecutarAprendizaje(supabase, opciones));
  return NextResponse.json(cuerpo, { status });
}
