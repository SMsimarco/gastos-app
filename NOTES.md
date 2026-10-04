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

## Aprendizaje diario (2026-10-04, migración 0020)

El laboratorio acumula memoria todos los días. Un modelo de IA no se entrena solo: "aprender" es guardar lo que pasó y pasárselo a los bots en el briefing. Hay tres capas; las dos primeras están hechas y la tercera va con la parte B.

**1. Diario de mercado (IA, una nota por rueda).** `aprendizaje.ts` arma en código los hechos de la rueda (mayores movimientos más VOO y QQQ de referencia, macro y Argentina de los últimos 4 días, las 10 noticias más relevantes, eventos del monitor, presentaciones de la SEC, calendario de 7 días y señales de hoy) y `modelo_decision` (`gemini-3.6-flash`) escribe 4 a 7 líneas, 3 a 5 puntos clave y qué mirar. La IA solo interpreta: no calcula ni trae datos propios, y el prompt le prohíbe inventar causas ("sin causa clara en los datos") y dar recomendaciones. Se guarda en `lab_diario` junto con los `hechos` exactos que vio. Si el modelo principal está saturado (503/429) prueba una sola vez con `modelo_resumen`. Solo se escribe si el mercado cerró hoy (no en feriados); `?forzar=diario` escribe el de la última rueda disponible. Costo medido: US$0,001 a 0,010 por día (~US$0,03 a 0,30 por mes), dentro del tope compartido.

**2. Estadísticas de eventos (sin IA).** `eventos.ts` mide qué hizo el precio 1, 5 y 20 ruedas después de 8 eventos técnicos (RSI que cruza 30 o 70, caída o suba de 3% o más en un día, nuevo máximo o mínimo de 52 semanas, cruce de la media de 200 días), por ticker y para todo el universo, y lo compara con el retorno de cualquier día. Se calcula con barras diarias del feed consolidado (SIP), 2.600 días (desde agosto de 2019: incluye la caída de 2020 y el mercado bajista de 2022), y se recalcula una vez por semana. Las señales que se activan en la última rueda quedan en `lab_senales`, ligadas a su estadística.

- **Sin mirar el futuro:** un evento en la rueda `i` se decide solo con datos hasta `i`; los indicadores son series incrementales y hay un test que verifica que cortar la serie en `i` da los mismos eventos que verla completa. Los retornos se miden desde el cierre del día del evento.
- **Mínimo de casos:** una estadística con menos de 20 casos no se le muestra a un bot ni a la pantalla (`MIN_CASOS`). Se prefiere la del propio ticker y, si tiene pocos casos, la de todo el universo.
- **Límites que hay que tener presentes:** (a) sesgo de supervivencia: el universo son empresas grandes que existen hoy y vienen siendo de las ganadoras, así que las estadísticas exageran lo que pasaría en general (por ejemplo "nuevo mínimo de 52 semanas" parece comprar barato porque estas acciones se recuperaron); (b) los casos de días seguidos se superponen, así que la muestra efectiva es menor que `n`; (c) el pasado no garantiza nada. La pantalla lo avisa.
- **Resultado honesto:** la mayoría de los eventos no le gana al día común. Medido el 2026-10-02 con 7 años: el cruce de la media de 200 días y los nuevos máximos rinden igual o peor que un día cualquiera a 5 ruedas; solo los nuevos mínimos y las caídas fuertes muestran rebotes mayores (con el sesgo de arriba). Es el tipo de verdad que el laboratorio tiene que mostrar, no esconder.

**3. Lecciones de los bots (parte B).** Cuando una decisión cumple su horizonte, el código mide el resultado y una llamada de IA escribe una lección corta que vuelve al briefing del bot. Necesita que los bots existan.

**Hacia los bots (parte B):** `memoria.ts` ya tiene las funciones que arman la memoria del briefing con tope de tamaño: `recortarDiarios` (últimas 5 notas, máx. 3.500 caracteres, descarta primero las viejas) y `armarSenales`/`estadisticaParaSenal` (solo estadísticas con casos suficientes). La memoria va solo a los bots con perfil `completo` (A y B), nunca al C, para que la comparación del experimento siga limpia.

**Programación:** `/api/lab/aprendizaje` corre a las 23:30 UTC de lunes a viernes (después de `macro` 22:30 y `fundamentales` 23:15). Cambio asociado: las barras diarias de todo el laboratorio (indicadores incluidos) pasan del feed IEX al consolidado SIP, que el plan gratis permite para datos con más de 15 minutos: los cierres son los oficiales y el volumen es el del mercado completo (AAPL: 33 M de acciones contra 0,8 M en IEX). Los precios intradía del monitor siguen en IEX (es lo único en tiempo real del plan gratis).

**Verificación de punta a punta** (APIs reales, Gemini real y una base descartable con las migraciones 0018 a 0020 en orden): 384 filas de estadísticas con hasta 2.083 casos por evento, 2 señales de la última rueda (GOOGL cruzó su media de 200 días, QQQ marcó nuevo máximo anual) ligadas a su estadística, y un diario coherente con los datos. Un usuario puede leer todo con RLS pero no escribir en `lab_diario`. La primera corrida mostró un 503 de Gemini por alta demanda, de ahí el modelo alternativo.

## Bots simulados, parte B1 (2026-10-05, migración 0021)

Tres bots con US$1.000 ficticios cada uno en su propia cuenta paper de Alpaca (A, B y C; las keys van en `ALPACA_BOT_*`, nunca en la base). Responden las tres preguntas del experimento: A vs. B (¿reaccionar durante el día sirve?), B vs. C (¿más información mejora las decisiones?) y todos vs. un VOO virtual comprado el día 1 y nunca tocado. Esta parte B1 es el núcleo; la B2 suma las decisiones por evento del bot A, el aviso por Telegram y las lecciones.

| Bot | Información | Cuándo decide |
|---|---|---|
| A | Todo (precios, noticias, macro, fundamentales, calendario, diario, señales con su estadística) | Una vez por día (+ ante eventos, en la B2) |
| B | Todo | Una vez por día |
| C | **Solo** portafolio, límites e indicadores técnicos. Un test verifica que nunca recibe noticias, macro, fundamentales, calendario, diario, señales ni lecciones, aunque vengan en la entrada | Una vez por día |

**La IA propone y el código dispone.**
- `riesgo.ts` (puro, 24 tests): descarta tickers fuera del universo; recorta compras al máximo por posición (20%) y para conservar el efectivo mínimo (10%); corta en 3 operaciones por día priorizando por confianza; no deja vender lo que no hay (una venta de casi todo cierra la posición); y con un drawdown del 25% no aprueba compras y pausa el bot. Las compras **no usan el efectivo de ventas de la misma corrida** (en una cuenta real todavía no liquidó): rotar tarda un día. Cada recorte o descarte deja su motivo.
- **Solo paper:** `alpacaPaper.ts` valida en cada pedido que la URL sea exactamente `https://paper-api.alpaca.markets` (rechaza api.alpaca.markets, http, dominios parecidos, puertos y trucos con `usuario@`, todo con tests). No existe modo real ni flag para activarlo.
- **Un modelo para los tres:** `gemini-3.5-flash`. En la prueba del 2026-10-04 fue el único que respondió 3 de 3 (3.6: 2 de 3, 3.8: 1 de 3, 3.7: 0 de 3 con 503; el 3.1 Pro dio 429 sin cupo). Además el precio de los 3.6 a 3.8 se duplica el 2027-01-01 (de US$0,75/3,75 a 1,50/7,50 por millón), así que la diferencia de costo es chica. Si la IA falla ese día, el bot **no opera** (no se cambia a un modelo más débil: ensuciaría la comparación) y la ventana horaria del cron reintenta.
- **Decisión diaria:** a las 10:30 de Nueva York (una hora después de la apertura), con tres horarios UTC en el cron (el cambio de horario de EE.UU. mueve la apertura) y una ventana de 10:15 a 12:30 en el endpoint; es idempotente (una decisión por bot y por día). Órdenes a mercado por monto (fraccionarias), válidas por el día; las que no se ejecutan enseguida se concilian en el cierre.
- **Registro completo:** `lab_corridas` guarda exactamente el briefing que vio la IA, su respuesta, el modelo, los tokens y el costo; `lab_decisiones` guarda lo propuesto, lo aprobado, lo que recortó el gestor y por qué, y la orden de Alpaca con su precio de ejecución. También quedan las decisiones de "no hacer nada".
- **Cierre del día** (22:10 UTC): `lab_snapshots` guarda el valor de cada bot (con sus posiciones) y del benchmark VOO, concilia órdenes y calcula el costo de IA acumulado de cada bot: lo propio más una parte igual del costo compartido de noticias y diario, que solo pagan los bots que los usan (el C no).
- **Arrancan en pausa:** desde la pestaña Lab, "Activar laboratorio" crea los bots (si faltan), marca la fecha de inicio de los 6 meses y los despausa; el benchmark VOO se "compra" la primera vez que corre una decisión. También se pueden pausar de a uno o todos juntos.
- **Presupuesto:** con el tope mensual alcanzado el bot no llama a la IA (`sin_presupuesto`); los gastos de noticias, diario y bots se suman en `lab_costos_ia`.

**Briefing con tope de tamaño** (28.000 caracteres, ~8.000 tokens): si se pasa, recorta de a poco primero lo que menos pesa (lecciones, presentaciones de la SEC, calendario, noticias, diario, señales, macro y al final fundamentales) y deja constancia de qué recortó. Nunca toca el portafolio ni los indicadores.

**Costo medido** (decisiones simuladas con Gemini real el 2026-10-05): A US$0,0231, B US$0,0249 y C US$0,0238 por decisión. El C no sale más barato de lo que se esperaba: su briefing es 2,7 veces más chico (4.200 caracteres contra 11.400) pero casi todo el costo es el "pensamiento" del modelo (2.239 tokens de salida del C contra 1.721 y 1.919 del A y el B). Con 3 bots y ~22 ruedas por mes son unos US$1,6 por mes, más lo que sumen los eventos del A en la B2.

**Verificación de punta a punta** (APIs reales, Gemini real y una base descartable con las migraciones 0018 a 0021): decisión simulada de los 3 bots en 11 segundos con sus cuentas reales de Alpaca; una orden real de US$1 en la cuenta C que Alpaca aceptó y se canceló, dejando la cuenta intacta; el cierre guarda un snapshot por bot sin duplicar al repetirse; el panel funciona con RLS (otro usuario no ve ni puede pausar tus bots). Sin verificar: una corrida real con órdenes ejecutadas (requiere el mercado abierto; cubierta por tests con Alpaca simulado) y la conciliación de una orden ejecutada.

## Bots simulados, parte B2 (2026-10-05, migración 0022)

Completa el diseño de la Fase 6: decisiones por evento del bot A, aviso por Telegram y la capa 3 del aprendizaje (lecciones). Quedan para la parte C la comparación entre bots, el diario por bot y la evaluación a 6 meses.

**Decisión por evento del bot A (el único reactivo).** El monitor (cada 15 minutos con el mercado abierto) ahora conoce las posiciones reales del bot A en su cuenta paper, los precios que vio en su última decisión y cuántas decisiones por evento lleva hoy (`reactivo.ts`). Un evento lo despierta si:
- Un ticker del universo se mueve 3% o más **contra el precio de la última decisión del bot** (no contra el cierre anterior), el VIX sube 10% o más contra la rueda anterior, sale una noticia con relevancia de 0,8 o más sobre un ticker en el que el bot tiene posición, o una empresa en la que tiene posición presenta balance hoy.
- Y ya hizo su decisión diaria de hoy (esa ya mira todo): antes, los eventos se registran pero no lo despiertan. Si la diaria falló con error, el monitor espera a que el cron la reintente.
- Y no llegó al máximo de 2 decisiones por evento por día ni está dentro del cooldown de 60 minutos desde la última (se cuentan decisiones reales del bot, no eventos marcados).
- Como mucho una decisión por corrida del monitor. Un evento se registra una vez por día y tipo (por ejemplo un movimiento de NVDA hacia arriba): si sigue subiendo, no vuelve a disparar ese mismo día.
La decisión pasa por el mismo briefing, el mismo gestor de riesgo (que cuenta las operaciones del día, incluidas las de la decisión diaria) y el mismo registro que la diaria, con `disparador = evento` y el id del evento.

**Aviso por Telegram.** Cuando el bot A decide por un evento llega un mensaje corto que empieza con "SIMULADO — plata ficticia": qué evento lo despertó, qué compró o vendió y por qué, o que decidió no operar (o que no pudo decidir por una falla de la IA o por el tope de presupuesto), y el pie "Experimento simulado, no es asesoramiento financiero". **Máximo 3 mensajes del laboratorio por día**: se reserva un lugar en `alertas_enviadas` (claves `lab_aviso_1` a `_3`, la clave única impide pasarse aunque dos corridas coincidan) y se libera si Telegram falla. También se suma la tabla de posiciones (los tres bots y el VOO sin tocar, de mejor a peor) al resumen semanal del domingo. Un fallo de Telegram nunca frena la decisión ni el monitor.

**Lecciones (capa 3).** Una vez por día, dentro del job de aprendizaje, para cada decisión **ejecutada** (orden `filled`) de un bot con perfil completo que ya cumplió 5 ruedas:
- El código mide el resultado contra el precio de ejecución real y contra VOO entre las mismas fechas (barras del feed consolidado). Compra: aportó lo que el ticker rindió de más o de menos que VOO. Venta: aportó lo que VOO rindió de más que el ticker vendido (evitar una caída suma, perderse una suba resta). Más de 1 punto de diferencia es "acertó" o "erró"; menos, "neutral". Si faltan las barras o todavía no pasaron las 5 ruedas, no se evalúa (nunca se inventa un dato).
- Una llamada de IA por bot redacta una lección de 1 a 2 frases por caso, con una advertencia obligatoria: es un solo caso de pocas ruedas y puede ser suerte; no inventa causas ni hace cuentas.
- Cada bot aprende **solo de sus propias decisiones** y recibe sus últimas 5 lecciones en el briefing (con el prompt aclarando que son contexto, no reglas). El bot C no tiene memoria por diseño: no genera ni recibe lecciones.
- Se guardan en `lab_lecciones` con el resultado, el de VOO y el veredicto, se muestran en la tarjeta de cada bot y no se duplican si el job se repite.

**Verificación de punta a punta** (APIs reales, Gemini real, base descartable con las migraciones 0018 a 0022; las decisiones se sembraron con fechas y precios reales de septiembre): la compra de GOOGL del 21/9 a US$354,00 dio -3,18% contra -1,29% de VOO ("erró", -1,89 puntos) y la venta de KO del 22/9 a US$88,50 dio -1,88% contra -1,45% ("neutral", +0,43), idéntico al cálculo a mano; una decisión del 1/10 (todavía sin 5 ruedas) y la del bot C se salteron; repetir el job no duplicó; el bot A vio sus 2 lecciones en el briefing, el B ninguna y el C ni lecciones ni noticias. Costo medido: US$0,022 por llamada de lecciones de un bot (con 2 casos; casi todo es el pensamiento del modelo), así que con pocas decisiones por semana son centavos por mes. El cableado del monitor con el bot A (movimiento contra la última decisión, esperar a la diaria, máximo por día, cooldown, sin bot reactivo, falla de Telegram) está cubierto por tests con Alpaca y base simulados.

**Sin verificar en vivo:** una decisión por evento con el mercado abierto y un mensaje real de Telegram del laboratorio (el envío usa el mismo cliente de Telegram que los demás avisos; lo que hay de nuevo —redacción, tope de 3 por día, reserva y liberación— está cubierto por tests).

## Bots simulados, parte C: comparación y evaluación (2026-10-05, sin migración)

Cierra el diseño de la Fase 6: la pestaña Lab responde con números las tres preguntas del experimento. No hay cambios de base de datos: todo sale de los snapshots, las decisiones y los costos que ya se guardan.

- **Métricas** (`metricas.ts`, puro, 19 tests con series armadas a mano): por bot y para el benchmark, rendimiento bruto y **neto de IA** (`(valor − costo de IA) / capital − 1`), caída máxima desde un pico, volatilidad anualizada (desvío de los retornos entre cierres por la raíz de 252; con menos de 3 puntos devuelve "sin dato" en vez de inventar un número), cantidad de operaciones y porcentaje que va ganando hoy (una compra gana si el precio actual supera lo que pagó; una venta gana si el precio quedó por debajo de donde vendió; es un resultado "a hoy", no realizado).
- **Las tres preguntas** (`compararPreguntas`): ¿más información mejora las decisiones? (B contra C), ¿reaccionar durante el día mejora las decisiones? (A contra B, con las operaciones y el costo de IA de diferencia) y ¿alguno le gana a comprar VOO y no hacer nada? (rendimiento neto de cada bot menos el bruto de VOO). Si falta un bot o el benchmark, esa comparación queda en "sin datos" y no se inventa.
- **Evaluación:** tarjeta con solo números y sin opinión (un test verifica que no usa palabras como mejor, peor, ganó o recomendar), siempre terminada con "6 meses es poco para descartar suerte". La app no ofrece pasar a plata real.
- **Tabla de posiciones** ordenada por rendimiento neto de IA, con el VOO sin tocar incluido.
- **Gráfico** de 4 líneas (A, B, C y VOO) con selector de rango: *Hoy* usa snapshots intradía (el monitor guarda el valor de cada bot y del benchmark cada 15 minutos con el mercado abierto, nunca más de uno cada 10 minutos, y un fallo ahí no frena al monitor), *Semana*, *Mes* y *Todo* usan los cierres diarios y, para el día que todavía no cerró, el último valor intradía.
- **Diario por bot:** las últimas 8 corridas de cada bot con disparador, modelo, qué propuso, qué aprobó, lo que recortó el gestor de riesgo, la orden y el precio de ejecución, y un botón que abre el briefing exacto que vio la IA (`GET /api/laboratorio/corridas/[id]`, con RLS: cada usuario solo abre las suyas). También un "briefing del día" con cómo ve cada bot el mercado en su última decisión.
- **Presupuesto de IA del mes** contra el tope, con desglose por tipo (noticias y diario compartidos, decisiones, lecciones) y por bot.
- **Costo de IA por bot** (spec, regla 6): lo propio más una parte igual del costo compartido de noticias y diario, que solo pagan los bots que los usan (el C no).

**Verificación** (base descartable con las migraciones 0018 a 0022 y 4 días de snapshots sembrados): todo coincide con el cálculo a mano. Netos de IA A +3,95%, B +1,96%, C +0,99% y VOO +1,20% (tabla en ese orden: A, B, VOO, C); reaccionar +1,99 puntos con 1 operación más y US$0,10 más de IA; más información +0,97 puntos con US$0,30 más de IA; contra VOO A +2,75, B +0,76 y C −0,21; caída máxima de A 0,97%; el bot A con 2 operaciones y 50% ganando, el B con 1 y 100%; presupuesto US$0,592 de US$10 (5,9%). La pantalla completa se renderizó del lado servidor con todas las secciones. **Sin ver todavía:** el gráfico dibujado en un navegador real (se verificó con tests la lógica que arma las series, no el dibujo) y datos reales de los bots (empiezan a llegar con las primeras ruedas).

