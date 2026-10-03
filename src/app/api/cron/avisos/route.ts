import { NextRequest, NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/server";
import { obtenerContextoInversiones } from "@/lib/inversiones/consultasInversiones";
import { generarSugerencias } from "@/lib/inversiones/sugerencias";
import { candidatosDesdeSugerencias, DISCLAIMER_FINANCIERO, seleccionarAvisos, type CandidatoAviso } from "@/lib/inversiones/avisos";
import { enviarMensajeTelegram } from "@/lib/telegram";

export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const supabase = crearClienteServicio();
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const ayer = new Date(Date.now() - 36 * 60 * 60_000).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const limiteReparto = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data: vinculos, error } = await supabase.from("telegram_vinculos").select("usuario_id, chat_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let enviados = 0;

  for (const vinculo of vinculos ?? []) {
    try {
      const contexto = await obtenerContextoInversiones(supabase, vinculo.usuario_id);
      const candidatos = candidatosDesdeSugerencias(generarSugerencias(contexto.estado));
      const { data: bolsilloEmergencia } = await supabase.from("bolsillos").select("id").eq("usuario_id", vinculo.usuario_id).eq("clave", "emergencia").maybeSingle();
      if (bolsilloEmergencia && contexto.estado.emergencia.saldoUsd < contexto.estado.emergencia.metaUsd) {
        const { data: retiro } = await supabase.from("movimientos_bolsillo").select("id").eq("usuario_id", vinculo.usuario_id).eq("bolsillo_id", bolsilloEmergencia.id).lt("monto", 0).gte("created_at", `${ayer}T03:00:00Z`).limit(1).maybeSingle();
        if (retiro) candidatos.push({ clave: `emergencia:retiro:${retiro.id}`, categoria: "emergencia", soloUnaVez: true, mensaje: `Tu fondo de emergencia quedó en US$${contexto.estado.emergencia.saldoUsd.toFixed(2)}, debajo de la meta de US$${contexto.estado.emergencia.metaUsd.toFixed(2)} después de un retiro.` });
      }
      const { data: repartos } = await supabase.from("repartos").select("id, monto_ars").eq("usuario_id", vinculo.usuario_id).eq("estado", "pendiente").lt("created_at", limiteReparto).order("created_at");
      for (const reparto of repartos ?? []) candidatos.push({ clave: `reparto:${reparto.id}`, categoria: "reparto", soloUnaVez: true, mensaje: `Tenés un reparto pendiente de $${Math.round(Number(reparto.monto_ars)).toLocaleString("es-AR")} desde hace más de 3 días.` });

      const { data: historial } = await supabase.from("alertas_enviadas").select("clave, fecha").eq("usuario_id", vinculo.usuario_id);
      const hoyClaves = new Set((historial ?? []).filter((a) => a.fecha === hoy).map((a) => a.clave));
      const todasClaves = new Set((historial ?? []).map((a) => a.clave));
      const elegidos = seleccionarAvisos(candidatos as CandidatoAviso[], hoyClaves, todasClaves);
      for (const aviso of elegidos) {
        const { error: errorReserva } = await supabase.from("alertas_enviadas").insert({ usuario_id: vinculo.usuario_id, clave: aviso.clave, fecha: hoy });
        if (errorReserva) continue;
        try {
          await enviarMensajeTelegram(Number(vinculo.chat_id), `${aviso.mensaje}\n\n${DISCLAIMER_FINANCIERO}`);
          enviados++;
        } catch (errorEnvio) {
          await supabase.from("alertas_enviadas").delete().eq("usuario_id", vinculo.usuario_id).eq("clave", aviso.clave).eq("fecha", hoy);
          throw errorEnvio;
        }
      }
    } catch (errorUsuario) {
      console.error("Aviso Telegram falló", vinculo.usuario_id, errorUsuario instanceof Error ? errorUsuario.message : errorUsuario);
    }
  }
  return NextResponse.json({ ok: true, usuarios: vinculos?.length ?? 0, enviados });
}

