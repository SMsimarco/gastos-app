import { NextRequest, NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/server";
import { procesarUpdateTelegram, type TelegramUpdate } from "@/lib/telegramBot";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const secreto = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secreto || request.headers.get("x-telegram-bot-api-secret-token") !== secreto) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const update = await request.json() as TelegramUpdate;
  if (!Number.isSafeInteger(update.update_id)) return NextResponse.json({ error: "Update inválido" }, { status: 400 });
  const supabase = crearClienteServicio();
  const { error: duplicado } = await supabase.from("telegram_updates").insert({ update_id: update.update_id });
  if (duplicado?.code === "23505") return NextResponse.json({ ok: true, duplicado: true });
  if (duplicado) return NextResponse.json({ error: duplicado.message }, { status: 500 });
  try {
    await procesarUpdateTelegram(supabase, update);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error procesando update de Telegram", error instanceof Error ? error.message : error);
    // Conservamos la reserva del update y devolvemos 2xx: ante una falla posterior
    // a una escritura, un reintento de Telegram no debe duplicar el movimiento.
    return NextResponse.json({ ok: false, error: "No pude procesar el mensaje" });
  }
}

