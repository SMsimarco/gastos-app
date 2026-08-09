# NOTES.md — Verificación API Gemini (2026-08-08)

## Qué se confirmó

1. **Modelo Flash actual:** `gemini-3.6-flash` (hay también `gemini-3.5-flash` disponible, pero 3.6 es el listado como más reciente).

2. **Dos APIs coexisten:**
   - `generateContent` (legacy, pero **"remains fully supported"** según la doc oficial) — endpoint REST clásico, bien documentado, con ejemplos completos de audio + structured output.
   - `Interactions API` (nueva, GA) — recomendada para features de punta, pero la documentación pública todavía no muestra el detalle completo del body JSON para audio inline ni el endpoint REST exacto (solo describe el método `interactions.create` a nivel SDK).

   **Decisión: usamos `generateContent`.** Es la opción "simple que funciona": endpoint y payload 100% documentados, sigue soportada oficialmente, y no dependemos de una API nueva con documentación incompleta para audio. Si en el futuro migrás, es un cambio acotado al nodo HTTP Request de WF01.

3. **Endpoint:**
   ```
   POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent
   ```
   Header: `x-goog-api-key: $GEMINI_API_KEY` (o como query param `?key=`).
   No hace falta header de versión aparte — la versión va en el path (`v1beta`).

4. **Audio inline en base64** — estructura confirmada:
   ```json
   {
     "contents": [{
       "parts": [
         { "text": "prompt de extracción acá" },
         {
           "inlineData": {
             "mimeType": "audio/ogg",
             "data": "<base64_sin_prefijo_data:>"
           }
         }
       ]
     }],
     "generationConfig": { ... }
   }
   ```
   Telegram entrega voice notes como OGG/Opus — Gemini acepta `audio/ogg` nativo según la doc de audio understanding. **Igual hay que probarlo con un audio real de Telegram antes de dar la rama por buena** (por si el contenedor OGG específico de Telegram tiene algo raro). Si falla, fallback: ffmpeg a mp3 vía Execute Command en n8n.

5. **Structured output** — sí soportado, vía `generationConfig`:
   ```json
   "generationConfig": {
     "responseMimeType": "application/json",
     "responseSchema": {
       "type": "OBJECT",
       "properties": { ... }
     }
   }
   ```
   Lo vamos a usar para forzar el array de movimientos en vez de parsear JSON de un prompt de texto libre — más confiable, como pediste.

6. **Límites (rate limits / free tier):** la documentación pública **no lista una tabla fija de RPM/TPM/RPD por modelo** — dice explícitamente que varían por cuenta y hay que verlos en `aistudio.google.com/rate-limit`. No hay un número confiable para anotar acá sin que quede desactualizado. **Acción:** antes de activar WF01 en producción, entrar a esa página con la cuenta que vas a usar y anotar ahí el RPM/RPD real que te asigna.

7. **Tamaño máximo de request:** 20 MB total (incluye audio inline + texto + system instruction). Si un audio supera eso, hay que subirlo con la Files API en vez de inline — no debería pasar con voice notes de Telegram (son cortas), pero si en algún momento mandás notas largas, ojo con esto.

## Fuentes
- https://ai.google.dev/gemini-api/docs/generate-content/audio
- https://ai.google.dev/gemini-api/docs/interactions-overview
- https://ai.google.dev/gemini-api/docs/rate-limits
