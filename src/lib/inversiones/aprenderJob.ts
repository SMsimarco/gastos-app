// Job diario del asesor de aprender (lo llama pg_cron después del cierre, ver scripts/lab-pg-cron.sql).
// Todo con service_role: filtra siempre por usuario_id. No escribe ninguna tabla lab_*.
// 1) refresca el promedio de P/E de 5 años de los tickers de aprender (una vez por semana por ticker)
// 2) guarda la evaluación semanal (en silencio si el saldo no llega al mínimo)
// 3) completa qué tickers compró el usuario
// 4) mide las sugerencias a 1, 4 y 12 semanas contra VOO
// 5) una vez por mes, propone (nunca aplica) un cambio de pesos
// 6) manda avisos pendientes (toma de ganancia, revisión, saldo suficiente)
// 7) resumen diario y alertas de empresas grandes (empresasFuertesAvisos.ts)
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluarCandidatos, type EstadoAprender } from "./aprender";
import { enviarAvisosAprender, registrarSugerencia } from "./aprenderAvisos";
import { cargarEstadoAprender, cargarHistorialAprender } from "./aprenderDatos";
import { descripcionPropuesta, medicionesPendientes, proponerCambioPesos, type PuntoPrecio, type SugerenciaGuardada } from "./aprenderHistorial";
import { obtenerPromedioPe5a } from "./aprenderPe";
import { enviarAvisosEmpresasFuertes } from "./empresasFuertesAvisos";

const DIAS_PE_VIGENTE = 7;
const PAUSA_FINNHUB_MS = 1_100; // el plan gratis de Finnhub permite ~60 llamadas por minuto

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));
const diasAtras = (hoy: string, dias: number) => new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);

export async function refrescarPromediosPe(servicio: SupabaseClient, tickers: string[], hoy: string): Promise<{ actualizados: string[]; sinDato: string[]; errores: string[] }> {
  const salida = { actualizados: [] as string[], sinDato: [] as string[], errores: [] as string[] };
  if (tickers.length === 0) return salida;
  const { data: existentes } = await servicio.from("aprender_pe_promedio").select("ticker, fecha").in("ticker", tickers);
  const vigentes = new Set((existentes ?? []).filter((fila) => String(fila.fecha) >= diasAtras(hoy, DIAS_PE_VIGENTE)).map((fila) => String(fila.ticker)));
  for (const ticker of tickers.filter((item) => !vigentes.has(item))) {
    try {
      const calculado = await obtenerPromedioPe5a(ticker, hoy);
      if (!calculado) {
        salida.sinDato.push(ticker);
      } else {
        const { error } = await servicio.from("aprender_pe_promedio").upsert({ ticker, promedio_5a: calculado.promedio, muestras: calculado.muestras, fecha: hoy, fuente: "Finnhub" }, { onConflict: "ticker" });
        if (error) throw new Error(error.message);
        salida.actualizados.push(ticker);
      }
    } catch (error) {
      salida.errores.push(`${ticker}: ${error instanceof Error ? error.message : "error"}`);
    }
    await esperar(PAUSA_FINNHUB_MS);
  }
  return salida;
}

async function completarCompras(servicio: SupabaseClient, usuarioId: string, hoy: string) {
  const { data: sugerencias } = await servicio.from("aprender_sugerencias").select("id, fecha, candidatos, compro_tickers").eq("usuario_id", usuarioId).gte("fecha", diasAtras(hoy, 120));
  if (!sugerencias?.length) return 0;
  const { data: operaciones } = await servicio.from("operaciones").select("fecha, tipo, activos(ticker)").eq("usuario_id", usuarioId).eq("tipo", "compra").gte("fecha", diasAtras(hoy, 120));
  let actualizadas = 0;
  for (const sugerencia of sugerencias) {
    const tickers = ((sugerencia.candidatos ?? []) as Array<{ ticker: string }>).map((candidato) => candidato.ticker);
    const compradas = tickers.filter((ticker) => (operaciones ?? []).some((operacion) => String(operacion.fecha) >= String(sugerencia.fecha) && (operacion.activos as unknown as { ticker?: string } | null)?.ticker === ticker));
    if (compradas.length !== ((sugerencia.compro_tickers ?? []) as string[]).length) {
      await servicio.from("aprender_sugerencias").update({ compro_tickers: compradas }).eq("id", sugerencia.id).eq("usuario_id", usuarioId);
      actualizadas += 1;
    }
  }
  return actualizadas;
}

async function medirSugerencias(servicio: SupabaseClient, usuarioId: string, hoy: string) {
  const { data: filas } = await servicio.from("aprender_sugerencias").select("id, fecha, voo_precio, candidatos").eq("usuario_id", usuarioId).gte("fecha", diasAtras(hoy, 12 * 7 + 10));
  const sugerencias: SugerenciaGuardada[] = (filas ?? []).map((fila) => ({ id: String(fila.id), fecha: String(fila.fecha), vooPrecio: fila.voo_precio === null ? null : Number(fila.voo_precio), candidatos: (fila.candidatos ?? []) as SugerenciaGuardada["candidatos"] }));
  if (sugerencias.length === 0) return 0;
  const { data: medidas } = await servicio.from("aprender_resultados").select("sugerencia_id, ticker, semanas").eq("usuario_id", usuarioId);
  const yaMedidas = new Set((medidas ?? []).map((fila) => `${fila.sugerencia_id}|${fila.ticker}|${fila.semanas}`));
  const tickers = [...new Set([...sugerencias.flatMap((sugerencia) => sugerencia.candidatos.map((candidato) => candidato.ticker)), "VOO"])];
  const desde = `${sugerencias.map((sugerencia) => sugerencia.fecha).sort()[0]}T00:00:00Z`;
  const cierres: Record<string, PuntoPrecio[]> = {};
  for (const ticker of tickers) {
    const { data } = await servicio.from("lab_precios").select("ts, precio").eq("tipo", "cierre").eq("ticker", ticker).gte("ts", desde).order("ts").limit(400);
    cierres[ticker] = (data ?? []).map((fila) => ({ fecha: String(fila.ts).slice(0, 10), precio: Number(fila.precio) }));
  }
  const pendientes = medicionesPendientes({ hoy, sugerencias, yaMedidas, cierres });
  if (pendientes.length === 0) return 0;
  const { error } = await servicio.from("aprender_resultados").upsert(
    pendientes.map((fila) => ({ usuario_id: usuarioId, sugerencia_id: fila.sugerenciaId, ticker: fila.ticker, semanas: fila.semanas, fecha_medicion: fila.fechaMedicion, precio_inicial: fila.precioInicial, precio_final: fila.precioFinal, rendimiento_pct: fila.rendimientoPct, voo_pct: fila.vooPct, gano_a_voo: fila.ganoAVoo, aportes: fila.aportes })),
    { onConflict: "sugerencia_id,ticker,semanas", ignoreDuplicates: true }
  );
  if (error) throw new Error(error.message);
  return pendientes.length;
}

// Guarda la evaluación de la semana. Si el saldo no llega al mínimo se evalúa "en sombra" (con el saldo mínimo) solo
// para poder medir el criterio; no se le avisa al usuario.
async function guardarEvaluacionSemanal(servicio: SupabaseClient, usuarioId: string, estado: EstadoAprender) {
  const { data: reciente } = await servicio.from("aprender_sugerencias").select("id").eq("usuario_id", usuarioId).gte("fecha", diasAtras(estado.hoy, 6)).limit(1);
  if (reciente?.length) return false;
  const puede = estado.saldoAprenderUsd >= estado.minimoCompraUsd;
  const resultado = evaluarCandidatos(puede ? estado : { ...estado, saldoAprenderUsd: estado.minimoCompraUsd });
  return (await registrarSugerencia(servicio, usuarioId, estado, resultado, !puede)) !== null;
}

async function proponerPesosDelMes(servicio: SupabaseClient, usuarioId: string, estado: EstadoAprender) {
  const mes = estado.hoy.slice(0, 7);
  const { data: existente } = await servicio.from("aprender_propuestas_pesos").select("id").eq("usuario_id", usuarioId).eq("mes", mes).maybeSingle();
  if (existente) return false;
  const { porCriterio } = await cargarHistorialAprender(servicio, usuarioId);
  const propuesta = proponerCambioPesos(estado.pesos, porCriterio);
  if (!propuesta) return false;
  const { error } = await servicio.from("aprender_propuestas_pesos").insert({ usuario_id: usuarioId, mes, pesos_actuales: estado.pesos, pesos_propuestos: propuesta.pesosPropuestos, evidencia: { criterios: propuesta.evidencia, texto: descripcionPropuesta(estado.pesos, propuesta) } });
  return !error;
}

export async function ejecutarJobAprender(servicio: SupabaseClient) {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const { data: activos } = await servicio.from("activos").select("usuario_id, ticker").eq("bolsillo_clave", "aprender").eq("en_politica", true).neq("tipo", "cuenta_remunerada");
  const usuarios = [...new Set((activos ?? []).map((activo) => String(activo.usuario_id)))];
  const tickers = [...new Set((activos ?? []).map((activo) => String(activo.ticker)))];
  const promedios = await refrescarPromediosPe(servicio, tickers, hoy);
  const usuariosResultado: Array<Record<string, unknown>> = [];
  for (const usuarioId of usuarios) {
    const paso: Record<string, unknown> = { usuarioId: usuarioId.slice(0, 8) };
    try {
      const { estado } = await cargarEstadoAprender(servicio, usuarioId);
      paso.evaluacionGuardada = await guardarEvaluacionSemanal(servicio, usuarioId, estado);
      paso.comprasActualizadas = await completarCompras(servicio, usuarioId, hoy);
      paso.medidas = await medirSugerencias(servicio, usuarioId, hoy);
      paso.propuestaPesos = await proponerPesosDelMes(servicio, usuarioId, estado);
      paso.avisos = await enviarAvisosAprender(servicio, usuarioId);
      paso.empresasFuertes = await enviarAvisosEmpresasFuertes(servicio, usuarioId);
    } catch (error) {
      paso.error = error instanceof Error ? error.message : "Error desconocido";
    }
    usuariosResultado.push(paso);
  }
  return { fecha: hoy, tickers: tickers.length, promedios, usuarios: usuariosResultado };
}
