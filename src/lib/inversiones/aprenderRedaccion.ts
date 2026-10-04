// Redacta los textos de aprender con Gemini y, si algo no pasa las reglas (largo, palabras prohibidas, opción de
// esperar, descargo, números inventados) o Gemini falla, devuelve la plantilla del código.
import { redactarTextoAprenderIA } from "../gemini";
import { INSTRUCCION_CRIOLLO, numerosInventados, validarTextoAprender } from "./aprenderTextos";

// Gemini no tiene timeout propio: si tarda más que esto se usa la plantilla (un aviso no puede quedar colgado).
export const TIMEOUT_IA_MS = 15_000;

export async function redactarConIA(textoBase: string, hechos: Record<string, unknown>, opciones: Parameters<typeof validarTextoAprender>[1] = {}): Promise<string> {
  if (!process.env.GEMINI_API_KEY) return textoBase;
  const texto = await Promise.race([
    redactarTextoAprenderIA({ instruccion: INSTRUCCION_CRIOLLO, hechos, textoBase }),
    new Promise<string>((resolver) => setTimeout(() => resolver(textoBase), TIMEOUT_IA_MS)),
  ]);
  if (texto === textoBase) return textoBase;
  const errores = [...validarTextoAprender(texto, opciones), ...numerosInventados(texto, [JSON.stringify(hechos), textoBase]).map((numero) => `Número inventado: ${numero}`)];
  return errores.length === 0 ? texto : textoBase;
}
