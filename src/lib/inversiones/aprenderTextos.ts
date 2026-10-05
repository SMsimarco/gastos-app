// Textos en criollo del asesor de aprender (push, Telegram, resumen y consultas). Son plantillas armadas con los
// números de aprender.ts: sirven de respuesta cuando Gemini no está, y de red de seguridad cuando Gemini redacta
// (si lo que devuelve no pasa `validarTextoAprender`, se usa la plantilla).
import type { Candidato, Excluido, ResultadoAprender } from "./aprender";
import { MIN_CASOS_HISTORIAL } from "./aprender";
import { DISCLAIMER_FINANCIERO } from "./avisos";

export const URL_APP_APRENDER = "https://gastosvoz.vercel.app/plan";
export const MAX_LARGO_AVISO = 700;
export const MAX_LINEAS_AVISO = 5;
export const PALABRAS_PROHIBIDAS = ["oportunidad única", "seguro", "garantizado", "no podés perder", "no puedes perder", "imperdible", "cohete", "🚀", "🚨", "⚠️", "¡se viene"];

export const INSTRUCCION_CRIOLLO = `Escribí en español rioplatense, como un amigo que sabe de inversiones: "vos", frases cortas, sin jerga sin explicar.
Si usás un término técnico, ponele una aclaración corta entre paréntesis la primera vez (por ejemplo: P/E (cuántos años de ganancias pagás por la acción)).
Primero la conclusión, después el porqué. Máximo 5 líneas, con el link a la app para el detalle.
Siempre los dos lados (por qué sí y por qué no) y siempre la opción de esperar o sumar a VOO.
Nada de euforia ni de miedo: sin "oportunidad única", "seguro", "garantizado", "no podés perder", sin emojis de cohete o alarma.
Los números van redondeados y en dólares ("US$120", "subió 8%"). Usá SOLO los números de los hechos: no calcules ni agregues ninguno.
No sugieras vender VOO ni tocar emergencia o gastos. Terminá con esta línea exacta: ${DISCLAIMER_FINANCIERO}`;

const usd = (valor: number) => `US$${Math.round(valor).toLocaleString("es-AR")}`;
const minuscula = (texto: string) => texto.charAt(0).toLowerCase() + texto.slice(1);

// Errores de un texto de aprender; lista vacía = está bien.
export function validarTextoAprender(texto: string, opciones: { exigirEsperar?: boolean; exigirDisclaimer?: boolean; maxLargo?: number; maxLineas?: number } = {}): string[] {
  const errores: string[] = [];
  const minusculas = texto.toLowerCase();
  const maxLargo = opciones.maxLargo ?? MAX_LARGO_AVISO;
  if (texto.length > maxLargo) errores.push(`Largo ${texto.length} supera ${maxLargo}`);
  const lineas = texto.split("\n").filter((linea) => linea.trim() !== "").length;
  if (opciones.maxLineas !== undefined && lineas > opciones.maxLineas) errores.push(`Tiene ${lineas} líneas y el máximo es ${opciones.maxLineas}`);
  if (opciones.exigirDisclaimer !== false && !texto.trimEnd().endsWith(DISCLAIMER_FINANCIERO)) errores.push("No termina con la línea de descargo");
  if (opciones.exigirEsperar !== false && !/esper|sum[aá](lo)? a voo/.test(minusculas)) errores.push("No incluye la opción de esperar o sumar a VOO");
  for (const palabra of PALABRAS_PROHIBIDAS) {
    const regex = palabra === "seguro" ? /\bseguro\b/i : new RegExp(palabra.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (regex.test(texto)) errores.push(`Palabra prohibida: ${palabra}`);
  }
  return errores;
}

function frasePorCandidato(candidato: Candidato): string {
  const si = candidato.porQueSi.length ? candidato.porQueSi.slice(0, 2).map(minuscula).join(" y ") : "no destaca en nada puntual";
  const no = candidato.porQueNo.find((texto) => !texto.startsWith("Sin dato"));
  const balance = candidato.balanceEnDias !== null && candidato.balanceEnDias >= 0 && candidato.balanceEnDias <= 14 ? `presenta balance en ${candidato.balanceEnDias} ${candidato.balanceEnDias === 1 ? "día" : "días"}` : null;
  const contra = [no ? minuscula(no) : null, balance].filter(Boolean).join(" y ") || "no aparece nada puntual en contra";
  return `${candidato.ticker}: ${si}; pero ${contra}`;
}

// Aviso de "ya tenés plata en aprender" para push y Telegram: 5 líneas como máximo.
export function redactarAvisoAprender(resultado: ResultadoAprender): string {
  if (!resultado.puedeComprar) return redactarFaltaAprender(resultado);
  const lineas = [`Ya tenés ${usd(resultado.saldoUsd)} en "aprender".`];
  if (resultado.candidatos.length > 0) lineas.push(`Opciones: ${resultado.candidatos.map(frasePorCandidato).join(". ")}.`);
  lineas.push(`O esperás o lo sumás a VOO: ${minuscula(resultado.opcionEsperar.motivo)}`);
  lineas.push(`Mirá el detalle en la app: ${URL_APP_APRENDER}`);
  lineas.push(DISCLAIMER_FINANCIERO);
  return lineas.join("\n");
}

export function redactarFaltaAprender(resultado: Pick<ResultadoAprender, "saldoUsd" | "faltaUsd">): string {
  return `Llevás ${usd(resultado.saldoUsd)} en "aprender"; te faltan ${usd(resultado.faltaUsd)} para poder invertir.\n${DISCLAIMER_FINANCIERO}`;
}

export function redactarAlertaAprender(alerta: { tipo: string; mensaje: string }): string {
  return `${alerta.mensaje}\nNo es una orden: es lo que vos mismo te marcaste en tu plan. Podés esperar y mirarlo con calma.\nMirá el detalle en la app: ${URL_APP_APRENDER}\n${DISCLAIMER_FINANCIERO}`;
}

// Sección "Aprender" del resumen semanal. Los rendimientos vienen calculados por el código.
export function redactarResumenAprender(datos: { saldoUsd: number; faltaUsd: number; posiciones: Array<{ ticker: string; gananciaPct: number; vooPct: number | null }>; alertas: Array<{ mensaje: string }>; aprendizaje: string | null }): string[] {
  const lineas: string[] = [`Aprender: ${datos.faltaUsd > 0 ? `llevás ${usd(datos.saldoUsd)}, te faltan ${usd(datos.faltaUsd)} para invertir.` : `tenés ${usd(datos.saldoUsd)} para invertir.`}`];
  for (const posicion of datos.posiciones) {
    const voo = posicion.vooPct === null ? "sin dato de VOO para comparar" : `VOO en el mismo período: ${posicion.vooPct >= 0 ? "+" : "−"}${Math.abs(Math.round(posicion.vooPct))}%`;
    lineas.push(`${posicion.ticker}: ${posicion.gananciaPct >= 0 ? "+" : "−"}${Math.abs(Math.round(posicion.gananciaPct))}% (${voo}).`);
  }
  for (const alerta of datos.alertas) lineas.push(alerta.mensaje);
  if (datos.aprendizaje) lineas.push(datos.aprendizaje);
  return lineas;
}

function descripcionCriterio(criterio: string): string {
  return { valuacion: "valuación", momento: "momento", calidad: "calidad", noticias: "noticias", riesgo: "riesgo" }[criterio] ?? criterio;
}

// "¿Por qué me sugerís MSFT?": una línea por criterio con dato, referencia y aporte.
export function redactarPorQueSugerido(candidato: Candidato): string {
  const filas = candidato.componentes.map((fila) => {
    const aporte = fila.marcado ? "marcado, no suma ni resta" : fila.criterio === "riesgo" ? "no suma ni resta" : fila.aporte === null ? "sin dato" : `${fila.aporte >= 0 ? "+" : "−"}${Math.abs(Math.round(fila.aporte))}`;
    const historial = fila.historial ? ` (${fila.historial.aciertos} de ${fila.historial.casos} le ganaron a VOO${fila.historial.casos < MIN_CASOS_HISTORIAL ? `; con menos de ${MIN_CASOS_HISTORIAL} casos puede ser suerte` : ""})` : "";
    return `- ${descripcionCriterio(fila.criterio)}: ${fila.dato}. ${fila.referencia}. ${aporte}. ${fila.enCriollo}.${historial}`;
  });
  return [`${candidato.ticker} tiene ${Math.round(candidato.puntaje)} puntos sobre 100.`, ...filas, `Qué cambiaría: ${candidato.queCambiaria.join(" ") || "nada puntual por ahora."}`, `Si preferís no apurarte, esperar o sumar a VOO sigue siendo una opción.`, DISCLAIMER_FINANCIERO].join("\n");
}

// "¿Por qué no NVDA?" y "¿qué tiene que pasar para que compre KO?"
export function redactarPorQueNo(ticker: string, excluido: Excluido): string {
  return `${ticker} no está entre las opciones: ${excluido.detalle}\nQué tendría que cambiar: ${excluido.queCambiaria}\n${DISCLAIMER_FINANCIERO}`;
}

export function redactarNoEstaEnLista(ticker: string): string {
  return `${ticker} no está en tu lista de aprender, así que no lo evalúo. Si lo querés, sumalo desde Plan con su tesis.\n${DISCLAIMER_FINANCIERO}`;
}

// Números del texto que no aparecen en ninguna de las fuentes (los hechos y el texto base): si Gemini inventó alguno,
// se descarta lo que redactó. Compara con coma o punto decimal indistintamente.
export function numerosInventados(texto: string, fuentes: string[]): string[] {
  const permitido = fuentes.join(" ").replaceAll(",", ".");
  return [...texto.matchAll(/\d+(?:[.,]\d+)?/g)].map((coincidencia) => coincidencia[0]).filter((numero) => !permitido.includes(numero.replaceAll(",", ".")));
}
