-- Fase 6, parte A-3: el laboratorio (SIMULADO) aprende todos los días. Tres tablas globales de
-- memoria: un diario de mercado escrito por IA, estadísticas de eventos calculadas por código con
-- historia de varios años, y las señales que se activan cada día. Lectura para usuarios, escritura
-- solo service_role. Nada referencia el plan real.

-- Diario de mercado: una nota por rueda. `hechos` guarda exactamente los datos que vio la IA.
create table lab_diario (
  fecha date primary key,
  resumen text not null,
  puntos_clave jsonb not null default '[]'::jsonb,
  a_mirar jsonb not null default '[]'::jsonb,
  tono text not null check (tono in ('positivo', 'neutral', 'negativo', 'mixto')),
  hechos jsonb not null default '{}'::jsonb,
  modelo text not null,
  tokens_entrada integer not null default 0,
  tokens_salida integer not null default 0,
  costo_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);
alter table lab_diario enable row level security;
create policy "lectura lab_diario" on lab_diario for select to authenticated using (true);

-- Qué hizo el precio 1, 5 y 20 ruedas después de cada tipo de evento. ticker '*' = todo el universo.
-- `media_base` es el retorno medio de cualquier día en el mismo horizonte, para comparar.
create table lab_estadisticas (
  evento text not null,
  ticker text not null,
  horizonte integer not null check (horizonte > 0),
  n integer not null check (n >= 0),
  media numeric,
  mediana numeric,
  pct_positivo numeric,
  media_base numeric,
  desde date,
  hasta date,
  calculado_at timestamptz not null default now(),
  primary key (evento, ticker, horizonte)
);
alter table lab_estadisticas enable row level security;
create policy "lectura lab_estadisticas" on lab_estadisticas for select to authenticated using (true);

-- Eventos que se activaron en la última rueda de cada ticker.
create table lab_senales (
  ticker text not null,
  fecha date not null,
  evento text not null,
  primary key (ticker, fecha, evento)
);
create index idx_lab_senales_fecha on lab_senales (fecha desc);
alter table lab_senales enable row level security;
create policy "lectura lab_senales" on lab_senales for select to authenticated using (true);

alter table lab_ejecuciones drop constraint lab_ejecuciones_tarea_check;
alter table lab_ejecuciones
  add constraint lab_ejecuciones_tarea_check
  check (tarea in ('monitor', 'noticias', 'gdelt', 'macro', 'fundamentales', 'aprendizaje'));
