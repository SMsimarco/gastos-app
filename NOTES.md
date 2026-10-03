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

---

# Verificación del proveedor de precios (2026-10-02)

## Proveedor elegido: Twelve Data

- Endpoint: `GET https://api.twelvedata.com/time_series`, con `interval=1day` y hasta 370 cierres por ticker.
- El plan Basic gratuito publicado ofrece 8 créditos por minuto y 800 por día para uso personal e interno. Una serie temporal cuesta 1 crédito por símbolo, suficiente para consultar una vez cada ticker activo de lunes a viernes.
- Conserva más de diez años de históricos diarios y permite hasta 5.000 registros por pedido. Los precios diarios vienen ajustados por splits.
- Se eligió porque permite cargar en una llamada el historial necesario para costo, gráfico y benchmark. El cron deduplica tickers entre usuarios y, si una consulta falla, mantiene el último cierre guardado.

## Fuentes

- https://twelvedata.com/pricing
- https://support.twelvedata.com/en/articles/5620512-how-to-create-a-request
- https://support.twelvedata.com/en/articles/5549842-twelve-data-quality-standards
- https://support.twelvedata.com/en/articles/5179064-are-the-prices-adjusted

---

# Fase 3 — casos manuales de consultas

Probar por texto y por voz desde la captura principal. Las respuestas usan datos reales de Supabase; por eso los importes exactos varían según el usuario.

1. **“¿Qué hago con esta plata?”** — se clasifica como `pedir_sugerencia`, enumera únicamente reglas activas ordenadas por prioridad y termina con “Sugerencia según tu plan, no asesoramiento financiero.”
2. **“¿Cuánto me rinde VOO?”** — se clasifica como `consulta_inversiones` y responde con costo, valor y rendimiento ya calculados por `rendimiento.ts`.
3. **“¿Cuánto me falta para la emergencia?”** — se clasifica como `consulta_plan` y usa saldo y meta reales del bolsillo Emergencia.
4. **“¿Me conviene comprar YPF?”** — se clasifica como `pedir_sugerencia`; si YPF no está en `activos.en_politica`, explica solo que está fuera del plan, sin recomendarla ni desaconsejarla, y agrega el cierre fijo.
5. **“¿Cuánto tengo en total?”** — se clasifica como `consulta_inversiones` y usa el total calculado de la cartera.

Si la clasificación tiene confianza baja, la app pide reformular y no consulta ni guarda datos.

---

# Fase 6A — Laboratorio: recolección de datos y panel en vivo (2026-10-03)

Experimento SIMULADO (plata ficticia), aislado del plan real: tablas `lab_*`, sin relación con bolsillos, cartera ni movimientos. Esta parte A solo recolecta datos y los muestra; los bots, las órdenes en Alpaca, el gestor de riesgo, el briefing y las métricas son las partes B y C.

## Scheduler: Supabase `pg_cron` + `pg_net` (el proyecto está en Vercel Hobby)

- Vercel Hobby solo permite crons de una vez por día (con precisión de ±59 min). Los 6 crons actuales de `vercel.json` ya son diarios. El monitor necesita 15 minutos y las noticias 30, así que no se puede con Vercel Cron.
- Decisión: `pg_cron` (programa) + `pg_net` (hace el HTTP) de Supabase llaman a `/api/lab/monitor`, `/api/lab/noticias` y `/api/lab/macro` con `Authorization: Bearer LAB_CRON_SECRET`. El script está en `scripts/lab-pg-cron.sql`; el secreto va al Vault de Supabase.
- Disponibilidad: ambas extensiones están en todos los planes de Supabase, incluido el gratuito. Se confirma al ejecutar el script (si `create extension` falla, hay que activarlas desde Database > Extensions).
- Si el proyecto pasa a Vercel Pro, se puede mover a Vercel Cron sin tocar los endpoints (son GET con el mismo header de secreto).
- Cada endpoint declara `maxDuration = 60` (el tope de Vercel Hobby con Fluid Compute es mayor, pero 60 s alcanza).
- Todos los horarios son UTC. El monitor corre `*/15 13-21 * * 1-5` (cubre 9:30-16:00 de Nueva York en verano e invierno) y el endpoint consulta el `clock` de Alpaca: con el mercado cerrado o en feriado responde `omitido: mercado_cerrado` y no hace nada. Las noticias corren cada 30 minutos todos los días. La tarea diaria (indicadores, macro y calendario) corre a las 22:30 UTC, después del cierre en ambos horarios.

## Fuentes y límites reales (verificados el 2026-10-03)

| Fuente | Qué se usa | Límite / condición | Fallo |
|---|---|---|---|
| Alpaca Market Data (plan Basic, gratis, también con cuenta paper) | Barras diarias, último precio (snapshots), noticias por empresa, `clock` | Feed **IEX** (no SIP: precios y volumen son solo los de IEX, una parte del mercado total), 200 llamadas/min, y los últimos 15 minutos de datos históricos no están disponibles. Noticias: incluidas en el plan, históricas desde 2015, mismo límite de llamadas | El monitor devuelve error y queda registrado |
| GDELT DOC 2.0 | Noticias globales por tema (Fed, inflación, guerra, petróleo, China, elecciones EE.UU., Argentina) | Gratis, sin key, sin límite publicado; se recomienda ~1 pedido cada 5 s, por eso los 7 temas van en serie con 5,2 s de pausa y un tope de 40 s | Un tema que falla no corta a los demás |
| FRED | Tasa de la Fed (`DFF`), CPI (`CPIAUCSL`), desempleo (`UNRATE`), curva 10a-2a (`T10Y2Y`), VIX (`VIXCLS`), petróleo WTI (`DCOILWTICO`) | Key gratis; sin límite por minuto documentado en `series/observations` | Una serie que falla no corta a las demás |
| Finnhub (plan gratuito) | Calendario de balances (`calendar/earnings`) por empresa | ~60 llamadas/min y 30/s; **solo uso no comercial** | Un ticker que falla conserva su último calendario |
| Reserva Federal (manual) | Reuniones del FOMC 2026-2027 | El calendario de Finnhub es premium; las fechas están en `fuentes/fed.ts` con su fuente | Agregar 2028 cuando se publique |

Limitaciones a tener presentes:
- **VIX intradía:** FRED publica `VIXCLS` con un día de retraso y Alpaca no tiene el índice. El evento "VIX +10% en el día" se calcula contra la rueda anterior con el último dato de FRED, una vez por fecha. Si más adelante se consigue una fuente intradía, solo cambia lo que recibe `monitor.ts`.
- **Fundamentales (P/E, crecimiento, margen):** no entran en la parte A (no estaban en las tablas pedidas). Finnhub los tiene gratis; quedan para la parte B si los bots los necesitan.
- **Posiciones de bots:** todavía no existen, así que los eventos que dependen de tener posición (noticia relevante, balance de hoy) se registran pero no "disparan decisión". La referencia del movimiento de 3% es el cierre anterior hasta que haya decisiones.
- **Modelos:** el resumen de noticias usa `gemini-3.5-flash-lite` (existe en la API y es el más barato; configurable en `lab_config.modelo_resumen`). Las decisiones de los bots (parte B) usarán `modelo_decision` (default `gemini-3.6-flash`). Precios en `presupuesto.ts`, verificados en https://ai.google.dev/gemini-api/docs/pricing: flash-lite US$0,30 entrada / US$2,50 salida por millón de tokens; 3.6 flash US$0,75 / US$3,75; 3.5 flash US$1,50 / US$9,00. Un modelo desconocido se cobra al precio más caro conocido.

## Costo estimado de IA

Solo el resumen de noticias usa IA en la parte A. Se resume una sola vez cada noticia (dedup por URL) y en lote, con una sola llamada por corrida (máx. 40 titulares). Los bots (parte B) se suman a este presupuesto.

| Llamada | Tokens aprox. | Costo aprox. |
|---|---|---|
| Resumen en lote de ~20 noticias nuevas (flash-lite) | ~1.800 de entrada + ~1.500 de salida | ~US$0,004 por corrida |
| Un día completo (48 corridas, caso alto: ~20 nuevas por corrida) | ~85k entrada + ~72k salida | ~US$0,20 por día, ~US$6 por mes |

Es una estimación gruesa: lo real se mide en la tabla `lab_costos_ia` (cada llamada guarda tokens y costo) después de una semana. El tope duro es `lab_config.max_costo_ia_mensual_usd` (default US$10, compartido con los bots): al alcanzarlo, el resumen se frena y las noticias quedan sin procesar hasta el mes siguiente; la recolección y el monitor siguen. Si el gasto de noticias se come demasiado del tope, las palancas son: bajar `maxRegistros` de GDELT, espaciar las noticias fuera de horario o resumir solo las de los temas con más peso.

## Decisiones de la parte A

- Además de las tablas pedidas se agregaron `lab_costos_ia` (costo de cada llamada, base del tope mensual) y `lab_ejecuciones` (resultado de cada corrida, para mostrar qué fuente falló sin reintentar en loop). Son globales y de solo lectura para usuarios.
- Los endpoints leen la configuración de todos los usuarios con `service_role`: universo = unión de los universos, tope = el más chico. Con un solo usuario es simplemente su configuración.
- El resumen de noticias usa solo el titular (más tema y tickers de la fuente): alcanza para sentimiento y relevancia y ahorra tokens.
- Los números de las noticias (sentimiento, relevancia) los produce la IA; el resto (indicadores, variaciones, eventos) se calcula en TypeScript con tests.
