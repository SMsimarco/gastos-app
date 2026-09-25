import type { SupabaseClient } from "@supabase/supabase-js";
import {
  obtenerAccessToken,
  asegurarEtiquetas,
  listarMensajesNuevos,
  obtenerMensaje,
  etiquetarMensaje,
} from "./gmail";
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
// cron diario como por "revisar ahora" en la UI — misma lógica.
export async function sincronizarGmailUsuario(
  supabaseServicio: SupabaseClient,
  usuarioId: string
): Promise<ResultadoSyncUsuario> {
  const { data: integracion } = await supabaseServicio
    .from("gmail_integracion")
    .select("refresh_token, remitentes, activo, label_procesado_id, label_omitido_id")
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

  const etiquetas = await asegurarEtiquetas(accessToken, {
    procesado: integracion.label_procesado_id,
    omitido: integracion.label_omitido_id,
  });
  if (etiquetas.procesado !== integracion.label_procesado_id || etiquetas.omitido !== integracion.label_omitido_id) {
    await supabaseServicio
      .from("gmail_integracion")
      .update({ label_procesado_id: etiquetas.procesado, label_omitido_id: etiquetas.omitido })
      .eq("usuario_id", usuarioId);
  }

  const idsMensajes = await listarMensajesNuevos(
    accessToken,
    integracion.remitentes,
    etiquetas.procesado,
    etiquetas.omitido
  );

  const categorias = await obtenerListasCategorias(supabaseServicio, usuarioId);

  let registrados = 0;
  let omitidos = 0;
  let errores = 0;
  const resumenPush: string[] = [];

  for (const id of idsMensajes) {
    try {
      const mensaje = await obtenerMensaje(accessToken, id);
      const textoCompleto = `Asunto: ${mensaje.asunto}\n\n${mensaje.texto}`;

      const resultado = await clasificarYExtraerTexto(textoCompleto, categorias);
      const movimientos = resultado.intencion === "registro" ? resultado.movimientos : [];

      const guardables = movimientos.filter((m) => m.confianza !== "baja");

      if (guardables.length === 0) {
        await etiquetarMensaje(accessToken, id, etiquetas.omitido);
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

      await etiquetarMensaje(accessToken, id, etiquetas.procesado);
    } catch {
      // Un mail con error no bloquea el resto; se reintenta la próxima corrida
      // (no lo etiquetamos, así vuelve a aparecer en la búsqueda).
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
