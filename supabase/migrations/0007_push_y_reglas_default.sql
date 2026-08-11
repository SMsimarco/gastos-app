-- Suscripciones de Web Push (reemplaza notificaciones por Telegram).
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index idx_push_subscriptions_usuario on push_subscriptions (usuario_id);

alter table push_subscriptions enable row level security;

create policy "solo mis suscripciones push" on push_subscriptions
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

-- Reglas de comercio por defecto para cada usuario nuevo (comercios comunes de Argentina).
create or replace function crear_reglas_comercio_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cat_delivery uuid;
  cat_super uuid;
  cat_servicios uuid;
  cat_suscripciones uuid;
  cat_transporte uuid;
begin
  select id into cat_delivery from categorias where nombre = 'Delivery/Restaurantes' and tipo = 'gasto';
  select id into cat_super from categorias where nombre = 'Supermercado' and tipo = 'gasto';
  select id into cat_servicios from categorias where nombre = 'Servicios' and tipo = 'gasto';
  select id into cat_suscripciones from categorias where nombre = 'Suscripciones' and tipo = 'gasto';
  select id into cat_transporte from categorias where nombre = 'Transporte/Nafta' and tipo = 'gasto';

  insert into reglas_comercio (usuario_id, patron, categoria_id) values
    (new.id, 'rappi', cat_delivery),
    (new.id, 'pedidosya', cat_delivery),
    (new.id, 'uber eats', cat_delivery),
    (new.id, 'coto', cat_super),
    (new.id, 'carrefour', cat_super),
    (new.id, 'dia', cat_super),
    (new.id, 'jumbo', cat_super),
    (new.id, 'disco', cat_super),
    (new.id, 'edesur', cat_servicios),
    (new.id, 'edenor', cat_servicios),
    (new.id, 'metrogas', cat_servicios),
    (new.id, 'aysa', cat_servicios),
    (new.id, 'netflix', cat_suscripciones),
    (new.id, 'spotify', cat_suscripciones),
    (new.id, 'disney', cat_suscripciones),
    (new.id, 'ypf', cat_transporte),
    (new.id, 'shell', cat_transporte),
    (new.id, 'axion', cat_transporte),
    (new.id, 'uber', cat_transporte);

  return new;
end;
$$;

create trigger on_auth_user_created_reglas
  after insert on auth.users
  for each row execute function crear_reglas_comercio_default();
