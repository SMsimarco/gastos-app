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
- **Presupuestos con alertas** — configurás un tope mensual por categoría y te avisa apenas lo cruzás.
- **Confianza baja = no inventa** — si no puede determinar el monto con seguridad, pide aclaración en vez de adivinar.
- **Dashboards** — vistas de Hoy, Semana, Mes y Año con KPIs, gasto acumulado vs. período anterior, distribución por categoría, top comercios y un heatmap de actividad anual estilo GitHub.
- **Tabla completa** — todos los movimientos, filtrables por fecha/categoría/método de pago/comercio/monto, con edición inline, borrado y exportación a CSV.
- **Recurrentes y dólar automáticos** — un cron diario carga los gastos fijos (alquiler, servicios) y actualiza la cotización del dólar sin intervención manual.
- **Multi-usuario** — cada cuenta ve únicamente sus propios datos (aislamiento a nivel de base de datos, no solo de interfaz).
- **PWA instalable con notificaciones push** — funciona como app nativa en el celular, con cola offline (si capturás sin señal, se sube sola cuando vuelve la conexión) y avisos nativos del navegador sin depender de apps de terceros.

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
        └──────────────────────────┴──► Dashboards (Hoy / Semana / Mes / Año / Todos / Presupuestos)
                                    │
                                    ▼
                         Web Push (confirmación, presupuesto excedido, recurrentes)

Vercel Cron (diario) ──► /api/cron/tipo-cambio, /api/cron/recurrentes
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

### 4. Cron (recurrentes + tipo de cambio)

`CRON_SECRET` — cualquier string random largo (`openssl rand -hex 24`). Vercel lo manda automáticamente como header `Authorization: Bearer <valor>` en cada invocación programada (ver `vercel.json`); las rutas lo validan y rechazan cualquier otro llamado.

### 5. Variables de entorno

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
```

### 6. Correr local

```bash
npm install
npm run dev
```

### 7. Deploy en Vercel

```bash
vercel link
vercel env add   # cargar cada variable de arriba
vercel --prod
```

---

## Decisiones de diseño

- **Sin orquestador externo.** El proyecto arrancó sobre n8n + Telegram como capa de captura (ver `n8n/` y el historial de commits); se migró todo a código de aplicación por la fricción de mantener workflows visuales a mano, y las notificaciones pasaron de Telegram a Web Push nativo para no depender de una cuenta de terceros por usuario. `n8n/` queda como referencia histórica, no se sigue desarrollando.
- **Reglas de comercio antes que IA.** Si un comercio ya tiene una regla propia (`reglas_comercio`), esa categoría gana sobre lo que sugiere el modelo — determinismo por sobre inferencia cuando el usuario ya dio la respuesta correcta una vez.
- **service_role nunca en el cliente.** Cada API route valida la sesión con la anon key primero; recién después usa la service role (que bypassea RLS) para escribir.
- **Presupuesto se avisa una sola vez por cruce.** El chequeo compara el total antes/después de cada movimiento — solo notifica en la transacción que efectivamente cruza el umbral, no en cada gasto posterior.
- **Tema oscuro fijo, mobile-first.** Sin gradientes ni sombras decorativas — números grandes, tipografía clara.

## Roadmap

- [ ] Login con Google
- [ ] Vinculación de Telegram/WhatsApp por usuario como canal alternativo a Web Push
- [ ] Background Sync API para la cola offline (hoy reintenta con el evento `online`, no con sync real en segundo plano)
