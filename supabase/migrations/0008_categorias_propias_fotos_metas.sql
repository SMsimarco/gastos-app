-- Categorías propias: nullable usuario_id = global (compartida por todos),
-- con usuario_id = categoría personal de ese usuario.
alter table categorias add column usuario_id uuid references auth.users(id);

drop policy "lectura publica categorias" on categorias;

create policy "leer categorias globales y propias" on categorias
  for select using (usuario_id is null or usuario_id = auth.uid());

create policy "crear categorias propias" on categorias
  for insert with check (usuario_id = auth.uid());

create policy "editar categorias propias" on categorias
  for update using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

create policy "borrar categorias propias" on categorias
  for delete using (usuario_id = auth.uid());

-- Foto del ticket: solo el path en Storage, no el binario en la tabla.
alter table movimientos add column foto_path text;

-- Bucket privado para las fotos de tickets, un folder por usuario_id.
insert into storage.buckets (id, name, public)
values ('tickets', 'tickets', false)
on conflict (id) do nothing;

create policy "leer mis tickets" on storage.objects
  for select using (bucket_id = 'tickets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "subir mis tickets" on storage.objects
  for insert with check (bucket_id = 'tickets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "borrar mis tickets" on storage.objects
  for delete using (bucket_id = 'tickets' and (storage.foldername(name))[1] = auth.uid()::text);

-- Metas de ahorro.
create table metas_ahorro (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  nombre text not null,
  monto_objetivo numeric not null check (monto_objetivo > 0),
  monto_actual numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table metas_ahorro enable row level security;

create policy "solo mis metas" on metas_ahorro
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);
