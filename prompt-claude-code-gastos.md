# PROMPT PARA CLAUDE CODE — Sistema personal de gastos por voz

Copiá todo lo que sigue y pegáselo a Claude Code al iniciar el proyecto.

---

## Contexto

Quiero un sistema personal de registro de gastos e ingresos, de un solo usuario (yo), sin comisiones ni suscripciones de terceros. La captura principal es **por audio de Telegram**, con texto y foto de ticket como métodos secundarios. La visualización es una **PWA** con gráficos.

No es un SaaS. Es una herramienta personal. No agregues onboarding, landing, planes de pago, multi-tenancy ni analytics de producto. Si dudás entre "simple que funciona" y "genérico y extensible", elegí simple.

## Stack (ya lo tengo corriendo, no propongas alternativas)

- **n8n self-hosted** en VPS Contabo (Ubuntu 24.04, Docker Compose, Caddy como reverse proxy) — toda la ingesta.
- **Supabase** — Postgres + Auth + Storage.
- **Gemini Flash** (API de Google AI Studio) — parseo de audio, texto e imagen.
- **PWA**: React + Vite + Recharts + Tailwind, deploy en Vercel.
- Español rioplatense en toda la UI, mensajes del bot y comentarios de código.

## Antes de escribir código: verificá la API de Gemini

Mi información sobre los modelos de Gemini puede estar desactualizada. **Antes de escribir el nodo de n8n, buscá la documentación vigente** en `ai.google.dev/gemini-api/docs/audio` y confirmá:

1. El nombre exacto del modelo Flash actual.
2. El endpoint correcto (`/v1beta/models/...:generateContent` vs. la API `/interactions` más nueva) y si hace falta un header de versión de API.
3. La sintaxis exacta para mandar audio inline en base64 con su `mime_type`.
4. Si soporta **structured output / response_format** con JSON Schema. Si lo soporta, **usalo** en vez de pedir JSON por prompt — es mucho más confiable.
5. Los límites del free tier vigentes.

Anotá lo que encontraste en un `NOTES.md` antes de seguir.

---

## Arquitectura

```
Telegram (audio / texto / foto)
        ↓ webhook
n8n (VPS Contabo)
        ↓
Gemini Flash → JSON estructurado
        ↓
Supabase (Postgres)
        ↓
PWA React (Vercel) — dashboard y gráficos
```

Telegram también es la **interfaz de salida**: confirmaciones, correcciones, consultas en lenguaje natural y resúmenes automáticos.

---

## FASE 1 — Ingesta por n8n (empezá acá)

### WF01 — Captura

Trigger: Telegram, filtrando por mi `chat_id` únicamente. Cualquier otro `chat_id` se ignora en silencio.

Ramas según tipo de mensaje:

**Audio (`voice`)** — el camino principal.
- Telegram entrega voice notes en **OGG/Opus** (`.oga`). Gemini acepta `audio/ogg` de forma nativa.
- Bajá el archivo con `getFile` + `file_path`, convertilo a base64, mandalo inline a Gemini junto al prompt de extracción.
- **Fallback:** si Gemini rechaza el OGG de Telegram, agregá un paso de conversión a MP3 con ffmpeg vía Execute Command. Probalo con un audio real antes de dar por buena la rama.

**Texto** — mismo prompt de extracción, sin audio.

**Foto (`photo`)** — tomá la resolución más alta del array, mandala a Gemini con vision.

### Prompt de extracción (compartido por las tres ramas)

Un solo call devuelve un **array** de movimientos. Un audio puede contener varios ("cargué 20 lucas de nafta y me tomé un café de 3500").

Campos por movimiento:

- `tipo`: `gasto` | `ingreso`
- `monto`: número
- `moneda`: `ARS` | `USD`
- `descripcion`: texto corto
- `comercio`: nombre si se menciona, si no `null`
- `categoria`: una de la lista fija de categorías (pasásela en el prompt)
- `metodo_pago`: `efectivo` | `debito` | `credito` | `transferencia` | `mercadopago` | `null`
- `cuotas`: entero, default 1
- `fecha`: ISO. Resolvé referencias relativas ("ayer", "el viernes pasado") contra la fecha actual, que le pasás en el prompt. **Timezone `America/Argentina/Buenos_Aires`** — no uses UTC, te va a correr los gastos nocturnos al día siguiente.
- `confianza`: `alta` | `media` | `baja`

Reglas para el prompt:
- Lenguaje coloquial argentino: "20 lucas" = 20000, "2 palos" = 2000000, "500 mangos" = 500, "un verde" = 1 USD.
- Si no puede determinar el monto → `confianza: baja`, no inventes un número.
- Devolvé `[]` si el mensaje no contiene ningún movimiento (ej. le mando un audio de otra cosa).
- Guardá siempre la transcripción cruda en `transcripcion_raw`. Cuando algo salga mal vas a necesitar ver qué entendió.

### Confirmación en Telegram

Después de insertar, respondé con un resumen y botones inline:

```
✅ Registrado
🍔 Delivery · $8.500 · hoy · débito
```
Botones: `✏️ Editar monto` · `🏷 Cambiar categoría` · `🗑 Borrar`

Si `confianza: baja`, **no insertes todavía**: mostrá lo que entendió y pedí confirmación explícita.

Manejá los callbacks de los botones en el mismo workflow o en un WF02 dedicado.

### WF03 — Consulta en lenguaje natural

Si el mensaje de texto es una **pregunta** en vez de un gasto ("¿cuánto gasté en comida este mes?", "¿en qué se me fue la plata en julio?"):

- Detectá la intención en el mismo call de extracción (agregá un campo `intencion`: `registro` | `consulta`).
- Para consultas: traducí a filtros estructurados (rango de fechas + categoría + tipo), **no a SQL crudo**. Nada de un LLM escribiendo SQL contra mi base.
- Consultá Supabase con esos filtros y que Gemini redacte la respuesta en dos líneas.

### WF04 — Recurrentes

Cron diario que revisa la tabla `recurrentes` e inserta automáticamente los gastos fijos que vencen ese día (alquiler, internet, suscripciones), notificando por Telegram.

### WF05 — Tipo de cambio

Cron diario que guarda el dólar blue y oficial en la tabla `tipo_cambio`. Usá una API pública argentina (ej. dolarapi.com). Si falla, reusá el último valor disponible y logueá el fallo — nunca dejes un gasto sin `monto_usd`.

### WF06 — Digest

- **Lunes 9hs:** resumen de la semana por Telegram — total, top 3 categorías, comparación con la semana anterior.
- **Día 1 de cada mes:** cierre del mes anterior — total ARS y USD, por categoría, presupuestos excedidos, comparación con el mes previo.

---

## Schema de Supabase

```sql
-- Movimientos (gastos e ingresos en la misma tabla)
movimientos (
  id uuid pk,
  tipo text check (tipo in ('gasto','ingreso')),
  fecha date not null,
  monto_ars numeric not null,
  monto_usd numeric,            -- calculado al TC del día
  tc_usado numeric,
  moneda_origen text default 'ARS',
  categoria_id uuid fk,
  comercio text,
  descripcion text,
  metodo_pago text,
  -- cuotas
  cuotas_total int default 1,
  cuota_nro int default 1,
  movimiento_padre_id uuid fk self,  -- null si no es cuota
  -- trazabilidad
  fuente text,                  -- 'audio' | 'texto' | 'foto' | 'recurrente' | 'manual'
  transcripcion_raw text,
  confianza text,
  created_at timestamptz default now()
)

categorias (id, nombre, emoji, color, tipo, orden)
presupuestos (id, categoria_id, monto_mensual, mes)
recurrentes (id, descripcion, monto, categoria_id, dia_del_mes, activo, metodo_pago)
reglas_comercio (id, patron, categoria_id)   -- "Coto" → Supermercado
tipo_cambio (fecha pk, blue_venta, oficial_venta)
tarjetas (id, nombre, dia_cierre, dia_vencimiento)
```

**Cuotas — implementación:** si `cuotas > 1`, insertá el movimiento padre y **N-1 hijos** con fecha desplazada mes a mes y `monto_ars` dividido. Los reportes por defecto suman por fecha de imputación (cuándo impacta el bolsillo), no por fecha de compra. Agregá un toggle en la PWA para ver ambas vistas.

**RLS activado** en todas las tablas. La PWA usa `anon key` + Auth de Supabase; n8n usa `service_role` desde el server.

Creá vistas materializadas o funciones RPC para las agregaciones pesadas — no traigas 5000 filas al browser para sumarlas en JS.

Semillas: categorías con emoji y color (Supermercado, Delivery/Restaurantes, Transporte/Nafta, Servicios, Alquiler, Salud, Ocio, Ropa, Educación, Suscripciones, Impuestos, Otros; y para ingresos: Clientes, Sueldo, Ventas, Otros).

---

## FASE 2 — PWA (dashboard)

Solo después de que la Fase 1 esté cargando datos reales.

### Vistas

**Hoy** — total del día, lista de movimientos, comparación con el promedio diario del mes.

**Semana** — barras por día, total, comparación con semana anterior.

**Mes** (vista principal)
- KPIs arriba: gastado, ingresado, balance, promedio diario, **proyección a fin de mes**.
- Línea de gasto acumulado del mes vs. el mes anterior superpuesto. Este gráfico es el más útil de todos: te dice en tiempo real si vas mejor o peor.
- Donut por categoría, clickeable para drill-down.
- Barras horizontales: top 10 comercios.
- Barra de progreso por presupuesto, en rojo si se pasó.

**Año**
- Barras por mes, con toggle **ARS / USD**. En ARS todo sube por inflación; en USD ves la tendencia real.
- Área apilada por categoría a lo largo del año.
- Heatmap calendario estilo GitHub: un cuadrado por día, intensidad según gasto.
- Ingresos vs. gastos por mes, con línea de balance acumulado.

**Todos** — tabla filtrable y buscable, con filtros por rango de fecha, categoría, método de pago, comercio y monto. Edición inline. Export CSV.

### Transversal

- Rango de fechas custom en cualquier vista.
- Alta manual de movimientos (para cuando no tenés el celular a mano).
- Gestión de categorías, presupuestos y recurrentes.
- PWA instalable: manifest, service worker, ícono. Que abra rápido y ande con conexión mala.
- Mobile-first. Lo voy a mirar en el celular el 95% del tiempo.
- Diseño oscuro, sobrio, tipografía clara, números grandes. Nada de gradientes ni de tarjetas con sombras exageradas.

---

## Orden de trabajo

1. Schema de Supabase + seeds + RLS.
2. WF01 solo con la rama de **audio**. Probalo mandando audios reales hasta que el parseo sea confiable.
3. Confirmación con botones inline y correcciones.
4. Ramas de texto y foto.
5. WF05 (tipo de cambio) y WF04 (recurrentes).
6. Cuotas.
7. PWA: primero la vista Mes completa, después el resto.
8. WF03 (consultas) y WF06 (digest).

**No avances al paso siguiente sin probar el anterior con datos reales.**

## Entregables

- `README.md` con setup completo: variables de entorno, cómo crear el bot en BotFather, cómo importar los workflows, cómo correr las migraciones.
- Workflows de n8n exportados como JSON en `/n8n`.
- Migraciones SQL en `/supabase/migrations`.
- `NOTES.md` con lo que verificaste de la API de Gemini.
- Sin secretos hardcodeados. Todo por env vars.

## Preferencias de trabajo

- Cambios quirúrgicos, no rewrites.
- Preguntame antes de agregar una dependencia pesada.
- Si algo de esta spec te parece mal pensado, decímelo antes de implementarlo.
