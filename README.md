# gastos-voz

Sistema personal de registro de gastos e ingresos. Captura principal por audio de Telegram, visualización en PWA. Un solo usuario, sin SaaS.

Arquitectura: Telegram (audio/texto/foto) → n8n → Gemini Flash (extracción estructurada) → Supabase → PWA con gráficos.

Ver `NOTES.md` para el detalle de verificación de la API de Gemini (modelo, endpoint, structured output).

## 1. Crear el bot en BotFather

1. Hablále a [@BotFather](https://t.me/BotFather) en Telegram.
2. `/newbot` → elegí nombre y username (debe terminar en `bot`).
3. Guardá el token que te da (`TELEGRAM_BOT_TOKEN`).
4. Mandale un mensaje cualquiera a tu bot nuevo desde tu cuenta.
5. Para obtener tu `chat_id`: abrí `https://api.telegram.org/bot<TOKEN>/getUpdates` en el navegador después de mandarle el mensaje, y buscá `"chat":{"id": ...}` en la respuesta. Ese número es `MY_TELEGRAM_CHAT_ID`.

## 2. Variables de entorno (Easypanel / Docker Compose de n8n)

```
MY_TELEGRAM_CHAT_ID=123456789
GEMINI_API_KEY=AIza...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NODE_FUNCTION_ALLOW_EXTERNAL=axios
```

`TELEGRAM_BOT_TOKEN` **no** va como env var acá — se configura como credencial nativa de n8n (ver paso 3). Los Code nodes usan `axios` para llamar a Gemini y Supabase directamente (mismo patrón que otros proyectos), por eso necesitan `NODE_FUNCTION_ALLOW_EXTERNAL=axios`.

Reiniciá el contenedor de n8n después de agregar las env vars.

## 3. Credencial de Telegram en n8n

En n8n: Credentials → New → Telegram API → pegá el `TELEGRAM_BOT_TOKEN` de BotFather. Nombrala **"Telegram Bot gastos-voz"** (así matchea el nombre que trae el JSON — igual vas a tener que remapear el `credentialId` al importar, es normal, cada instancia de n8n tiene sus propios IDs).

## 4. Migraciones de Supabase

Corré en orden, desde el SQL Editor de Supabase o con la CLI:

```bash
# opción CLI (si tenés supabase-cli configurado con el proyecto linkeado)
supabase db push

# opción manual: pegar cada archivo en el SQL Editor del dashboard, en orden
# 0001_init.sql
# 0002_seeds.sql
# 0003_agregaciones.sql
```

Verificá después:
```sql
select count(*) from categorias; -- debería dar 16
```

## 5. Importar el workflow en n8n

1. n8n → Workflows → Import from File → `n8n/01_captura_audio.json`.
2. Reasigná la credencial de Telegram en los 4 nodos que la usan (Trigger + 3 de mensaje/archivo).
3. **Revisá el nodo Telegram Trigger:** al activar el workflow, n8n genera el webhook automáticamente — no hace falta configurarlo a mano en BotFather.
4. Dejalo **desactivado** hasta probarlo manualmente una vez (podés ejecutar el workflow a mano desde el editor mandándote un audio de prueba primero, con "Listen for test event").

## 6. Probar con audio real (antes de dar la rama por buena)

Mandale un audio a tu bot diciendo algo simple: *"cargué 20 lucas de nafta en efectivo"*. Revisá:

- Que `Code - Gemini extraccion` devuelva el JSON esperado (abrí la ejecución en n8n y mirá el output del nodo).
- Que se haya insertado la fila en `movimientos` en Supabase.
- Que te llegue el mensaje de confirmación con los 3 botones.
- Probá también un audio ambiguo tipo *"gasté algo de plata"* → debería responder pidiendo aclaración, sin insertar nada.

Si Gemini rechaza el audio OGG de Telegram (poco probable según la doc, pero puede pasar con algún códec raro), hay que agregar un paso de conversión a MP3 con ffmpeg vía Execute Command antes del nodo `Code - Gemini extraccion` — no está implementado todavía porque no se puede confirmar que haga falta sin probar con audio real primero.

## Notas de arquitectura

- **Supabase vía Code+axios, no nodo nativo:** el nodo nativo de Supabase con `getAll` devuelve 0 items si no matchea ningún row, lo que hace que el item desaparezca en silencio en vez de insertarse con `categoria_id: null`. Con axios controlamos ese caso explícitamente.
- **Manejo de errores:** cada nodo crítico tiene `onError: continueErrorOutput`, así que cualquier falla (Telegram caído, Gemini con error, Supabase rechazando el insert) manda una alerta por Telegram en vez de fallar en silencio.
- **Nodos de Telegram/Supabase con schema no 100% verificado:** los armé con la estructura estándar de n8n (`inlineKeyboard`, filtros REST), pero no los pude probar contra una instancia real. Si algo no importa bien, es más probable que sea el nodo `Telegram - Confirmar registro` (el `inlineKeyboard`) — si tira error al importar, reconstruí los 3 botones a mano desde la UI, es rápido.
