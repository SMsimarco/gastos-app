const apiBase = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Falta TELEGRAM_BOT_TOKEN");
  return `https://api.telegram.org/bot${token}`;
};

async function llamarTelegram<T>(metodo: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${apiBase()}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await response.json() as { ok: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(data.description ?? `Telegram rechazó ${metodo}`);
  return data.result as T;
}

export async function enviarMensajeTelegram(
  chatId: number,
  texto: string,
  replyMarkup?: Record<string, unknown>
) {
  const partes = texto.match(/[\s\S]{1,4000}/g) ?? [texto];
  for (let i = 0; i < partes.length; i++) {
    await llamarTelegram("sendMessage", {
      chat_id: chatId,
      text: partes[i],
      ...(replyMarkup && i === partes.length - 1 ? { reply_markup: replyMarkup } : {}),
    });
  }
}

export async function responderCallbackTelegram(callbackQueryId: string, texto?: string) {
  await llamarTelegram("answerCallbackQuery", { callback_query_id: callbackQueryId, text: texto });
}

export async function descargarArchivoTelegram(fileId: string) {
  const archivo = await llamarTelegram<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!archivo.file_path) throw new Error("Telegram no devolvió la ruta del audio");
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${archivo.file_path}`);
  if (!response.ok) throw new Error("No pude descargar el audio de Telegram");
  return Buffer.from(await response.arrayBuffer());
}

export const tecladoRepartoTelegram = (repartoId: string) => ({
  inline_keyboard: [[
    { text: "✅ Ya lo hice en ARQ", callback_data: `reparto:aplicar:${repartoId}` },
    { text: "Descartar", callback_data: `reparto:descartar:${repartoId}` },
  ]],
});

