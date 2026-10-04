import { NextRequest, NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/server";
import { validarSecretoLab } from "@/lib/laboratorio/auth";
import { ejecutarCierre } from "@/lib/laboratorio/bots/cierre";
import { ejecutarTareaLab } from "@/lib/laboratorio/recoleccion";

// Laboratorio (SIMULADO). Cierre del día: guarda el valor de cada bot y del benchmark VOO, y concilia las
// órdenes que no se habían ejecutado. Lo llama pg_cron con Authorization: Bearer LAB_CRON_SECRET.
// Usa service_role porque corre sin sesión; las consultas por usuario filtran usuario_id a mano.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const rechazo = validarSecretoLab(request);
  if (rechazo) return rechazo;
  const { status, cuerpo } = await ejecutarTareaLab(crearClienteServicio(), "cierre", ejecutarCierre);
  return NextResponse.json(cuerpo, { status });
}
