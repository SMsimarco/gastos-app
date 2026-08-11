export async function notificarTelegram(texto: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.MY_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: texto }),
    });
  } catch {
    // notificacion best-effort, no debe romper el flujo principal
  }
}
