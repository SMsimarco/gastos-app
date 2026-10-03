import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor, crearClienteServicio } from "@/lib/supabase/server";
import { extraerMovimientos } from "@/lib/gemini";
import { obtenerListasCategorias } from "@/lib/categorias";
import { subirFotoTicket } from "@/lib/storage";
import { guardarMovimientosExtraidos, procesarEntradaFinanciera } from "@/lib/capturaFinanciera";

export async function POST(request: NextRequest) {
  const supabaseAuth = await crearClienteServidor();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const formData = await request.formData();
  const texto = formData.get("texto") as string | null;
  const audio = formData.get("audio") as File | null;
  const foto = formData.get("foto") as File | null;
  if (!texto && !audio && !foto) {
    return NextResponse.json({ error: "Mandá audio, foto o texto" }, { status: 400 });
  }

  const supabase = crearClienteServicio();
  try {
    if (audio) {
      const buffer = Buffer.from(await audio.arrayBuffer());
      return NextResponse.json(await procesarEntradaFinanciera({
        supabase, usuarioId: user.id, fuente: "audio",
        base64Data: buffer.toString("base64"), mimeType: audio.type || "audio/webm",
      }));
    }
    if (texto) {
      return NextResponse.json(await procesarEntradaFinanciera({
        supabase, usuarioId: user.id, fuente: "texto", texto,
      }));
    }

    const buffer = Buffer.from(await foto!.arrayBuffer());
    const categorias = await obtenerListasCategorias(supabase, user.id);
    const movimientos = await extraerMovimientos({
      base64Data: buffer.toString("base64"), mimeType: foto!.type || "image/jpeg", categorias,
    });
    const fotoPath = await subirFotoTicket(supabase, user.id, buffer);
    return NextResponse.json(await guardarMovimientosExtraidos({
      supabase, usuarioId: user.id, movimientos, fuente: "foto", fotoPath,
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No pude procesar la captura" },
      { status: 502 }
    );
  }
}
