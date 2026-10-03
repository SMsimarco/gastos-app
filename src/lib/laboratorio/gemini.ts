// Llamada a Gemini del laboratorio (SIMULADO): igual que la de src/lib/gemini.ts (generateContent
// con responseSchema) pero devuelve los tokens usados, para registrar el costo de cada llamada.
export type RespuestaGemini<T> = { data: T; tokensEntrada: number; tokensSalida: number };

export async function llamarGeminiJson<T>(
  modelo: string,
  prompt: string,
  schema: Record<string, unknown>
): Promise<RespuestaGemini<T>> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Falta GEMINI_API_KEY");
  let ultimoError = "";
  for (let intento = 0; intento < 2; intento++) {
    const respuesta = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (respuesta.ok) {
      const data = await respuesta.json();
      const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!texto) throw new Error("Gemini no devolvió texto");
      return {
        data: JSON.parse(texto) as T,
        tokensEntrada: Number(data.usageMetadata?.promptTokenCount ?? 0),
        // Los tokens de "pensamiento" también se cobran como salida.
        tokensSalida: Number(data.usageMetadata?.candidatesTokenCount ?? 0) + Number(data.usageMetadata?.thoughtsTokenCount ?? 0),
      };
    }
    ultimoError = `${respuesta.status} ${(await respuesta.text()).slice(0, 200)}`;
    if (![429, 503].includes(respuesta.status)) throw new Error(`Gemini falló: ${ultimoError}`);
    if (intento === 0) await new Promise((resolver) => setTimeout(resolver, 800));
  }
  throw new Error(`Gemini no respondió después de los reintentos: ${ultimoError}`);
}
