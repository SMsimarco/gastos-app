import { NextRequest, NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/server";
import { validarSecretoLab } from "@/lib/laboratorio/auth";
import { ejecutarJobAprender } from "@/lib/inversiones/aprenderJob";

// Asesor de aprender (Fase 7): job diario después del cierre. Lo llama pg_cron (scripts/lab-pg-cron.sql) con
// Authorization: Bearer LAB_CRON_SECRET, igual que los endpoints del laboratorio. No escribe ninguna tabla lab_*.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const rechazo = validarSecretoLab(request);
  if (rechazo) return rechazo;
  try {
    return NextResponse.json(await ejecutarJobAprender(crearClienteServicio()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error desconocido" }, { status: 500 });
  }
}
