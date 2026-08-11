# Seguridad — RLS y los dos clientes de Supabase

App multi-tenant. Cada tabla per-user tiene RLS activado con policies `using` +
`with check` (ver `supabase/migrations/`). Hay dos clientes en
`src/lib/supabase/server.ts`:

- **`crearClienteServidor()`** — respeta RLS, corre con la sesión del usuario
  logueado. **Usar este por default.** Si te olvidás un `.eq("usuario_id", ...)`,
  la query devuelve vacío, no datos de otro usuario.
- **`crearClienteServicio()`** — usa `service_role`, **bypassea RLS por
  completo**. Solo permitido en `src/app/api/cron/**` (no hay sesión de usuario
  ahí) y en las rutas ya auditadas y listadas en `scripts/check-rls.sh` /
  `eslint.config.mjs`. Si lo usás en un endpoint con usuario logueado y te
  olvidás el filtro, se filtran datos entre usuarios en silencio.

## Reglas para tablas nuevas

1. `alter table X enable row level security;`
2. Policy con `using` **y** `with check` (el `with check` es el que protege
   INSERT/UPDATE — sin él, alguien puede reasignar `usuario_id` a otro).
3. Escribir el primer endpoint con `crearClienteServidor()`. Si de verdad
   necesita `service_role` (cron sin sesión), agregalo a la allowlist de
   `scripts/check-rls.sh` y al override de `eslint.config.mjs` con el motivo.

## Guardrails automáticos

- `npm run build` corre `scripts/check-rls.sh` primero — falla si aparece
  `crearClienteServicio` fuera de `cron/` o de la allowlist.
- GitHub Action `check-rls.yml` corre lo mismo en cada push/PR.
- ESLint (`no-restricted-imports`) marca en el editor el import de
  `crearClienteServicio` fuera de los archivos permitidos.

## Crons

`src/app/api/cron/**` están protegidos con header `Authorization: Bearer
$CRON_SECRET`. Dentro de un cron, todo filtro por usuario sigue siendo manual
(no hay RLS evaluándose) — cada query per-user necesita su `.eq("usuario_id", ...)`
explícito.
