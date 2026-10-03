-- Fase 6, parte A: laboratorio (SIMULADO). Recoleccion de datos de mercado.
-- Aislado del plan real: ninguna tabla lab_ referencia bolsillos, repartos, activos,
-- operaciones ni movimientos. Los datos de mercado son globales (sin usuario_id):
-- los usuarios solo leen y escribe unicamente service_role (los endpoints /api/lab/*,
-- que validan LAB_CRON_SECRET). Sin policies de escritura => nadie mas puede escribir.

create table lab_precios (
  ticker text not null,
  ts timestamptz not null,
  precio numeric not null check (precio > 0),
  volumen numeric,
  tipo text not null check (tipo in ('intradia', 'cierre')),
  primary key (ticker, ts, tipo)
);
create index idx_lab_precios_ultimo on lab_precios (tipo, ticker, ts desc);
alter table lab_precios enable row level security;
create policy "lectura lab_precios" on lab_precios for select to authenticated using (true);

create table lab_indicadores (
  ticker text not null,
  fecha date not null,
  datos jsonb not null,
  primary key (ticker, fecha)
);
alter table lab_indicadores enable row level security;
create policy "lectura lab_indicadores" on lab_indicadores for select to authenticated using (true);

create table lab_noticias (
  id uuid primary key default gen_random_uuid(),
  fuente text not null,
  ticker text,                       -- null = global
  tickers text[] not null default '{}', -- tickers afectados segun el resumen
  tema text,
  titular text not null,
  url text not null unique,
  publicado_at timestamptz not null,
  resumen text,
  sentimiento numeric check (sentimiento is null or sentimiento between -1 and 1),
  relevancia numeric check (relevancia is null or relevancia between 0 and 1),
  procesada boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_lab_noticias_publicado on lab_noticias (publicado_at desc);
create index idx_lab_noticias_pendientes on lab_noticias (publicado_at desc) where procesada = false;
alter table lab_noticias enable row level security;
create policy "lectura lab_noticias" on lab_noticias for select to authenticated using (true);

create table lab_macro (
  serie text not null,
  fecha date not null,
  valor numeric not null,
  primary key (serie, fecha)
);
alter table lab_macro enable row level security;
create policy "lectura lab_macro" on lab_macro for select to authenticated using (true);

create table lab_eventos_calendario (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('balance', 'fed')),
  ticker text,
  fecha date not null,
  detalle jsonb not null default '{}'::jsonb
);
create unique index uq_lab_eventos_calendario on lab_eventos_calendario (tipo, coalesce(ticker, ''), fecha);
create index idx_lab_eventos_calendario_fecha on lab_eventos_calendario (fecha);
alter table lab_eventos_calendario enable row level security;
create policy "lectura lab_eventos_calendario" on lab_eventos_calendario for select to authenticated using (true);

create table lab_eventos_mercado (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  clave text not null unique,        -- evita repetir el mismo evento (tipo+ticker+dia)
  tipo text not null,
  ticker text,
  detalle jsonb not null default '{}'::jsonb,
  disparo_decision boolean not null default false
);
create index idx_lab_eventos_mercado_ts on lab_eventos_mercado (ts desc);
alter table lab_eventos_mercado enable row level security;
create policy "lectura lab_eventos_mercado" on lab_eventos_mercado for select to authenticated using (true);

-- Costo de las llamadas a IA del laboratorio (resumenes de noticias hoy; bots en la parte B).
create table lab_costos_ia (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  tipo text not null,
  modelo text not null,
  tokens_entrada integer not null default 0,
  tokens_salida integer not null default 0,
  costo_usd numeric(12, 6) not null default 0,
  detalle jsonb not null default '{}'::jsonb
);
create index idx_lab_costos_ia_ts on lab_costos_ia (ts desc);
alter table lab_costos_ia enable row level security;
create policy "lectura lab_costos_ia" on lab_costos_ia for select to authenticated using (true);

-- Registro de cada corrida de recoleccion: si una fuente falla se guarda el error
-- (no se reintenta en loop) y el panel/briefing pueden avisar que falto ese dato.
create table lab_ejecuciones (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  tarea text not null check (tarea in ('monitor', 'noticias', 'macro')),
  ok boolean not null,
  detalle jsonb not null default '{}'::jsonb,
  error text
);
create index idx_lab_ejecuciones_ts on lab_ejecuciones (tarea, ts desc);
alter table lab_ejecuciones enable row level security;
create policy "lectura lab_ejecuciones" on lab_ejecuciones for select to authenticated using (true);

-- Configuracion por usuario. Las columnas de riesgo y decision las usan los bots (parte B).
create table lab_config (
  usuario_id uuid primary key references auth.users(id),
  activo boolean not null default false,
  fecha_inicio date,
  capital_inicial_usd numeric not null default 1000 check (capital_inicial_usd > 0),
  universo text[] not null default array[
    'VOO', 'QQQ', 'VTI', 'SCHD', 'AAPL', 'MSFT', 'NVDA', 'GOOGL',
    'AMZN', 'META', 'JPM', 'XOM', 'KO', 'YPF', 'VIST'
  ],
  max_pct_por_posicion numeric not null default 20 check (max_pct_por_posicion > 0 and max_pct_por_posicion <= 100),
  min_pct_efectivo numeric not null default 10 check (min_pct_efectivo >= 0 and min_pct_efectivo < 100),
  max_operaciones_por_dia integer not null default 3 check (max_operaciones_por_dia >= 0),
  drawdown_pausa_pct numeric not null default 25 check (drawdown_pausa_pct > 0 and drawdown_pausa_pct <= 100),
  max_costo_ia_mensual_usd numeric not null default 10 check (max_costo_ia_mensual_usd >= 0),
  max_decisiones_evento_por_dia integer not null default 2 check (max_decisiones_evento_por_dia >= 0),
  cooldown_evento_min integer not null default 60 check (cooldown_evento_min >= 0),
  modelo_resumen text not null default 'gemini-3.5-flash-lite',
  modelo_decision text not null default 'gemini-3.6-flash',
  created_at timestamptz not null default now(),
  check (cardinality(universo) > 0)
);
alter table lab_config enable row level security;
create policy "solo mi lab_config" on lab_config
  for all to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

-- Crea la configuracion para los usuarios que ya existen (los nuevos la crea la app al abrir la pestana).
insert into lab_config (usuario_id) select id from auth.users on conflict do nothing;
