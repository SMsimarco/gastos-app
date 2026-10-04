import { NextRequest, NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/server";
import { esDomingoEnArgentina, DISCLAIMER_FINANCIERO } from "@/lib/inversiones/avisos";
import { obtenerContextoInversiones } from "@/lib/inversiones/consultasInversiones";
import { enviarMensajeTelegram } from "@/lib/telegram";
import { resumenSemanalLab } from "@/lib/laboratorio/bots/avisos";

export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!esDomingoEnArgentina(new Date())) return NextResponse.json({ ok: true, omitido: "No es domingo en Argentina" });
  const supabase = crearClienteServicio();
  const desde = new Date(Date.now() - 7 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const { data: vinculos } = await supabase.from("telegram_vinculos").select("usuario_id, chat_id");
  let enviados = 0;
  for (const vinculo of vinculos ?? []) {
    try {
      const [contexto, { data: gastos }] = await Promise.all([
        obtenerContextoInversiones(supabase, vinculo.usuario_id),
        supabase.from("movimientos").select("monto_ars").eq("usuario_id", vinculo.usuario_id).eq("tipo", "gasto").gte("fecha", desde),
      ]);
      const gastoSemana = (gastos ?? []).reduce((total, gasto) => total + Number(gasto.monto_ars), 0);
      const promedioSemana = (contexto.gastoMensual.valor ?? 0) / 4.345;
      const pctDepto = contexto.config.monto_objetivo_depto_usd
        ? Math.min(100, (contexto.cartera.total.valorUsd / Number(contexto.config.monto_objetivo_depto_usd)) * 100) : null;
      // Tabla de posiciones del laboratorio simulado (si está activo). Si falla, el resumen sale igual.
      const lineasLab = await resumenSemanalLab(supabase, vinculo.usuario_id).catch(() => []);
      const texto = [
        "📊 Resumen semanal",
        `Gastos: $${Math.round(gastoSemana).toLocaleString("es-AR")} (${promedioSemana > 0 ? `${gastoSemana <= promedioSemana ? "dentro" : "por encima"} del promedio semanal` : "sin promedio configurado"}).`,
        `Cartera: US$${contexto.cartera.total.valorUsd.toFixed(2)} · ganancia acumulada ${contexto.cartera.total.gananciaPct.toFixed(2)}%.`,
        pctDepto === null ? "Objetivo depto: falta cargar el monto objetivo." : `Objetivo depto: ${pctDepto.toFixed(1)}% alcanzado.`,
        ...(lineasLab.length > 0 ? ["", ...lineasLab] : []),
        "",
        DISCLAIMER_FINANCIERO,
      ].join("\n");
      await enviarMensajeTelegram(Number(vinculo.chat_id), texto);
      enviados++;
    } catch (errorUsuario) {
      console.error("Resumen Telegram falló", vinculo.usuario_id, errorUsuario instanceof Error ? errorUsuario.message : errorUsuario);
    }
  }
  return NextResponse.json({ ok: true, enviados });
}

