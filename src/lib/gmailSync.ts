import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerAccessToken, listarMensajesCandidatos, obtenerMensaje } from "./gmail";
import { clasificarYExtraerTexto } from "./gemini";
import { obtenerListasCategorias } from "./categorias";
import { guardarMovimiento } from "./movimientos";
import { enviarPush } from "./push";

export type ResultadoSyncUsuario = {
  registrados: number;
  omitidos: number;
  errores: number;
  desconectado: boolean;
};

// Procesa los mails nuevos de un usuario y los registra. Usado tanto por el
// cron diario como por "revisar ahora" en la UI — misma lógica. Acceso a
// Gmail 100% lectura (gmail.readonly): "ya lo procesé" se controla contra
// gmail_mensajes_procesados, no con etiquetas en el mail.
export async function sincronizarGmailUsuario(
  supabaseServicio: SupabaseClient,
  usuarioId: string
): Promise<ResultadoSyncUsuario> {
  const { data: integracion } = await supabaseServicio
    .from("gmail_integracion")
    .select("refresh_token, remitentes, activo")
    .eq("usuario_id", usuarioId)
    .single();

  if (!integracion || !integracion.activo || !integracion.refresh_token) {
    return { registrados: 0, omitidos: 0, errores: 0, desconectado: false };
  }

  let accessToken: string;
  try {
    accessToken = await obtenerAccessToken(integracion.refresh_token);
  } catch {
    // Token revocado o inválido: desconectamos y avisamos, no reintentamos en loop.
    await supabaseServicio
      .from("gmail_integracion")
      .update({ activo: false, refresh_token: null })
      .eq("usuario_id", usuarioId);
    await enviarPush(supabaseServicio, usuarioId, {
      title: "Se desconectó tu Gmail",
      body: "El auto-registro de gastos por email dejó de funcionar. Reconectalo en Presupuestos.",
    });
    return { registrados: 0, omitidos: 0, errores: 0, desconectado: true };
  }

  const candidatos = await listarMensajesCandidatos(accessToken, integracion.remitentes);
  if (candidatos.length === 0) {
    return { registrados: 0, omitidos: 0, errores: 0, desconectado: false };
  }

  const { data: yaVistos } = await supabaseServicio
    .from("gmail_mensajes_procesados")
    .select("mensaje_id")
    .eq("usuario_id", usuarioId)
    .in("mensaje_id", candidatos);
  const idsVistos = new Set((yaVistos ?? []).map((v) => v.mensaje_id));
  const idsNuevos = candidatos.filter((id) => !idsVistos.has(id));

  const categorias = await obtenerListasCategorias(supabaseServicio, usuarioId);

  let registrados = 0;
  let omitidos = 0;
  let errores = 0;
  const resumenPush: string[] = [];

  for (const id of idsNuevos) {
    try {
      const mensaje = await obtenerMensaje(accessToken, id);
      const textoCompleto = `Asunto: ${mensaje.asunto}\n\n${mensaje.texto}`;
      // eslint-disable-next-line no-console
      console.log("[gmail-debug] texto:", textoCompleto.slice(0, 800));

      const resultado = await clasificarYExtraerTexto(textoCompleto, categorias);
      // eslint-disable-next-line no-console
      console.log("[gmail-debug] resultado:", JSON.stringify(resultado).slice(0, 1500));
      const movimientos = resultado.intencion === "registro" ? resultado.movimientos : [];

      const guardables = movimientos.filter((m) => m.confianza !== "baja");

      if (guardables.length === 0) {
        await supabaseServicio
          .from("gmail_mensajes_procesados")
          .insert({ usuario_id: usuarioId, mensaje_id: id, estado: "omitido" });
        omitidos++;
        continue;
      }

      for (const item of guardables) {
        const guardado = await guardarMovimiento(supabaseServicio, item, "email", usuarioId, null);
        registrados++;
        resumenPush.push(
          `${guardado.categoriaEmoji} ${guardado.descripcion} — $${Math.round(guardado.monto_ars).toLocaleString("es-AR")}${
            guardado.posibleDuplicado ? " ⚠️ posible duplicado" : ""
          }`
        );
      }

      await supabaseServicio
        .from("gmail_mensajes_procesados")
        .insert({ usuario_id: usuarioId, mensaje_id: id, estado: "procesado" });
    } catch {
      // Un mail con error no bloquea el resto; al no quedar marcado se
      // reintenta la próxima corrida.
      errores++;
    }
  }

  await supabaseServicio
    .from("gmail_integracion")
    .update({ ultimo_check: new Date().toISOString() })
    .eq("usuario_id", usuarioId);

  if (resumenPush.length > 0) {
    await enviarPush(supabaseServicio, usuarioId, {
      title: `${registrados} gasto${registrados > 1 ? "s" : ""} de tu mail registrado${registrados > 1 ? "s" : ""}`,
      body: resumenPush.join("\n"),
    });
  }

  return { registrados, omitidos, errores, desconectado: false };
}
