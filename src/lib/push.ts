import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

let configurado = false;

function asegurarConfig() {
  if (configurado) return;
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_SUBJECT_EMAIL ?? "no-reply@gastos-voz.app"}`,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  configurado = true;
}

export async function enviarPush(
  supabaseServicio: SupabaseClient,
  usuarioId: string,
  payload: { title: string; body: string }
) {
  if (!process.env.VAPID_PRIVATE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
  asegurarConfig();

  const { data: subs } = await supabaseServicio
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("usuario_id", usuarioId);

  if (!subs || subs.length === 0) return;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload)
        );
      } catch (error: unknown) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await supabaseServicio.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    })
  );
}
