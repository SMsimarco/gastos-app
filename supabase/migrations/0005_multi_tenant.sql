-- Multi-tenant: cada usuario ve y carga solo sus propios datos.
-- categorias y tipo_cambio quedan globales/compartidas (mismo catalogo para todos).

-- El default usa tu user id para las filas ya existentes (auth.uid() no sirve
-- corriendo esto a mano en el SQL Editor, ahi no hay usuario logueado en el
-- contexto de la sesion). Los inserts nuevos de la app mandan usuario_id explicito.
alter table movimientos add column usuario_id uuid not null default '86704f0b-62fb-425a-b2b6-4a7ff8d25526' references auth.users(id);
alter table presupuestos add column usuario_id uuid not null default '86704f0b-62fb-425a-b2b6-4a7ff8d25526' references auth.users(id);
alter table recurrentes add column usuario_id uuid not null default '86704f0b-62fb-425a-b2b6-4a7ff8d25526' references auth.users(id);
alter table reglas_comercio add column usuario_id uuid not null default '86704f0b-62fb-425a-b2b6-4a7ff8d25526' references auth.users(id);
alter table tarjetas add column usuario_id uuid not null default '86704f0b-62fb-425a-b2b6-4a7ff8d25526' references auth.users(id);

alter table movimientos alter column usuario_id drop default;
alter table presupuestos alter column usuario_id drop default;
alter table recurrentes alter column usuario_id drop default;
alter table reglas_comercio alter column usuario_id drop default;
alter table tarjetas alter column usuario_id drop default;

create index idx_movimientos_usuario on movimientos (usuario_id);
create index idx_presupuestos_usuario on presupuestos (usuario_id);
create index idx_recurrentes_usuario on recurrentes (usuario_id);
create index idx_reglas_comercio_usuario on reglas_comercio (usuario_id);
create index idx_tarjetas_usuario on tarjetas (usuario_id);

-- Reemplazar policies viejas (auth.role()='authenticated' = cualquiera ve todo) por aislamiento real.
drop policy "usuario autenticado full access" on movimientos;
drop policy "usuario autenticado full access" on presupuestos;
drop policy "usuario autenticado full access" on recurrentes;
drop policy "usuario autenticado full access" on reglas_comercio;
drop policy "usuario autenticado full access" on tarjetas;

create policy "solo mis movimientos" on movimientos
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);
create policy "solo mis presupuestos" on presupuestos
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);
create policy "solo mis recurrentes" on recurrentes
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);
create policy "solo mis reglas_comercio" on reglas_comercio
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);
create policy "solo mis tarjetas" on tarjetas
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

-- categorias y tipo_cambio: cualquier usuario autenticado puede leer, nadie escribe desde el cliente
-- (categorias se siembra por migracion, tipo_cambio lo escribe el cron con service_role).
drop policy "usuario autenticado full access" on categorias;
drop policy "usuario autenticado full access" on tipo_cambio;

create policy "lectura publica categorias" on categorias
  for select using (auth.role() = 'authenticated');
create policy "lectura publica tipo_cambio" on tipo_cambio
  for select using (auth.role() = 'authenticated');
