-- Fase 6, parte B: bots simulados del laboratorio (SIMULADO, paper trading, plata ficticia).
-- Tres bots por usuario, cada uno en su propia cuenta paper de Alpaca (las keys viven en variables de
-- entorno, nunca en la base: aca solo se guarda cual cuenta usa cada bot). Aislado del plan real:
-- ninguna tabla referencia bolsillos, repartos, activos, operaciones ni movimientos.

-- Los tres bots deciden con el mismo modelo: es el unico que respondio siempre en las pruebas
-- (los 3.6 a 3.8 devuelven 503 seguido) y cambiar de modelo entre bots ensuciaria la comparacion.
alter table lab_config alter column modelo_decision set default 'gemini-3.5-flash';
update lab_config set modelo_decision = 'gemini-3.5-flash' where modelo_decision = 'gemini-3.6-flash';

-- Benchmark VOO: US$1.000 comprados virtualmente cuando corre la primera decision y nunca tocados.
alter table lab_config add column voo_precio_inicio numeric check (voo_precio_inicio is null or voo_precio_inicio > 0);
alter table lab_config add column voo_cantidad numeric check (voo_cantidad is null or voo_cantidad > 0);
alter table lab_config add column inicio_real timestamptz;

create table lab_bots (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  clave text not null check (clave in ('A', 'B', 'C')),
  nombre text not null,
  perfil_info text not null check (perfil_info in ('completo', 'solo_precios')),
  reactivo boolean not null default false,
  alpaca_cuenta text not null check (alpaca_cuenta in ('A', 'B', 'C')),
  estrategia_prompt text not null,
  pausado boolean not null default true,
  motivo_pausa text,
  created_at timestamptz not null default now(),
  unique (usuario_id, clave),
  unique (usuario_id, id)
);
alter table lab_bots enable row level security;
create policy "solo mis lab_bots" on lab_bots
  for all to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

-- Cada vez que un bot corre queda una fila, tambien si decide no hacer nada o si falla.
create table lab_corridas (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null,
  usuario_id uuid not null references auth.users(id),
  ts timestamptz not null default now(),
  disparador text not null check (disparador in ('diaria', 'evento')),
  evento_id uuid,
  briefing jsonb not null default '{}'::jsonb,   -- exactamente lo que vio la IA
  respuesta_ia jsonb,
  modelo text,
  tokens_entrada integer not null default 0,
  tokens_salida integer not null default 0,
  costo_usd numeric(12, 6) not null default 0,
  estado text not null check (estado in ('ok', 'sin_cambios', 'error', 'pausado', 'sin_presupuesto', 'simulada')),
  error text,
  foreign key (usuario_id, bot_id) references lab_bots(usuario_id, id)
);
create index idx_lab_corridas_bot_ts on lab_corridas (bot_id, ts desc);
alter table lab_corridas enable row level security;
create policy "solo mis lab_corridas" on lab_corridas
  for all to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

create table lab_decisiones (
  id uuid primary key default gen_random_uuid(),
  corrida_id uuid not null references lab_corridas(id) on delete cascade,
  bot_id uuid not null,
  usuario_id uuid not null references auth.users(id),
  ticker text not null,
  accion text not null check (accion in ('comprar', 'vender', 'mantener')),
  monto_propuesto_usd numeric not null default 0,
  monto_aprobado_usd numeric not null default 0,
  razon_ia text,
  confianza text check (confianza in ('alta', 'media', 'baja')),
  ajuste_riesgo text,                            -- que recorto o descarto el gestor de riesgo y por que
  orden_alpaca_id text,
  estado_orden text not null default 'sin_orden',
  precio_ejecucion numeric,
  cantidad_ejecutada numeric,
  created_at timestamptz not null default now(),
  foreign key (usuario_id, bot_id) references lab_bots(usuario_id, id)
);
create index idx_lab_decisiones_bot on lab_decisiones (bot_id, created_at desc);
alter table lab_decisiones enable row level security;
create policy "solo mis lab_decisiones" on lab_decisiones
  for all to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

-- Valor de cada bot en el tiempo. bot_id null = benchmark VOO.
create table lab_snapshots (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid,
  usuario_id uuid not null references auth.users(id),
  ts timestamptz not null default now(),
  tipo text not null check (tipo in ('intradia', 'cierre')),
  valor_usd numeric not null,
  efectivo_usd numeric,
  costo_ia_acumulado_usd numeric not null default 0,
  posiciones jsonb not null default '[]'::jsonb,   -- lo que tenia el bot en ese momento
  foreign key (usuario_id, bot_id) references lab_bots(usuario_id, id)
);
create index idx_lab_snapshots_bot_ts on lab_snapshots (bot_id, ts desc);
alter table lab_snapshots enable row level security;
create policy "solo mis lab_snapshots" on lab_snapshots
  for all to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

alter table lab_ejecuciones drop constraint lab_ejecuciones_tarea_check;
alter table lab_ejecuciones
  add constraint lab_ejecuciones_tarea_check
  check (tarea in ('monitor', 'noticias', 'gdelt', 'macro', 'fundamentales', 'aprendizaje', 'decidir', 'cierre'));
