import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// Los endpoints /api/lab/* los llama pg_cron (Supabase) con `Authorization: Bearer <LAB_CRON_SECRET>`.
// Devuelve una respuesta de error si no está autorizado, o null si puede seguir.
export function validarSecretoLab(request: NextRequest): NextResponse | null {
  const secreto = process.env.LAB_CRON_SECRET;
  if (!secreto) return NextResponse.json({ error: "Falta LAB_CRON_SECRET" }, { status: 503 });
  const recibido = request.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secreto}`;
  const iguales = recibido.length === esperado.length && timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado));
  return iguales ? null : NextResponse.json({ error: "No autorizado" }, { status: 401 });
}
