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
- Decisión: `pg_cron` (programa) + `pg_net` (hace el HTTP) de Supabase llaman a `/api/lab/monitor`, `/api/lab/noticias`, `/api/lab/gdelt` y `/api/lab/macro` con `Authorization: Bearer LAB_CRON_SECRET`. El script está en `scripts/lab-pg-cron.sql`; el secreto va al Vault de Supabase.
- Disponibilidad: ambas extensiones están en todos los planes de Supabase, incluido el gratuito. Se confirma al ejecutar el script (si `create extension` falla, hay que activarlas desde Database > Extensions).
- Si el proyecto pasa a Vercel Pro, se puede mover a Vercel Cron sin tocar los endpoints (son GET con el mismo header de secreto).
- Cada endpoint declara `maxDuration = 60` (el tope de Vercel Hobby con Fluid Compute es mayor, pero 60 s alcanza).
- Todos los horarios son UTC. El monitor corre `*/15 13-21 * * 1-5` (cubre 9:30-16:00 de Nueva York en verano e invierno) y el endpoint consulta el `clock` de Alpaca: con el mercado cerrado o en feriado responde `omitido: mercado_cerrado` y no hace nada. Las noticias por empresa (y el resumen con IA de todo lo pendiente) corren cada 30 minutos todos los días; las globales salen del flujo general de Alpaca en esa misma corrida (GDELT quedó pausado, ver abajo). La tarea diaria (indicadores, macro y calendario) corre a las 22:30 UTC, después del cierre en ambos horarios.

## Fuentes y límites reales (verificados el 2026-10-03)

| Fuente | Qué se usa | Límite / condición | Fallo |
|---|---|---|---|
| Alpaca Market Data (plan Basic, gratis, también con cuenta paper) | Barras diarias, último precio (snapshots), noticias por empresa, `clock` | Feed **IEX** (no SIP: precios y volumen son solo los de IEX, una parte del mercado total), 200 llamadas/min, y los últimos 15 minutos de datos históricos no están disponibles. Noticias: incluidas en el plan, históricas desde 2015, mismo límite de llamadas | El monitor devuelve error y queda registrado |
| Alpaca News, flujo general (sin filtrar por ticker) | **Noticias globales**: titulares de mercado que tocan los 7 temas (Fed, inflación, petróleo, China, guerra, elecciones EE.UU., Argentina), asignados por palabras clave en `temas.ts` (se descartan las notas de analistas sobre una empresa) | Mismo plan y límite que el resto de Alpaca. Un viernes en horario de mercado hubo ~300 titulares y ~13 con tema | Falla por separado del flujo por empresa |
| GDELT DOC 2.0 (**pausado**) | Noticias globales por tema (Fed, inflación, guerra, petróleo, China, elecciones EE.UU., Argentina) | Gratis, sin key. Pide ~1 pedido cada 5 s y **en la práctica es lento y poco confiable** (ver abajo). Por eso cada corrida de 10 min consulta un solo tema, rotando (cada tema se refresca cada ~70 min) | Un pedido que falla se registra y se sigue con el próximo tema |
| FRED | Tasa de la Fed (`DFF`), CPI (`CPIAUCSL`), desempleo (`UNRATE`), curva 10a-2a (`T10Y2Y`), VIX (`VIXCLS`), petróleo WTI (`DCOILWTICO`) | Key gratis; sin límite por minuto documentado en `series/observations` | Una serie que falla no corta a las demás |
| Finnhub (plan gratuito) | Calendario de balances (`calendar/earnings`) por empresa | ~60 llamadas/min y 30/s; **solo uso no comercial** | Un ticker que falla conserva su último calendario |
| Reserva Federal (manual) | Reuniones del FOMC 2026-2027 | El calendario de Finnhub es premium; las fechas están en `fuentes/fed.ts` con su fuente | Agregar 2028 cuando se publique |

Limitaciones a tener presentes:
- **GDELT quedó pausado (2026-10-04).** Se probó desde la red de desarrollo y desde Vercel (con el cron corriendo solo): casi siempre devuelve HTTP 429 ("Please limit requests to one every 5 seconds") aun con 6-15 s de separación, o `fetch failed` por timeout de conexión, y una sola vez un `{}` sin resultados. Nunca se vio una respuesta real con artículos, así que el parser solo está probado con respuestas armadas a mano. Las noticias globales salen ahora del flujo general de Alpaca. El endpoint `/api/lab/gdelt` y su cliente siguen en el código; para reactivarlo hay que activar el job `lab-gdelt` (`select cron.alter_job(<jobid>, active := true);`)
- **VIX intradía:** FRED publica `VIXCLS` con un día de retraso y Alpaca no tiene el índice. El evento "VIX +10% en el día" se calcula contra la rueda anterior con el último dato de FRED, una vez por fecha. Si más adelante se consigue una fuente intradía, solo cambia lo que recibe `monitor.ts`.
- **Posiciones de bots:** todavía no existen, así que los eventos que dependen de tener posición (noticia relevante, balance de hoy) se registran pero no "disparan decisión". La referencia del movimiento de 3% es el cierre anterior hasta que haya decisiones.
- **Modelos:** el resumen de noticias usa `gemini-3.5-flash-lite` (existe en la API y es el más barato; configurable en `lab_config.modelo_resumen`). Las decisiones de los bots (parte B) usarán `modelo_decision` (default `gemini-3.6-flash`). Precios en `presupuesto.ts`, verificados en https://ai.google.dev/gemini-api/docs/pricing: flash-lite US$0,30 entrada / US$2,50 salida por millón de tokens; 3.6 flash US$0,75 / US$3,75; 3.5 flash US$1,50 / US$9,00. Un modelo desconocido se cobra al precio más caro conocido.

## Verificación de punta a punta (2026-10-04)

Con las keys reales y una base Postgres + PostgREST descartable (la migración aplicada, producción sin tocar):
- `macro`: 15 tickers con indicadores reales (VOO cerró 707,35 el 2/10 con RSI 53,9), 188 observaciones de FRED y 14 eventos de calendario (balances de Finnhub + 3 reuniones de la Fed), en ~4 s. Repetirlo no duplica nada.
- `noticias`: noticias reales de Alpaca resumidas con `gemini-3.5-flash-lite` (3 noticias = US$0,00075; un lote de 11 = US$0,0025, unos US$0,0002 por noticia). La segunda corrida deduplica por URL, no llama a la IA y responde en 0,3 s.
- `monitor` (con el reloj simulado como abierto, porque el mercado estaba cerrado): guardó 15 precios y 2 eventos (VIX +22% que "dispararía" una decisión, y una noticia relevante sin posición que no), y no los repitió en la corrida siguiente.
- Panel: lo lee el usuario con RLS (precios con variación del día, RSI, tendencia, las 6 series macro, noticias, calendario, eventos y estado de cada fuente); un usuario no puede escribir en tablas de mercado y otro usuario no ve la configuración ajena.
- Hallazgo que se corrigió: el panel pedía las series macro con un solo límite global y las series diarias desplazaban a CPI y desempleo.
- Sin verificar: GDELT (pausado, ver arriba) y el monitor con el mercado realmente abierto.
- En producción (Vercel + Supabase `pg_cron`): `macro`, `noticias` y `monitor` respondieron bien a pedidos manuales, y `pg_cron` ejecutó `lab-gdelt` solo con el secreto del Vault (el registro llegó a `lab_ejecuciones`).

## Costo estimado de IA

Solo el resumen de noticias usa IA en la parte A. Se resume una sola vez cada noticia (dedup por URL) y en lote, con una sola llamada por corrida (máx. 40 titulares). Los bots (parte B) se suman a este presupuesto.

| Llamada | Tokens aprox. | Costo aprox. |
|---|---|---|
| Resumen en lote de ~20 noticias nuevas (flash-lite) | ~1.800 de entrada + ~1.500 de salida | ~US$0,004 por corrida (medido: 11 noticias = US$0,0025) |
| Un día completo (48 corridas, caso alto: ~20 nuevas por corrida) | ~85k entrada + ~72k salida | ~US$0,20 por día, ~US$6 por mes |

Es una estimación gruesa: lo real se mide en la tabla `lab_costos_ia` (cada llamada guarda tokens y costo) después de una semana. El tope duro es `lab_config.max_costo_ia_mensual_usd` (default US$10, compartido con los bots): al alcanzarlo, el resumen se frena y las noticias quedan sin procesar hasta el mes siguiente; la recolección y el monitor siguen. Si el gasto de noticias se come demasiado del tope, las palancas son: bajar `maxRegistros` de GDELT, espaciar las noticias fuera de horario o resumir solo las de los temas con más peso.

## Decisiones de la parte A

- Además de las tablas pedidas se agregaron `lab_costos_ia` (costo de cada llamada, base del tope mensual) y `lab_ejecuciones` (resultado de cada corrida, para mostrar qué fuente falló sin reintentar en loop). Son globales y de solo lectura para usuarios.
- Los endpoints leen la configuración de todos los usuarios con `service_role`: universo = unión de los universos, tope = el más chico. Con un solo usuario es simplemente su configuración.
- El resumen de noticias usa solo el titular (más tema y tickers de la fuente): alcanza para sentimiento y relevancia y ahorra tokens.
- Los números de las noticias (sentimiento, relevancia) los produce la IA; el resto (indicadores, variaciones, eventos) se calcula en TypeScript con tests.

## Fuentes adicionales (2026-10-04, migración 0019)

Se probó cada candidata con las keys reales antes de elegir. Todo lo de la tabla es gratis y no usa IA.

| Fuente | Qué se guarda | Tabla | Frecuencia | Límite / condición |
|---|---|---|---|---|
| Finnhub `stock/metric` | P/E, P/S, márgenes, crecimiento de ingresos y EPS, ROE, deuda/capital, beta, rango de 52 semanas, rendimiento a 13/26/52 semanas, dividendo, capitalización | `lab_fundamentales` (jsonb por ticker y día) | diaria | ~60 llamadas/min compartidas con el resto de Finnhub; 4 llamadas por empresa (11 empresas = 44) en lotes de 4 |
| Finnhub `stock/recommendation` | Recomendaciones de analistas (strong buy / buy / hold / sell / strong sell) por mes | `lab_analistas` | diaria | Finnhub a veces repite un período (XOM): se deduplica |
| Finnhub `stock/earnings` | Estimado vs real de los últimos 4 balances y % de sorpresa | `lab_sorpresas` | diaria | |
| Finnhub `stock/insider-transactions` | Compras (P) y ventas (S) de directivos de los últimos 90 días; se descartan premios, impuestos y regalos | `lab_insiders` | diaria | |
| SEC EDGAR `submissions` | Presentaciones 8-K, 6-K, 10-Q, 10-K, 20-F y 40-F de los últimos 45 días, con los ítems del 8-K traducidos (Resultados trimestrales, Cambios en directivos, etc.) y link | `lab_filings` | diaria | Sin key, exige `SEC_USER_AGENT` con un contacto; máx. 10 pedidos/s (se espacian 200 ms). Los Form 4 y 144 se filtran porque ya están en Finnhub |
| FRED (6 series nuevas) | Bono a 10 y 2 años, spread de crédito high yield, pedidos semanales de desempleo, confianza del consumidor (Michigan), índice dólar | `lab_macro` | diaria | Misma key |
| FRED `release/dates` | Próximas publicaciones de CPI, empleo, PBI, PPI, PCE y ventas minoristas (ids verificados) | `lab_eventos_calendario` (tipo `macro`) | diaria | |
| argentinadatos.com | Riesgo país | `lab_macro` (`RIESGO_PAIS`) | diaria | Sin key. Bloquea clientes tipo Python; con `fetch` de Node anda |
| dolarapi.com | Dólar oficial, MEP, CCL y blue (precio de venta, con la fecha de actualización de cada casa) | `lab_macro` (`USD_*`) | diaria | Sin key. Solo da el valor actual: la variación aparece desde el segundo día |
| Alpaca `corporate-actions` | Próximos dividendos en efectivo del universo (fecha ex y de pago) | `lab_eventos_calendario` (tipo `dividendo`) | diaria | Misma key |

Los ETF (VOO, QQQ, VTI, SCHD) no tienen métricas, analistas ni insiders en Finnhub: solo entran precios, indicadores y dividendos.

Descartadas, con la prueba: Finnhub calendario económico, precio objetivo y sentimiento social (HTTP 403, plan pago); BCRA API v3 (HTTP 410, deprecada); Reddit y StockTwits (piden aprobación u OAuth); movers y most-actives de Alpaca (casi solo penny stocks, sin valor para este universo); Finnhub `company-news` como segunda fuente de noticias por empresa (respondió, pero duplica la cobertura de Alpaca y cada titular nuevo cuesta IA).

Programación: el endpoint `/api/lab/fundamentales` corre a las 23:15 UTC de lunes a viernes (después de `macro`, 22:30). Impacto en la parte B: todo esto va solo al briefing de los bots con perfil `completo` (A y B), nunca al C, y el briefing tendrá un tope de tamaño para no inflar tokens por decisión.

Verificación de punta a punta (con las keys reales y una base descartable, migraciones 0018 y 0019 aplicadas en orden sobre datos existentes): `macro` 386 observaciones, 17 publicaciones macro y 3 dividendos; `fundamentales` 11 empresas, 43 recomendaciones, 44 sorpresas, 179 movimientos de directivos únicos y 18 filings; repetir las corridas no duplica nada. La prueba encontró que Finnhub repite períodos (XOM) y que el mensaje de error de la base se perdía; ambos corregidos con tests.
