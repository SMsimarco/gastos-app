import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor, crearClienteServicio } from "@/lib/supabase/server";
import { extraerMovimientos, clasificarYExtraerTexto, type Movimiento } from "@/lib/gemini";
import { guardarMovimiento } from "@/lib/movimientos";
import { chequearPresupuestoExcedido } from "@/lib/presupuestos";
import { responderConsulta } from "@/lib/consultas";
import { enviarPush } from "@/lib/push";
import { obtenerListasCategorias } from "@/lib/categorias";
import { subirFotoTicket } from "@/lib/storage";

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
  let fotoBuffer: Buffer | undefined;

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
    fotoBuffer = buffer;
  } else if (!texto) {
    return NextResponse.json({ error: "Mandá audio, foto o texto" }, { status: 400 });
  }

  const supabaseServicio = crearClienteServicio();
  const categorias = await obtenerListasCategorias(supabaseServicio, user.id);

  let movimientos: Movimiento[];
  try {
    if (fuente === "texto" && texto) {
      const resultado = await clasificarYExtraerTexto(texto, categorias);
      if (resultado.intencion === "consulta") {
        const respuesta = await responderConsulta(supabaseServicio, user.id, resultado.pregunta);
        return NextResponse.json({ tipo: "consulta", respuesta });
      }
      movimientos = resultado.movimientos;
    } else {
      movimientos = await extraerMovimientos({ base64Data, mimeType, textoMensaje: texto ?? undefined, categorias });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error llamando a Gemini" },
      { status: 502 }
    );
  }

  const fotoPath = fotoBuffer ? await subirFotoTicket(supabaseServicio, user.id, fotoBuffer) : null;

  const resultados = [];

  for (const item of movimientos) {
    if (item.confianza === "baja") {
      resultados.push({ ...item, guardado: false });
      continue;
    }

    try {
      const guardado = await guardarMovimiento(supabaseServicio, item, fuente, user.id, fotoPath);
      resultados.push({ guardado: true, ...guardado });

      const infoCuotas =
        guardado.cuotas_total > 1 ? ` (cuota 1/${guardado.cuotas_total} de $${guardado.monto_ars})` : "";
      const infoDuplicado = guardado.posibleDuplicado ? " ⚠️ Parece un duplicado de otro gasto de hoy." : "";

      await enviarPush(supabaseServicio, user.id, {
        title: "Registrado",
        body: `${guardado.categoriaEmoji} ${guardado.descripcion}\n$${guardado.monto_ars} · ${guardado.fecha}${infoCuotas}${infoDuplicado}`,
      });

      if (guardado.tipo === "gasto" && guardado.categoria_id) {
        const excedido = await chequearPresupuestoExcedido(
          supabaseServicio,
          user.id,
          guardado.categoria_id,
          guardado.categoriaNombre,
          guardado.fecha,
          guardado.monto_ars
        );
        if (excedido) {
          await enviarPush(supabaseServicio, user.id, {
            title: "Te pasaste del presupuesto",
            body: `${excedido.categoriaNombre}: $${Math.round(excedido.gastado).toLocaleString("es-AR")} de $${Math.round(excedido.presupuesto).toLocaleString("es-AR")} este mes.`,
          });
        }
      }
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Error guardando el movimiento" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ tipo: "registro", resultados });
}
