# gastos-voz

Registro de gastos e ingresos por voz, texto o foto. Le hablás, le escribís, le preguntás, o le sacás una foto al ticket, y la app entiende, categoriza y guarda el movimiento solo — sin formularios.

**App en producción:** https://gastosvoz.vercel.app

---

## Qué hace

- **Captura sin fricción** — grabás un audio ("gasté 3000 pesos en el kiosco"), escribís, o sacás una foto de un ticket. Gemini interpreta el mensaje y extrae monto, categoría, comercio, método de pago y fecha, incluso con modismos rioplatenses ("20 lucas", "2 palos", "un verde").
- **Consultas en lenguaje natural** — le preguntás "¿cuánto gasté en comida este mes?" en el mismo cuadro de texto y te contesta, sin abrir ningún dashboard.
- **Categorización automática** — matchea contra reglas propias del usuario (ej. "Rappi" → siempre Delivery/Restaurantes; cada cuenta nueva arranca con reglas para comercios argentinos comunes) antes de usar el criterio del modelo.
- **Cuotas** — si mencionás "en 6 cuotas", divide el monto y programa cada cuota en el mes que corresponde automáticamente.
- **Detección de duplicados** — si registrás dos veces el mismo gasto el mismo día, te avisa (no bloquea, por si realmente compraste dos veces).
- **Presupuestos con alertas** — configurás un tope mensual por categoría y te avisa apenas lo cruzás. Se accede tocando el aro de presupuesto de la pantalla Hoy.
- **Confianza baja = no inventa** — si no puede determinar el monto con seguridad, pide aclaración en vez de adivinar.
- **Aro de presupuesto** — en Hoy, un aro circular muestra cuánto te queda del presupuesto mensual y se va vaciando a medida que gastás (se pone rojo si te pasás). Sin presupuesto configurado, invita a crear uno.
- **Dashboards** — un selector Semana/Mes/Año (pestaña "Resumen") con KPIs, gasto acumulado vs. período anterior, distribución por categoría, top comercios, heatmap de actividad anual estilo GitHub y buscador de gastos puntuales por nombre/comercio/categoría.
- **Tabla completa** — todos los movimientos, filtrables por fecha/categoría/método de pago/comercio/monto, con edición inline, borrado y exportación a CSV.
- **Recurrentes y dólar automáticos** — un cron diario carga los gastos fijos (alquiler, servicios) y actualiza la cotización del dólar sin intervención manual.
- **Multi-usuario** — cada cuenta ve únicamente sus propios datos (aislamiento a nivel de base de datos, no solo de interfaz).
- **Plan de inversión** — cada cobro de Clientes se reparte entre Gastos, Emergencia, Largo plazo, Aprender y Por invertir con una función determinística en TypeScript. Las compras chicas se acumulan hasta alcanzar el mínimo configurado. La app avisa por push y registra los saldos cuando confirmás que hiciste los movimientos en ARQ; nunca mueve dinero.
- **Cartera y rendimiento** — registra compras de activos por formulario, texto o voz, calcula costo promedio, valor, ganancia y comparación contra VOO. También estima el rendimiento nominal y real de las cuentas remuneradas.
- **Consultas sobre tu plan** — preguntás por voz o texto cuánto rinde un activo, cuánto falta para una meta o qué acción corresponde según tus propias reglas. Los cálculos salen del código y Gemini solo redacta con esos datos; cualquier sugerencia queda limitada a los activos de tu política.
- **Proyección del depto** — estima un rango pesimista, base y optimista con el ahorro real de seis meses y muestra cuánto acorta el plazo cada palanca: más proyectos, mejor precio, menos gasto o mayor rendimiento.
- **Laboratorio (simulado)** — pestaña "Lab" con un panel en vivo de lo que van a ver los bots de inversión simulados: precios del universo con RSI y tendencia, fundamentales, recomendaciones de analistas y movimientos de directivos, VIX y macro de EE.UU., riesgo país y dólares de Argentina, hechos materiales de la SEC, un diario de mercado escrito por IA cada rueda y estadísticas de lo que hizo el precio tras cada tipo de evento con 7 años de historia, noticias de todo el mundo resumidas con sentimiento y relevancia, calendario de balances y reuniones de la Fed, y el feed de eventos del monitor. Es un experimento con plata ficticia, aislado del plan real (tablas `lab_*`). Por ahora solo recolecta datos; los bots llegan en las próximas partes.
- **PWA instalable con notificaciones push** — funciona como app nativa en el celular, con cola offline (si capturás sin señal, se sube sola cuando vuelve la conexión) y avisos nativos del navegador sin depender de apps de terceros.
- **Auto-registro por email (opcional)** — conectás tu Gmail una vez (solo lectura) y cada gasto que hagas con Mercado Pago (u otra billetera que configures) se registra solo, leyendo el mail de confirmación con el mismo Gemini que interpreta un mensaje de texto.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend / Backend | [Next.js](https://nextjs.org) (App Router, TypeScript) |
| Base de datos | [Supabase](https://supabase.com) (Postgres + Auth + Row Level Security) |
| IA | [Gemini Flash](https://ai.google.dev) — extracción estructurada desde audio, imagen y texto |
| Gráficos | [Recharts](https://recharts.org), paleta validada para daltonismo |
| Notificaciones | Web Push nativo (`web-push`), sin intermediarios de terceros |
| Cron | Vercel Cron |
| Hosting | [Vercel](https://vercel.com) |

## Arquitectura

```
Usuario (audio / texto / foto / pregunta)
        │
        ▼
   PWA (Next.js) ──────────► API routes propias
        │                          │
        │                          ▼
        │                    Gemini Flash (extracción o consulta)
        │                          │
        │                          ▼
        │                    Supabase (Postgres + RLS por usuario)
        │                          │
        └──────────────────────────┴──► Hoy / Resumen / Plan / Cartera / Todos / Presupuestos
                                    │
                                    ▼
                         Web Push (confirmación, presupuesto excedido, recurrentes)

Vercel Cron ──► tipo de cambio, recurrentes, Gmail, precios y avisos de Telegram
```

Toda la lógica de negocio vive en API routes de Next.js — no hay orquestador externo. Las claves sensibles (service role de Supabase, API key de Gemini, clave privada VAPID) nunca se exponen al navegador.

---

## Puesta en marcha

### 1. Supabase

Corré las migraciones en orden desde el SQL Editor (o `supabase db push` con la CLI):

```
supabase/migrations/0001_init.sql
supabase/migrations/0002_seeds.sql
supabase/migrations/0003_agregaciones.sql
supabase/migrations/0004_categoria_alimentos.sql
supabase/migrations/0005_multi_tenant.sql
supabase/migrations/0006_agregaciones_anuales.sql
supabase/migrations/0007_push_y_reglas_default.sql
supabase/migrations/0008_categorias_propias_fotos_metas.sql
supabase/migrations/0009_plan_ahorro.sql
supabase/migrations/0010_gmail_integracion.sql
supabase/migrations/0011_gmail_readonly.sql
supabase/migrations/0012_presupuesto_general.sql
supabase/migrations/0014_inversiones_fase_1.sql
supabase/migrations/0015_cartera.sql
supabase/migrations/0016_telegram.sql
supabase/migrations/0017_proyeccion_depto.sql
```

Verificá: `select count(*) from categorias;` → 17.

La autenticación es self-service: cualquier usuario puede crear su cuenta desde `/signup` (o creála vos a mano en Authentication → Users). Cada cuenta nueva recibe automáticamente un set de reglas de comercio comunes de Argentina (Rappi, Coto, Edesur, Netflix, YPF, etc.).

Claves necesarias (Supabase → Settings → API):

| Variable | De dónde sale |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (marcada "secret") |

### 2. Gemini

`GEMINI_API_KEY` desde [aistudio.google.com](https://aistudio.google.com) → Get API key.

### 3. Web Push (opcional — notificaciones nativas)

Generá el par de claves VAPID una vez:

```bash
npx web-push generate-vapid-keys
```

Te da `NEXT_PUBLIC_VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`. `VAPID_SUBJECT_EMAIL` es cualquier email de contacto (requisito del protocolo, no se usa para nada más). Sin esto configurado, la app funciona igual — simplemente no manda avisos.

### 4. Precios de la cartera

Creá una API key gratuita en [Twelve Data](https://twelvedata.com) y guardala como `TWELVE_DATA_API_KEY`. El cron de lunes a viernes consulta el cierre diario de cada ticker de mercado incluido en alguna política. Si el proveedor falla, la app conserva el último precio y lo marca como desactualizado.

### 5. Cron (recurrentes + tipo de cambio + Gmail + precios)

`CRON_SECRET` — cualquier string random largo (`openssl rand -hex 24`). Vercel lo manda automáticamente como header `Authorization: Bearer <valor>` en cada invocación programada (ver `vercel.json`); las rutas lo validan y rechazan cualquier otro llamado.

### 6. Gmail — auto-registro de gastos (opcional)

Lee la casilla del usuario buscando mails de billeteras virtuales (Mercado Pago por default, configurable) y registra el gasto solo, con el mismo pipeline de Gemini que un mensaje de texto. La app **no** mueve plata ni tiene permiso de escritura sobre el mail, solo lectura (`gmail.readonly`), y cada mail leído se etiqueta para no reprocesarlo.

1. En [Google Cloud Console](https://console.cloud.google.com/apis/credentials), en el mismo proyecto que uses para Gemini (o uno nuevo):
   - Habilitá la **Gmail API** (APIs & Services → Library).
   - Configurá la pantalla de consentimiento OAuth (External está bien para uso personal; agregate como test user si queda en modo "Testing").
   - Creá una credencial **OAuth 2.0 Client ID**, tipo "Web application".
   - En "Authorized redirect URIs" agregá `https://TU-DOMINIO/api/gmail/callback` (prod) y `http://localhost:3000/api/gmail/callback` (local).
2. Variables: `GOOGLE_GMAIL_CLIENT_ID` y `GOOGLE_GMAIL_CLIENT_SECRET` (los de esa credencial). Sin esto, la app funciona igual — la card de "Auto-registro por email" en Presupuestos muestra error al tocar "Conectar con Gmail" en vez de romper.
3. Desde la app: Presupuestos → "Conectar con Gmail" → autorizás una vez. El cron diario (`/api/cron/gmail-mp`, 10:30 UTC) revisa la casilla solo; también hay un botón "Revisar ahora" para probarlo al toque.

### 7. Variables de entorno

Copiá `.env.example` a `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT_EMAIL=
CRON_SECRET=
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TWELVE_DATA_API_KEY=
GOOGLE_GMAIL_CLIENT_ID=
GOOGLE_GMAIL_CLIENT_SECRET=
ALPACA_API_KEY_ID=
ALPACA_API_SECRET_KEY=
FRED_API_KEY=
FINNHUB_API_KEY=
LAB_CRON_SECRET=
SEC_USER_AGENT=
```

### 8. Correr local

```bash
npm install
npm run dev
```

### 9. Deploy en Vercel

```bash
vercel link
vercel env add   # cargar cada variable de arriba
vercel --prod
```

### 10. Telegram

El bot `@investfoco_bot` recibe texto y audio con el mismo flujo de captura que la PWA. También ofrece `/resumen`, `/cartera`, `/plan`, `/sugerencias` y `/cobre 700000`. La vinculación se inicia desde **Presupuestos → Telegram** con un código de seis dígitos que vence a los 10 minutos.

Después de desplegar, registrar el webhook HTTPS con `setWebhook` apuntando a `https://gastosvoz.vercel.app/api/telegram/webhook`, enviando el mismo valor de `TELEGRAM_WEBHOOK_SECRET` en `secret_token` y limitando `allowed_updates` a `message` y `callback_query`. El servidor verifica el header `X-Telegram-Bot-Api-Secret-Token` en cada entrega.

Los avisos de mercado se ejecutan después de actualizar precios y se deduplican por usuario y fecha. El resumen semanal se envía los domingos a las 20:00 de Argentina. Todos los avisos financieros incluyen el aviso de que son sugerencias según el plan y no asesoramiento financiero.

### 11. Laboratorio (simulado)

Datos de mercado para el experimento de bots simulados. Todo es gratis y no mueve plata.

1. **Alpaca** — creá una cuenta en [alpaca.markets](https://alpaca.markets) y generá las keys de *paper trading*: `ALPACA_API_KEY_ID` y `ALPACA_API_SECRET_KEY`. Se usan para los precios (feed IEX del plan gratuito), las noticias por empresa y el reloj del mercado. Más adelante hacen falta las keys de las 3 cuentas paper de los bots.
2. **FRED** — key gratis en [fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html): `FRED_API_KEY` (VIX, tasa de la Fed, inflación, desempleo, curva de tasas, petróleo).
3. **Finnhub** — key gratis en [finnhub.io](https://finnhub.io): `FINNHUB_API_KEY` (calendario de balances).
4. **`LAB_CRON_SECRET`** — `openssl rand -hex 32`. Cargalo en Vercel y en `scripts/lab-pg-cron.sql`.
5. **`SEC_USER_AGENT`** — la SEC exige identificarse: `gastos-app tu-mail@ejemplo.com`. Sin key. Las demás fuentes nuevas (argentinadatos, dolarapi) tampoco piden key.
6. Aplicá las migraciones `0018_laboratorio_datos.sql`, `0019_laboratorio_fuentes.sql` y `0020_laboratorio_aprendizaje.sql` y ejecutá `scripts/lab-pg-cron.sql` en el SQL Editor de Supabase. Vercel Hobby solo permite crons diarios, así que la frecuencia de 15 y 30 minutos la maneja Supabase con `pg_cron` + `pg_net` (ver `NOTES.md`, Fase 6A).

Para probar a mano: `curl -H "Authorization: Bearer $LAB_CRON_SECRET" https://gastosvoz.vercel.app/api/lab/macro` (primero `macro`, que carga indicadores, macro, Argentina y calendario; después `fundamentales`, `aprendizaje?forzar=todo`, `noticias` y `monitor`; `gdelt` está pausado).

---

## Decisiones de diseño

- **Sin orquestador externo.** El proyecto arrancó sobre n8n + Telegram como capa de captura (ver `n8n/` y el historial de commits); se migró todo a código de aplicación por la fricción de mantener workflows visuales a mano, y las notificaciones pasaron de Telegram a Web Push nativo para no depender de una cuenta de terceros por usuario. `n8n/` queda como referencia histórica, no se sigue desarrollando.
- **Reglas de comercio antes que IA.** Si un comercio ya tiene una regla propia (`reglas_comercio`), esa categoría gana sobre lo que sugiere el modelo — determinismo por sobre inferencia cuando el usuario ya dio la respuesta correcta una vez.
- **service_role nunca en el cliente.** Cada API route valida la sesión con la anon key primero; recién después usa la service role (que bypassea RLS) para escribir.
- **Presupuesto se avisa una sola vez por cruce.** El chequeo compara el total antes/después de cada movimiento — solo notifica en la transacción que efectivamente cruza el umbral, no en cada gasto posterior.
- **Tema oscuro fijo, mobile-first.** Números grandes, tipografía clara, nav inferior fijo para uso con el pulgar.
- **`gmail_integracion` sin policies para `authenticated`.** El refresh_token de Gmail es más sensible que el resto de los datos del usuario (da acceso de lectura a la casilla completa) — ni el propio dueño puede leer/escribir esa fila desde el cliente, todo pasa por rutas server-side auditadas con `service_role` (ver `SECURITY.md`).

## Roadmap

- [ ] Login con Google
- [x] Vinculación de Telegram por usuario como canal alternativo a Web Push
- [ ] Vinculación de WhatsApp por usuario
- [ ] Background Sync API para la cola offline (hoy reintenta con el evento `online`, no con sync real en segundo plano)
