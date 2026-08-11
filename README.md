# gastos-voz

Sistema personal de registro de gastos e ingresos. Todo vive en una sola PWA: capturás por voz/texto/foto y ves los gráficos en el mismo lugar. Un solo usuario, sin SaaS.

Arquitectura: PWA (Next.js, Vercel) → API routes propias → Gemini Flash (extracción estructurada) → Supabase. Notificaciones salientes por Telegram (solo avisos, no captura).

Ver `NOTES.md` para el detalle de verificación de la API de Gemini (modelo, endpoint, structured output).

> **Nota:** el proyecto arrancó con captura por n8n + Telegram (carpeta `n8n/`, ver commits viejos). Se retiró n8n del flujo de captura por la fricción de editar workflows a mano — queda como referencia, no se sigue desarrollando. `WF04` (recurrentes) y `WF05` (tipo de cambio) todavía están pendientes de portar a cron jobs de Vercel.

## 1. Supabase

### Migraciones

Corré en orden desde el SQL Editor de Supabase (o `supabase db push` si tenés la CLI linkeada):

```
supabase/migrations/0001_init.sql
supabase/migrations/0002_seeds.sql
supabase/migrations/0003_agregaciones.sql
supabase/migrations/0004_categoria_alimentos.sql
```

Verificá: `select count(*) from categorias;` → 17.

### Usuario de login

La app tiene un solo usuario. Creálo en Supabase → Authentication → Users → **Add user**, con email + contraseña, marcado como confirmado (no hace falta que mande mail de verificación).

### Claves que necesitás

Supabase → Settings → API:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role key** (dice "secret" al lado) → `SUPABASE_SERVICE_ROLE_KEY`

## 2. Gemini

`GEMINI_API_KEY` desde [aistudio.google.com](https://aistudio.google.com) → Get API key.

## 3. Telegram (solo notificaciones)

1. Bot ya creado con BotFather (`@gastamos_bot` si es el mismo de antes) → `TELEGRAM_BOT_TOKEN`.
2. Tu `chat_id` (sacalo con `https://api.telegram.org/bot<TOKEN>/getUpdates` después de mandarle un mensaje al bot) → `MY_TELEGRAM_CHAT_ID`.

Esto es opcional — si no lo configurás, la app funciona igual, simplemente no manda avisos.

## 4. Variables de entorno

Copiá `.env.example` a `.env.local` y completá:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
TELEGRAM_BOT_TOKEN=
MY_TELEGRAM_CHAT_ID=
```

## 5. Correr local

```bash
npm install
npm run dev
```

Abrí `http://localhost:3000`, te redirige a `/login`. Entrá con el usuario que creaste en Supabase.

## 6. Deploy en Vercel

```bash
vercel link
vercel env pull   # o cargá las mismas env vars de arriba en el dashboard de Vercel
vercel --prod
```

## 7. Probar con datos reales (antes de dar la captura por buena)

- Grabá un audio corto: "gasté 500 pesos en el kiosco" → tiene que aparecer en la lista de "Hoy" al toque.
- Probá un texto ambiguo: "gasté algo de plata" → tiene que avisar que no entendió el monto, sin registrar nada.
- Sacale foto a un ticket cualquiera y mandala.
- Borrá un movimiento con el 🗑 de la lista y confirmá que desaparece de Supabase también.

## Notas de arquitectura

- **Auth:** Supabase Auth con `@supabase/ssr`, sesión en cookies, `proxy.ts` (ex-`middleware.ts`, renombrado en Next 16) protege todas las rutas menos `/login`.
- **service_role solo en el servidor:** las API routes verifican la sesión del usuario primero (`crearClienteServidor`), y recién después usan `crearClienteServicio` (service_role, bypassea RLS) para escribir. Nunca se expone la service_role key al browser.
- **Categorización:** mismo criterio que tenía n8n — primero busca en `reglas_comercio` (patrón de texto → categoría fija), si no matchea usa la categoría que sugirió Gemini.
- **Tema oscuro fijo** (no sigue el tema del sistema), mobile-first, sin gradientes ni sombras exageradas — como pediste en la spec original.

## Pendiente

- Vistas Semana / Mes / Año / Todos de la PWA (por ahora solo está "Hoy").
- Cuotas (insert padre + N-1 hijos).
- WF04/WF05 (recurrentes y tipo de cambio) portados a Vercel Cron.
- Consultas en lenguaje natural + digest semanal/mensual.
- Iconos reales del manifest (`/icon-192.png`, `/icon-512.png` son referencias sin archivo todavía).
