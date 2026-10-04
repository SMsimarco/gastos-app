import { NextRequest, NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/server";
import { validarSecretoLab } from "@/lib/laboratorio/auth";
import { esClaveDeBot } from "@/lib/laboratorio/bots/gestion";
import { ejecutarDecisiones } from "@/lib/laboratorio/bots/ejecutar";
import { ejecutarTareaLab } from "@/lib/laboratorio/recoleccion";

// Laboratorio (SIMULADO). Decisión diaria de los bots (paper trading, plata ficticia). La llama pg_cron con
// Authorization: Bearer LAB_CRON_SECRET varias veces dentro de la ventana de la mañana: la corrida es
// idempotente (una decisión por bot y por día). Usa service_role porque corre sin sesión; todas las
// consultas por usuario filtran usuario_id a mano.
// `?simular=1` arma el briefing, llama a la IA y aplica el riesgo SIN enviar órdenes; `?forzar=1` ignora
// la ventana horaria (el mercado igual tiene que estar abierto); `?clave=A|B|C` corre un solo bot.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const rechazo = validarSecretoLab(request);
  if (rechazo) return rechazo;
  const parametros = request.nextUrl.searchParams;
  const clave = parametros.get("clave")?.toUpperCase() ?? "";
  const { status, cuerpo } = await ejecutarTareaLab(crearClienteServicio(), "decidir", (supabase) =>
    ejecutarDecisiones(supabase, {
      disparador: "diaria",
      simular: parametros.get("simular") === "1",
      ignorarVentana: parametros.get("forzar") === "1",
      clave: esClaveDeBot(clave) ? clave : undefined,
    })
  );
  return NextResponse.json(cuerpo, { status });
}
