import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

// Comprime la foto del ticket para no gastar almacenamiento: max 1000px de ancho, JPEG calidad 65.
export async function subirFotoTicket(
  supabase: SupabaseClient,
  usuarioId: string,
  buffer: Buffer
): Promise<string | null> {
  try {
    const comprimida = await sharp(buffer)
      .resize({ width: 1000, withoutEnlargement: true })
      .jpeg({ quality: 65 })
      .toBuffer();

    const path = `${usuarioId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

    const { error } = await supabase.storage.from("tickets").upload(path, comprimida, {
      contentType: "image/jpeg",
      upsert: false,
    });

    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

export async function urlFirmadaTicket(
  supabase: SupabaseClient,
  path: string
): Promise<string | null> {
  const { data } = await supabase.storage.from("tickets").createSignedUrl(path, 60);
  return data?.signedUrl ?? null;
}
