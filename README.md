# gastos-voz

Registro de gastos e ingresos por voz, texto o foto. Le hablás, le escribís o le sacás una foto al ticket, y la app entiende, categoriza y guarda el movimiento solo — sin formularios.

**App en producción:** *(agregar URL de Vercel acá una vez desplegada)*

---

## Qué hace

- **Captura sin fricción** — grabás un audio ("gasté 3000 pesos en el kiosco"), escribís, o sacás una foto de un ticket. Un modelo de lenguaje (Gemini) interpreta el mensaje y extrae monto, categoría, comercio, método de pago y fecha, incluso con modismos rioplatenses ("20 lucas", "2 palos", "un verde").
- **Categorización automática** — matchea contra reglas propias del usuario (ej. "McDonald's" → siempre Delivery/Restaurantes) antes de usar el criterio del modelo.
- **Cuotas** — si mencionás "en 6 cuotas", divide el monto y programa cada cuota en el mes que corresponde automáticamente.
- **Confianza baja = no inventa** — si no puede determinar el monto con seguridad, pide aclaración en vez de adivinar.
- **Dashboards** — vistas de Hoy, Semana, Mes y Año con KPIs, gasto acumulado vs. período anterior, distribución por categoría, top comercios y un heatmap de actividad anual estilo GitHub.
- **Tabla completa** — todos los movimientos, filtrables por fecha/categoría/método de pago/comercio/monto, con edición inline, borrado y exportación a CSV.
- **Multi-usuario** — cada cuenta ve únicamente sus propios datos (aislamiento a nivel de base de datos, no solo de interfaz).
- **PWA instalable** — funciona como app nativa en el celular, con soporte offline básico para la interfaz.
- **Notificaciones por Telegram** — confirmación de cada movimiento registrado, sin depender de tener la app abierta.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend / Backend | [Next.js](https://nextjs.org) (App Router, TypeScript) |
| Base de datos | [Supabase](https://supabase.com) (Postgres + Auth + Row Level Security) |
| IA | [Gemini Flash](https://ai.google.dev) — extracción estructurada desde audio, imagen y texto |
| Gráficos | [Recharts](https://recharts.org), paleta validada para daltonismo |
| Notificaciones | Telegram Bot API |
| Hosting | [Vercel](https://vercel.com) |

## Arquitectura

```
Usuario (audio / texto / foto)
        │
        ▼
   PWA (Next.js) ──────────► API routes propias
        │                          │
        │                          ▼
        │                    Gemini Flash (extracción estructurada)
        │                          │
        │                          ▼
        │                    Supabase (Postgres + RLS por usuario)
        │                          │
        └──────────────────────────┴──► Dashboards (Hoy / Semana / Mes / Año / Todos)
                                    │
                                    ▼
                              Telegram (confirmación)
```

Toda la lógica de negocio vive en API routes de Next.js — no hay orquestador externo. Las claves sensibles (service role de Supabase, API key de Gemini) nunca se exponen al navegador.

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
```

Verificá: `select count(*) from categorias;` → 17.

La autenticación es self-service: cualquier usuario puede crear su cuenta desde `/signup` (o creála vos a mano en Authentication → Users).

Claves necesarias (Supabase → Settings → API):

| Variable | De dónde sale |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (marcada "secret") |

### 2. Gemini

`GEMINI_API_KEY` desde [aistudio.google.com](https://aistudio.google.com) → Get API key.

### 3. Telegram (opcional — solo notificaciones salientes)

1. Creá un bot con [@BotFather](https://t.me/BotFather) → `TELEGRAM_BOT_TOKEN`.
2. Tu `chat_id` (mandale un mensaje al bot y consultá `https://api.telegram.org/bot<TOKEN>/getUpdates`) → `MY_TELEGRAM_CHAT_ID`.
3. `ADMIN_EMAIL` — el email de la cuenta que debe recibir las notificaciones (por ahora las notificaciones son solo para esa cuenta; no están vinculadas por usuario todavía).

Sin esto configurado, la app funciona igual — simplemente no manda avisos.

### 4. Variables de entorno

Copiá `.env.example` a `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
TELEGRAM_BOT_TOKEN=
MY_TELEGRAM_CHAT_ID=
ADMIN_EMAIL=
```

### 5. Correr local

```bash
npm install
npm run dev
```

### 6. Deploy en Vercel

```bash
vercel link
vercel env add   # cargar cada variable de arriba
vercel --prod
```

---

## Decisiones de diseño

- **Sin orquestador externo.** El proyecto arrancó sobre n8n + Telegram como capa de captura (ver `n8n/` y el historial de commits); se migró todo a código de aplicación por la fricción de mantener workflows visuales a mano. `n8n/` queda como referencia histórica, no se sigue desarrollando.
- **Reglas de comercio antes que IA.** Si un comercio ya tiene una regla propia (`reglas_comercio`), esa categoría gana sobre lo que sugiere el modelo — determinismo por sobre inferencia cuando el usuario ya dio la respuesta correcta una vez.
- **service_role nunca en el cliente.** Cada API route valida la sesión con la anon key primero; recién después usa la service role (que bypassea RLS) para escribir.
- **Tema oscuro fijo, mobile-first.** Sin gradientes ni sombras decorativas — números grandes, tipografía clara.

## Roadmap

- [ ] Presupuestos con alertas cuando se excede una categoría
- [ ] Detección de gastos duplicados
- [ ] Recurrentes y tipo de cambio automatizados (cron)
- [ ] Vinculación de Telegram por usuario (no solo la cuenta admin)
- [ ] Login con Google
- [ ] Consultas en lenguaje natural ("¿cuánto gasté en comida este mes?")
