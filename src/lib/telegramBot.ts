import type { SupabaseClient } from "@supabase/supabase-js";
import { procesarEntradaFinanciera, type ResultadoCaptura } from "@/lib/capturaFinanciera";
import { obtenerContextoInversiones, responderConsultaInversiones } from "@/lib/inversiones/consultasInversiones";
import { aplicarRepartoUsuario, descartarRepartoUsuario, obtenerUltimoMep, resumenRepartoTexto } from "@/lib/planData";
import { descargarArchivoTelegram, enviarMensajeTelegram, responderCallbackTelegram, tecladoRepartoTelegram } from "@/lib/telegram";

type TelegramMessage = {
  chat: { id: number; type: string };
  text?: string;
  voice?: { file_id: string; mime_type?: string };
  audio?: { file_id: string; mime_type?: string };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    data?: string;
    message?: TelegramMessage;
  };
};

const DISCLAIMER = "Sugerencia según tu plan, no asesoramiento financiero.";

function textoResultado(resultado: ResultadoCaptura): string {
  if (resultado.tipo === "consulta") return resultado.respuesta;
  if (resultado.tipo === "operacion") {
    return resultado.guardado ? "✅ Operación registrada en tu cartera." : `⚠️ ${resultado.necesitaAclaracion}`;
  }
  if (resultado.resultados.length === 0) return "No encontré un movimiento para registrar.";
  return resultado.resultados.map((item) => {
    if (!item.guardado) return `⚠️ Necesito más datos para “${String(item.descripcion ?? "ese movimiento")}”.`;
    const simbolo = item.tipo === "ingreso" ? "+$" : "-$";
    return `✅ ${String(item.categoriaEmoji ?? "")} ${String(item.descripcion ?? "Registrado")} · ${simbolo}${Math.round(Number(item.monto_ars ?? 0)).toLocaleString("es-AR")}`;
  }).join("\n");
}

async function consultaComando(supabase: SupabaseClient, usuarioId: string, comando: string) {
  if (comando === "/resumen") {
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
    const contexto = await obtenerContextoInversiones(supabase, usuarioId);
    const { data: gastos } = await supabase.from("movimientos").select("monto_ars").eq("usuario_id", usuarioId).eq("tipo", "gasto").gte("fecha", `${hoy.slice(0, 7)}-01`).lte("fecha", hoy);
    const totalGastos = (gastos ?? []).reduce((total, item) => total + Number(item.monto_ars), 0);
    const bolsillos = contexto.bolsillos.map((item) => `${item.nombre}: ${item.moneda === "ARS" ? "$" : "US$"}${Number(item.saldo).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`).join(" · ");
    return `Gastos del mes: $${Math.round(totalGastos).toLocaleString("es-AR")}\nBolsillos: ${bolsillos || "sin datos"}\nCartera: US$${contexto.cartera.total.valorUsd.toFixed(2)} · ganancia ${contexto.cartera.total.gananciaPct.toFixed(2)}%.`;
  }
  const tipo = comando === "/plan" ? "consulta_plan" : comando === "/sugerencias" ? "pedir_sugerencia" : "consulta_inversiones";
  const preguntas: Record<string, string> = {
    "/cartera": "Dame un resumen breve de mi cartera.",
    "/plan": "Dame un resumen breve de mis bolsillos y metas del plan.",
    "/sugerencias": "¿Qué sugiere hoy mi plan?",
  };
  let respuesta = await responderConsultaInversiones(supabase, usuarioId, tipo, {
    pregunta: preguntas[comando], ticker: null, confianza: "alta",
  });
  if (comando === "/sugerencias" && !respuesta.includes(DISCLAIMER)) respuesta += `\n\n${DISCLAIMER}`;
  return respuesta;
}

async function procesarCallback(supabase: SupabaseClient, update: TelegramUpdate) {
  const callback = update.callback_query!;
  const chatId = callback.message?.chat.id;
  if (!chatId || !callback.data) return;
  const { data: vinculo } = await supabase.from("telegram_vinculos").select("usuario_id").eq("chat_id", chatId).maybeSingle();
  if (!vinculo) return responderCallbackTelegram(callback.id, "Vinculá primero tu cuenta.");
  const [entidad, accion, repartoId] = callback.data.split(":");
  if (entidad !== "reparto" || !repartoId) return responderCallbackTelegram(callback.id);
  try {
    if (accion === "descartar") {
      await descartarRepartoUsuario(supabase, vinculo.usuario_id, repartoId);
      await responderCallbackTelegram(callback.id, "Reparto descartado");
      await enviarMensajeTelegram(chatId, "Reparto descartado.");
      return;
    }
    const { data: reparto } = await supabase.from("repartos").select("tc_referencia").eq("id", repartoId).eq("usuario_id", vinculo.usuario_id).maybeSingle();
    const tc = Number(reparto?.tc_referencia) || await obtenerUltimoMep(supabase);
    if (!tc) throw new Error("No hay cotización MEP disponible");
    await aplicarRepartoUsuario(supabase, vinculo.usuario_id, repartoId, tc);
    await responderCallbackTelegram(callback.id, "Aplicado");
    await enviarMensajeTelegram(chatId, "✅ Reparto aplicado a tus bolsillos.");
  } catch (error) {
    await responderCallbackTelegram(callback.id, error instanceof Error ? error.message.slice(0, 180) : "No pude hacerlo");
  }
}

export async function procesarUpdateTelegram(supabase: SupabaseClient, update: TelegramUpdate) {
  if (update.callback_query) return procesarCallback(supabase, update);
  const message = update.message;
  if (!message || message.chat.type !== "private") return;
  const chatId = message.chat.id;
  const { data: vinculo } = await supabase.from("telegram_vinculos").select("usuario_id").eq("chat_id", chatId).maybeSingle();
  const texto = message.text?.trim() ?? "";

  if (!vinculo) {
    const match = texto.match(/^\/vincular(?:@\w+)?\s+(\d{6})$/i);
    if (!match) {
      await enviarMensajeTelegram(chatId, "Primero vinculá tu cuenta desde Gastos Voz. Generá el código en Presupuestos y enviá /vincular CODIGO.");
      return;
    }
    const { data, error } = await supabase.rpc("vincular_telegram", { p_codigo: match[1], p_chat_id: chatId });
    if (error || !data) {
      await enviarMensajeTelegram(chatId, "Ese código es inválido o venció. Generá uno nuevo en Gastos Voz.");
      return;
    }
    await supabase.from("telegram_updates").update({ usuario_id: data }).eq("update_id", update.update_id);
    await enviarMensajeTelegram(chatId, "✅ Cuenta vinculada. Ya podés mandarme gastos, ingresos y audios, o usar /resumen, /cartera, /plan y /sugerencias.");
    return;
  }

  await supabase.from("telegram_updates").update({ usuario_id: vinculo.usuario_id }).eq("update_id", update.update_id);
  const comando = texto.split(/\s+/)[0].split("@")[0].toLowerCase();
  if (["/resumen", "/cartera", "/plan", "/sugerencias"].includes(comando)) {
    await enviarMensajeTelegram(chatId, await consultaComando(supabase, vinculo.usuario_id, comando));
    return;
  }
  const cobre = texto.match(/^\/cobre(?:@\w+)?\s+([\d.,]+)$/i);
  let resultado: ResultadoCaptura;
  if (cobre) {
    const monto = Number(cobre[1].replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(monto) || monto <= 0) {
      await enviarMensajeTelegram(chatId, "Usá el comando así: /cobre 700000");
      return;
    }
    resultado = await procesarEntradaFinanciera({
      supabase, usuarioId: vinculo.usuario_id, fuente: "texto", texto: `Cobré ${monto} pesos de Clientes`,
    });
  } else if (message.voice || message.audio) {
    const archivo = message.voice ?? message.audio!;
    const buffer = await descargarArchivoTelegram(archivo.file_id);
    resultado = await procesarEntradaFinanciera({
      supabase, usuarioId: vinculo.usuario_id, fuente: "audio",
      base64Data: buffer.toString("base64"), mimeType: archivo.mime_type ?? "audio/ogg",
    });
  } else if (texto && !texto.startsWith("/")) {
    resultado = await procesarEntradaFinanciera({ supabase, usuarioId: vinculo.usuario_id, fuente: "texto", texto });
  } else {
    await enviarMensajeTelegram(chatId, "Comandos: /resumen, /cartera, /plan, /sugerencias o /cobre 700000. También podés mandar un gasto o un audio.");
    return;
  }

  const teclado = resultado.tipo === "registro" && resultado.reparto
    ? tecladoRepartoTelegram(resultado.reparto.id)
    : undefined;
  let respuesta = textoResultado(resultado);
  if (resultado.tipo === "registro" && resultado.reparto) {
    respuesta += `\n\nReparto sugerido: ${resumenRepartoTexto(resultado.reparto.detalle)}\n${DISCLAIMER}`;
  }
  await enviarMensajeTelegram(chatId, respuesta, teclado);
}

