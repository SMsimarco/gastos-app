// Datos y envío de los avisos de empresas grandes. Corre dentro del job diario de aprender, con service_role: filtra
// siempre por usuario_id. Mira los activos de la lista de aprender del usuario más VOO, con datos de lab_* (solo lectura).
import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarPorCanales } from "./aprenderAvisos";
import { diasEntre } from "./aprender";
import { evaluarEmpresasFuertes, textoAlertaFuerte, textoAlertaVoo, textoResumenFuertes, type Observacion } from "./empresasFuertes";
import { caidaDesdeMaximoPct, UMBRAL_VOO_BAJO_MAXIMO_PCT } from "./sugerencias";

export const PREFIJO_RESUMEN = "fuertes-resumen:";
export const PREFIJO_ALERTA = "fuertes-alerta:";
export const PREFIJO_VOO = "fuertes-voo:";
const DIAS_DATOS_VIGENTES = 4;
const DIAS_ENTRE_AVISOS_VOO = 7;

const numero = (valor: unknown): number | null => (valor === null || valor === undefined || valor === "" || !Number.isFinite(Number(valor)) ? null : Number(valor));
const diasAtras = (hoy: string, dias: number) => new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
const diasAdelante = (hoy: string, dias: number) => diasAtras(hoy, -dias);

export async function cargarObservaciones(servicio: SupabaseClient, tickers: string[], hoy: string): Promise<Observacion[]> {
  const [indicadores, noticias, balances] = await Promise.all([
    servicio.from("lab_indicadores").select("ticker, fecha, datos").in("ticker", tickers).order("fecha", { ascending: false }).limit(tickers.length * 3),
    servicio.from("lab_noticias").select("fuente, ticker, tickers, titular, publicado_at, relevancia").gte("publicado_at", `${diasAtras(hoy, 2)}T00:00:00Z`).order("publicado_at", { ascending: false }).limit(400),
    servicio.from("lab_eventos_calendario").select("ticker, fecha").eq("tipo", "balance").gte("fecha", hoy).lte("fecha", diasAdelante(hoy, DIAS_DATOS_VIGENTES + 3)).in("ticker", tickers).order("fecha"),
  ]);
  const ultimo = new Map<string, { fecha: string; datos: Record<string, unknown> }>();
  for (const fila of indicadores.data ?? []) if (!ultimo.has(String(fila.ticker))) ultimo.set(String(fila.ticker), { fecha: String(fila.fecha), datos: (fila.datos ?? {}) as Record<string, unknown> });
  const proximoBalance = new Map<string, string>();
  for (const balance of balances.data ?? []) if (balance.ticker && !proximoBalance.has(String(balance.ticker))) proximoBalance.set(String(balance.ticker), String(balance.fecha));

  return tickers.flatMap((ticker) => {
    const dato = ultimo.get(ticker);
    if (!dato) return [];
    const propias = (noticias.data ?? [])
      .filter((noticia) => noticia.ticker === ticker || (Array.isArray(noticia.tickers) && noticia.tickers.includes(ticker)))
      .sort((a, b) => Number(b.ticker === ticker) - Number(a.ticker === ticker) || (numero(b.relevancia) ?? 0) - (numero(a.relevancia) ?? 0)); // primero las que son de la empresa, no las que solo la mencionan
    const balance = proximoBalance.get(ticker);
    return [{
      ticker,
      fecha: dato.fecha,
      variacionDia: numero(dato.datos.variacion_dia),
      variacionMes: numero(dato.datos.variacion_mes),
      distanciaMax52s: numero(dato.datos.distancia_max52s),
      balanceEnDias: balance ? diasEntre(hoy, balance) : null,
      titular: propias[0] ? { texto: String(propias[0].titular), fuente: String(propias[0].fuente) } : null,
    }];
  });
}

// Reserva el lugar en alertas_enviadas antes de mandar y lo libera si no salió, como los demás avisos.
async function enviarUna(servicio: SupabaseClient, usuarioId: string, clave: string, hoy: string, texto: string): Promise<boolean> {
  const { error } = await servicio.from("alertas_enviadas").insert({ usuario_id: usuarioId, clave, fecha: hoy });
  if (error) return false;
  try {
    if (!(await enviarPorCanales(servicio, usuarioId, texto))) throw new Error("sin canal");
    return true;
  } catch {
    await servicio.from("alertas_enviadas").delete().eq("usuario_id", usuarioId).eq("clave", clave).eq("fecha", hoy);
    return false;
  }
}

// Nunca lanza: un aviso fallido no puede frenar el job diario.
export async function enviarAvisosEmpresasFuertes(servicio: SupabaseClient, usuarioId: string) {
  const salida = { resumen: false, alertas: 0, voo: false, omitido: undefined as string | undefined, error: undefined as string | undefined };
  try {
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
    const { data: activos } = await servicio.from("activos").select("ticker").eq("usuario_id", usuarioId).eq("bolsillo_clave", "aprender").eq("en_politica", true).neq("tipo", "cuenta_remunerada");
    const tickers = [...new Set([...(activos ?? []).map((activo) => String(activo.ticker)), "VOO"])];
    if (tickers.length <= 1) return { ...salida, omitido: "lista de aprender vacía" };

    const observaciones = await cargarObservaciones(servicio, tickers, hoy);
    const evaluacion = evaluarEmpresasFuertes(observaciones);
    if (!evaluacion.fecha || diasEntre(evaluacion.fecha, hoy) > DIAS_DATOS_VIGENTES) return { ...salida, omitido: "datos del laboratorio viejos" };

    const { data: previas } = await servicio.from("alertas_enviadas").select("clave, fecha").eq("usuario_id", usuarioId).like("clave", "fuertes-%").gte("fecha", diasAtras(hoy, 10));
    const claves = new Set((previas ?? []).map((fila) => String(fila.clave)));

    // Resumen del día de mercado (clave por fecha de los datos: los fines de semana no se repite).
    const claveResumen = `${PREFIJO_RESUMEN}${evaluacion.fecha}`;
    if (!claves.has(claveResumen)) salida.resumen = await enviarUna(servicio, usuarioId, claveResumen, hoy, textoResumenFuertes(evaluacion));

    for (const item of evaluacion.alertasFuertes) {
      const clave = `${PREFIJO_ALERTA}${item.ticker}:${item.fecha}`;
      if (!claves.has(clave) && (await enviarUna(servicio, usuarioId, clave, hoy, textoAlertaFuerte(item)))) salida.alertas += 1;
    }

    // VOO: regla de la Fase 4 (cae 10% o más desde su máximo de 52 semanas). Una vez por semana, y no si el aviso de
    // mercado de la Fase 4 ya lo mandó esta semana.
    const { data: precioVoo } = await servicio.from("precios").select("cierre_usd, max_52s").eq("ticker", "VOO").order("fecha", { ascending: false }).limit(1).maybeSingle();
    const caida = precioVoo?.max_52s ? caidaDesdeMaximoPct(Number(precioVoo.cierre_usd), Number(precioVoo.max_52s)) : 0;
    if (caida >= UMBRAL_VOO_BAJO_MAXIMO_PCT) {
      const limite = diasAtras(hoy, DIAS_ENTRE_AVISOS_VOO - 1);
      const [propio, fase4] = await Promise.all([
        servicio.from("alertas_enviadas").select("clave").eq("usuario_id", usuarioId).gte("fecha", limite).like("clave", `${PREFIJO_VOO}%`).limit(1),
        servicio.from("alertas_enviadas").select("clave").eq("usuario_id", usuarioId).gte("fecha", limite).like("clave", "mercado:voo_bajo_maximo%").limit(1),
      ]);
      const yaAvisado = [...(propio.data ?? []), ...(fase4.data ?? [])];
      if (yaAvisado.length === 0) salida.voo = await enviarUna(servicio, usuarioId, `${PREFIJO_VOO}${hoy}`, hoy, textoAlertaVoo(caida));
    }
    return salida;
  } catch (error) {
    return { ...salida, error: error instanceof Error ? error.message : "Error desconocido" };
  }
}
