import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor, crearClienteServicio } from "@/lib/supabase/server";
import { extraerMovimientos } from "@/lib/gemini";
import { guardarMovimiento } from "@/lib/movimientos";
import { notificarTelegram } from "@/lib/telegram";

export async function POST(request: NextRequest) {
  const supabaseAuth = await crearClienteServidor();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const formData = await request.formData();
  const texto = formData.get("texto") as string | null;
  const audio = formData.get("audio") as File | null;
  const foto = formData.get("foto") as File | null;

  let base64Data: string | undefined;
  let mimeType: string | undefined;
  let fuente: "audio" | "texto" | "foto" = "texto";

  if (audio) {
    const buffer = Buffer.from(await audio.arrayBuffer());
    base64Data = buffer.toString("base64");
    mimeType = audio.type || "audio/webm";
    fuente = "audio";
  } else if (foto) {
    const buffer = Buffer.from(await foto.arrayBuffer());
    base64Data = buffer.toString("base64");
    mimeType = foto.type || "image/jpeg";
    fuente = "foto";
  } else if (!texto) {
    return NextResponse.json({ error: "Mandá audio, foto o texto" }, { status: 400 });
  }

  let movimientos;
  try {
    movimientos = await extraerMovimientos({
      base64Data,
      mimeType,
      textoMensaje: texto ?? undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error llamando a Gemini" },
      { status: 502 }
    );
  }

  const supabaseServicio = crearClienteServicio();
  const resultados = [];

  for (const item of movimientos) {
    if (item.confianza === "baja") {
      resultados.push({ ...item, guardado: false });
      continue;
    }

    try {
      const guardado = await guardarMovimiento(supabaseServicio, item, fuente, user.id);
      resultados.push({ guardado: true, ...guardado });
      await notificarTelegram(
        `✅ Registrado desde la app\n${guardado.categoriaEmoji} ${guardado.categoriaNombre} — ${guardado.descripcion}\n$${guardado.monto_ars} · ${guardado.fecha}`,
        user.email ?? ""
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Error guardando el movimiento" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ resultados });
}
