// Integración con Gmail: OAuth (con refresh token) + lectura de mensajes.
// Todo por fetch directo a la API REST de Google, sin el SDK googleapis
// (pesado, no hace falta para esto).

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function credencialesOAuth() {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Falta configurar GOOGLE_GMAIL_CLIENT_ID / GOOGLE_GMAIL_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}

export function urlAutorizacion(redirectUri: string, state: string) {
  const { clientId } = credencialesOAuth();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent", // fuerza que Google reemita el refresh_token siempre
    scope: SCOPE,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function intercambiarCodigo(code: string, redirectUri: string): Promise<{ refreshToken: string }> {
  const { clientId, clientSecret } = credencialesOAuth();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange falló: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.refresh_token) {
    throw new Error("Google no devolvió refresh_token (¿ya estaba autorizado sin 'prompt=consent'?)");
  }
  return { refreshToken: data.refresh_token };
}

export async function obtenerAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = credencialesOAuth();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`No pude renovar el access token: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

export async function revocarToken(refreshToken: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => {}); // best-effort, si falla igual borramos el token local
}

async function gmailFetch(accessToken: string, path: string, init?: RequestInit) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Gmail API falló (${path}): ${res.status} ${await res.text()}`);
  return res.json();
}

// Busca o crea las dos etiquetas que usamos para no reprocesar mensajes.
export async function asegurarEtiquetas(
  accessToken: string,
  existentes: { procesado: string | null; omitido: string | null }
): Promise<{ procesado: string; omitido: string }> {
  if (existentes.procesado && existentes.omitido) {
    return { procesado: existentes.procesado, omitido: existentes.omitido };
  }

  const { labels } = await gmailFetch(accessToken, "/labels");
  const buscar = (nombre: string) => (labels ?? []).find((l: { name: string }) => l.name === nombre)?.id as
    | string
    | undefined;

  async function crear(nombre: string): Promise<string> {
    const existente = buscar(nombre);
    if (existente) return existente;
    const creada = await gmailFetch(accessToken, "/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nombre, labelListVisibility: "labelHide", messageListVisibility: "hide" }),
    });
    return creada.id;
  }

  const procesado = existentes.procesado ?? (await crear("gastos-voz/procesado"));
  const omitido = existentes.omitido ?? (await crear("gastos-voz/omitido"));
  return { procesado, omitido };
}

export type MensajeGmail = { id: string; asunto: string; texto: string; fecha: string };

export async function listarMensajesNuevos(
  accessToken: string,
  remitentes: string[],
  labelProcesadoId: string,
  labelOmitidoId: string
): Promise<string[]> {
  const remitentesQuery = remitentes.map((r) => `from:${r}`).join(" OR ");
  const q = `(${remitentesQuery}) newer_than:7d -label:${labelProcesadoId} -label:${labelOmitidoId}`;
  const data = await gmailFetch(accessToken, `/messages?q=${encodeURIComponent(q)}&maxResults=25`);
  return (data.messages ?? []).map((m: { id: string }) => m.id);
}

function decodificarBase64Url(data: string): string {
  const normal = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normal, "base64").toString("utf-8");
}

function extraerTextoDePayload(payload: unknown): { plano: string | null; html: string | null } {
  let plano: string | null = null;
  let html: string | null = null;

  function recorrer(parte: {
    mimeType?: string;
    body?: { data?: string };
    parts?: unknown[];
  }) {
    if (parte.mimeType === "text/plain" && parte.body?.data && !plano) {
      plano = decodificarBase64Url(parte.body.data);
    } else if (parte.mimeType === "text/html" && parte.body?.data && !html) {
      html = decodificarBase64Url(parte.body.data);
    }
    if (parte.parts) {
      for (const sub of parte.parts) recorrer(sub as typeof parte);
    }
  }

  recorrer(payload as Parameters<typeof recorrer>[0]);
  return { plano, html };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export async function obtenerMensaje(accessToken: string, id: string): Promise<MensajeGmail> {
  const data = await gmailFetch(accessToken, `/messages/${id}?format=full`);
  const headers: Array<{ name: string; value: string }> = data.payload?.headers ?? [];
  const asunto = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";

  const { plano, html } = extraerTextoDePayload(data.payload);
  const texto = (plano ?? (html ? stripHtml(html) : data.snippet ?? "")).slice(0, 4000);

  return { id, asunto, texto, fecha: data.internalDate };
}

export async function etiquetarMensaje(accessToken: string, id: string, labelId: string): Promise<void> {
  await gmailFetch(accessToken, `/messages/${id}/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
}
