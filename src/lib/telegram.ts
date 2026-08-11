export async function notificarTelegram(texto: string, emailUsuario: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.MY_TELEGRAM_CHAT_ID;
  const emailAdmin = process.env.ADMIN_EMAIL;

  // Solo mandamos a tu Telegram si sos vos el que actuó. Para otros usuarios
  // no hay chat_id asociado todavía (pendiente: vincular Telegram por usuario).
  if (!token || !chatId || !emailAdmin || emailUsuario !== emailAdmin) return;

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
