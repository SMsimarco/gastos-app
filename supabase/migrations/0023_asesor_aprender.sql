-- Fase 7: asesor del bolsillo "aprender".
-- No toca ninguna tabla lab_*: lee de ellas desde el código. Todo lo nuevo es del plan real (con RLS por usuario),
-- salvo aprender_pe_promedio, que guarda un dato de mercado global (promedio de P/E de 5 años) y solo lo escribe
-- el job diario con service_role.

-- 1. Pesos del puntaje (suman 100) y flag para usar las decisiones de los bots (apagado hasta que el usuario lo active).
alter table config_plan
  add column if not exists peso_valuacion int not null default 30,
  add column if not exists peso_momento int not null default 25,
  add column if not exists peso_calidad int not null default 25,
  add column if not exists peso_noticias int not null default 20,
  add column if not exists usar_historial_bots boolean not null default false;

alter table config_plan
  add constraint config_plan_pesos_aprender_check
  check (
    peso_valuacion between 0 and 100
    and peso_momento between 0 and 100
    and peso_calidad between 0 and 100
    and peso_noticias between 0 and 100
    and peso_valuacion + peso_momento + peso_calidad + peso_noticias = 100
  );

-- 2. Historial de sugerencias: qué candidatos se evaluaron, con su puntaje y componentes, y si se compró.
create table aprender_sugerencias (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  fecha date not null,
  saldo_usd numeric not null,
  -- true: evaluación semanal "en silencio" cuando el saldo no llegaba al mínimo (solo para medir; no se le avisa al usuario).
  de_sombra boolean not null default false,
  -- [{ ticker, puntaje, precio, componentes: [{ criterio, aporte, ... }] }]
  candidatos jsonb not null,
  voo_precio numeric,
  -- tickers que el usuario terminó comprando (lo completa el job diario mirando operaciones).
  compro_tickers text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (usuario_id, fecha, de_sombra)
);
create index idx_aprender_sugerencias_usuario on aprender_sugerencias (usuario_id, fecha desc);
alter table aprender_sugerencias enable row level security;
create policy "leer mis sugerencias de aprender" on aprender_sugerencias
  for select to authenticated using (auth.uid() = usuario_id);

-- 3. Medición a 1, 4 y 12 semanas contra VOO, la haya comprado o no.
create table aprender_resultados (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  sugerencia_id uuid not null references aprender_sugerencias(id) on delete cascade,
  ticker text not null,
  semanas int not null check (semanas in (1, 4, 12)),
  fecha_medicion date not null,
  precio_inicial numeric not null,
  precio_final numeric not null,
  rendimiento_pct numeric not null,
  voo_pct numeric not null,
  gano_a_voo boolean not null,
  -- aportes de cada criterio cuando se sugirió: { valuacion: 12.5, momento: -3, ... }
  aportes jsonb not null,
  created_at timestamptz not null default now(),
  unique (sugerencia_id, ticker, semanas)
);
create index idx_aprender_resultados_usuario on aprender_resultados (usuario_id, fecha_medicion desc);
alter table aprender_resultados enable row level security;
create policy "leer mis resultados de aprender" on aprender_resultados
  for select to authenticated using (auth.uid() = usuario_id);

-- 4. Propuesta mensual de cambio de pesos: nunca se aplica sola, el usuario la acepta o la rechaza.
create table aprender_propuestas_pesos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  mes text not null check (mes ~ '^[0-9]{4}-[0-9]{2}$'),
  pesos_actuales jsonb not null,
  pesos_propuestos jsonb not null,
  evidencia jsonb not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'rechazada')),
  created_at timestamptz not null default now(),
  resuelta_at timestamptz,
  unique (usuario_id, mes)
);
alter table aprender_propuestas_pesos enable row level security;
create policy "leer mis propuestas de pesos" on aprender_propuestas_pesos
  for select to authenticated using (auth.uid() = usuario_id);
create policy "resolver mis propuestas de pesos" on aprender_propuestas_pesos
  for update to authenticated using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

-- 5. Promedio de P/E de 5 años por ticker (dato de mercado global). El laboratorio guarda solo el P/E actual; este
-- promedio se calcula con la serie trimestral de Finnhub y lo escribe el job diario, solo para tickers de aprender.
create table aprender_pe_promedio (
  ticker text primary key,
  promedio_5a numeric not null check (promedio_5a > 0),
  muestras int not null,
  fecha date not null,
  fuente text not null default 'Finnhub'
);
alter table aprender_pe_promedio enable row level security;
create policy "leer pe promedio" on aprender_pe_promedio for select to authenticated using (true);
