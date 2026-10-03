-- Telegram: vinculación segura, avisos deduplicados e idempotencia de webhooks.

create table telegram_vinculos (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  chat_id bigint not null unique,
  created_at timestamptz not null default now()
);

create table telegram_codigos_vinculacion (
  codigo text primary key check (codigo ~ '^[0-9]{6}$'),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  expira_at timestamptz not null default (now() + interval '10 minutes'),
  usado boolean not null default false,
  created_at timestamptz not null default now()
);

create index telegram_codigos_usuario_idx on telegram_codigos_vinculacion (usuario_id);

create table alertas_enviadas (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  clave text not null,
  fecha date not null,
  created_at timestamptz not null default now(),
  unique (usuario_id, clave, fecha)
);

create index alertas_enviadas_usuario_idx on alertas_enviadas (usuario_id, fecha desc);

-- Telegram puede reenviar un update si el webhook demora o devuelve un error.
create table telegram_updates (
  update_id bigint primary key,
  usuario_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table telegram_vinculos enable row level security;
alter table telegram_codigos_vinculacion enable row level security;
alter table alertas_enviadas enable row level security;
alter table telegram_updates enable row level security;

create policy "leer mi vinculo telegram" on telegram_vinculos
  for select to authenticated using ((select auth.uid()) = usuario_id);
create policy "borrar mi vinculo telegram" on telegram_vinculos
  for delete to authenticated using ((select auth.uid()) = usuario_id);

create policy "gestionar mis codigos telegram" on telegram_codigos_vinculacion
  for all to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

create policy "leer mis alertas telegram" on alertas_enviadas
  for select to authenticated using ((select auth.uid()) = usuario_id);

grant select, delete on telegram_vinculos to authenticated;
grant select, insert, update, delete on telegram_codigos_vinculacion to authenticated;
grant select on alertas_enviadas to authenticated;

-- El webhook usa service_role. La función bloquea y consume el código en la misma
-- transacción, impidiendo reutilización o asociación a otro usuario.
create or replace function vincular_telegram(p_codigo text, p_chat_id bigint)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario_id uuid;
begin
  if p_chat_id is null or p_codigo !~ '^[0-9]{6}$' then
    raise exception 'Código inválido';
  end if;

  select usuario_id into v_usuario_id
  from telegram_codigos_vinculacion
  where codigo = p_codigo
    and usado = false
    and expira_at > now()
  for update;

  if v_usuario_id is null then
    raise exception 'Código inválido o vencido';
  end if;

  if exists (
    select 1 from telegram_vinculos
    where chat_id = p_chat_id and usuario_id <> v_usuario_id
  ) then
    raise exception 'Este chat ya está vinculado a otra cuenta';
  end if;

  insert into telegram_vinculos (usuario_id, chat_id)
  values (v_usuario_id, p_chat_id)
  on conflict (usuario_id) do update
    set chat_id = excluded.chat_id, created_at = now();

  update telegram_codigos_vinculacion
  set usado = true
  where codigo = p_codigo;

  return v_usuario_id;
end;
$$;

revoke all on function vincular_telegram(text, bigint) from public, anon, authenticated;
grant execute on function vincular_telegram(text, bigint) to service_role;

