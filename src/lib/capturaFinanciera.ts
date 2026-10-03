import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clasificarYExtraerAudio,
  clasificarYExtraerTexto,
  type Movimiento,
} from "@/lib/gemini";
import { obtenerListasCategorias } from "@/lib/categorias";
import { responderConsulta } from "@/lib/consultas";
import { guardarMovimiento } from "@/lib/movimientos";
import { chequearPresupuestoExcedido } from "@/lib/presupuestos";
import { enviarPush } from "@/lib/push";
import { generarRepartoParaIngreso, type RepartoRow, resumenRepartoTexto } from "@/lib/planData";
import { registrarOperacion } from "@/lib/inversiones/carteraData";
import { responderConsultaInversiones } from "@/lib/inversiones/consultasInversiones";

export type ResultadoCaptura =
  | { tipo: "consulta"; respuesta: string }
  | { tipo: "operacion"; guardado: boolean; operacion: unknown; necesitaAclaracion?: string }
  | { tipo: "registro"; resultados: Array<Record<string, unknown>>; reparto: RepartoRow | null };

export async function guardarMovimientosExtraidos(params: {
  supabase: SupabaseClient;
  usuarioId: string;
  movimientos: Movimiento[];
  fuente: "audio" | "texto" | "foto";
  fotoPath?: string | null;
}): Promise<ResultadoCaptura> {
  const { supabase, usuarioId, movimientos, fuente, fotoPath = null } = params;
  const resultados: Array<Record<string, unknown>> = [];
  let repartoGenerado: RepartoRow | null = null;

  for (const item of movimientos) {
    if (item.confianza === "baja") {
      resultados.push({ ...item, guardado: false });
      continue;
    }

    const guardado = await guardarMovimiento(supabase, item, fuente, usuarioId, fotoPath);
    resultados.push({ guardado: true, ...guardado });
    const infoCuotas = guardado.cuotas_total > 1 ? ` (cuota 1/${guardado.cuotas_total} de $${guardado.monto_ars})` : "";
    const infoDuplicado = guardado.posibleDuplicado ? " ⚠️ Parece un duplicado de otro gasto de hoy." : "";
    await enviarPush(supabase, usuarioId, {
      title: "Registrado",
      body: `${guardado.categoriaEmoji} ${guardado.descripcion}\n$${guardado.monto_ars} · ${guardado.fecha}${infoCuotas}${infoDuplicado}`,
    });

    if (guardado.tipo === "gasto" && guardado.categoria_id) {
      const excedido = await chequearPresupuestoExcedido(
        supabase, usuarioId, guardado.categoria_id, guardado.categoriaNombre, guardado.fecha, guardado.monto_ars
      );
      if (excedido) {
        await enviarPush(supabase, usuarioId, {
          title: "Te pasaste del presupuesto",
          body: `${excedido.categoriaNombre}: $${Math.round(excedido.gastado).toLocaleString("es-AR")} de $${Math.round(excedido.presupuesto).toLocaleString("es-AR")} este mes.`,
        });
      }
    }

    if (guardado.tipo === "ingreso" && guardado.categoriaNombre.toLocaleLowerCase("es-AR") === "clientes") {
      const cobroEnUsd = guardado.moneda_origen === "USD" && Number(guardado.monto_usd) > 0;
      repartoGenerado = await generarRepartoParaIngreso(
        supabase, usuarioId, guardado.id, guardado.monto_ars,
        cobroEnUsd ? { montoUsd: Number(guardado.monto_usd) } : {}
      );
      if (repartoGenerado) {
        await enviarPush(supabase, usuarioId, {
          title: cobroEnUsd
            ? `Cobraste US$${Number(guardado.monto_usd).toLocaleString("es-AR")}`
            : `Cobraste $${Math.round(guardado.monto_ars).toLocaleString("es-AR")}`,
          body: `${resumenRepartoTexto(repartoGenerado.detalle)}\nSugerencia según tu plan, no asesoramiento financiero.`,
        });
      }
    }
  }
  return { tipo: "registro", resultados, reparto: repartoGenerado };
}

export async function procesarEntradaFinanciera(params: {
  supabase: SupabaseClient;
  usuarioId: string;
  fuente: "audio" | "texto";
  texto?: string;
  base64Data?: string;
  mimeType?: string;
}): Promise<ResultadoCaptura> {
  const { supabase, usuarioId, fuente, texto, base64Data, mimeType } = params;
  const categorias = await obtenerListasCategorias(supabase, usuarioId);
  const resultado = fuente === "texto"
    ? await clasificarYExtraerTexto(texto ?? "", categorias)
    : await clasificarYExtraerAudio(base64Data ?? "", mimeType ?? "audio/ogg", categorias);

  if (resultado.intencion === "consulta") {
    return { tipo: "consulta", respuesta: await responderConsulta(supabase, usuarioId, resultado.pregunta) };
  }
  if (
    resultado.intencion === "consulta_inversiones" ||
    resultado.intencion === "consulta_plan" ||
    resultado.intencion === "pedir_sugerencia"
  ) {
    if (resultado.consulta.confianza === "baja") {
      return { tipo: "consulta", respuesta: "No entendí bien si querés consultar tu cartera, tu plan o pedir una sugerencia. ¿Me lo decís de otra forma?" };
    }
    return {
      tipo: "consulta",
      respuesta: await responderConsultaInversiones(supabase, usuarioId, resultado.intencion, resultado.consulta),
    };
  }
  if (resultado.intencion === "operacion") {
    const operacion = resultado.operacion;
    if (operacion.confianza === "baja" || !operacion.ticker || operacion.monto_usd <= 0 || (operacion.tipo !== "dividendo" && operacion.precio_usd <= 0)) {
      return { tipo: "operacion", guardado: false, necesitaAclaracion: "Necesito ticker, monto total y precio para registrar la operación.", operacion };
    }
    const guardada = await registrarOperacion(supabase, usuarioId, {
      ticker: operacion.ticker,
      tipo: operacion.tipo,
      fecha: operacion.fecha,
      cantidad: operacion.cantidad || undefined,
      precioUsd: operacion.precio_usd,
      montoUsd: operacion.monto_usd,
      comisionUsd: operacion.comision_usd,
      nota: operacion.transcripcion_raw,
    });
    return { tipo: "operacion", guardado: true, operacion: guardada };
  }
  if (resultado.intencion === "registro") {
    return guardarMovimientosExtraidos({ supabase, usuarioId, movimientos: resultado.movimientos, fuente });
  }
  throw new Error("Intención no soportada");
}
