-- Fase 6, parte A-2: más fuentes para el laboratorio (SIMULADO). Fundamentales, analistas,
-- sorpresas de balances, insiders y hechos materiales de la SEC. Datos globales: lectura para
-- usuarios, escritura solo service_role (endpoints /api/lab/*). Nada referencia el plan real.

create table lab_fundamentales (
  ticker text not null,
  fecha date not null,
  datos jsonb not null,
  primary key (ticker, fecha)
);
alter table lab_fundamentales enable row level security;
create policy "lectura lab_fundamentales" on lab_fundamentales for select to authenticated using (true);

create table lab_analistas (
  ticker text not null,
  periodo date not null,
  strong_buy integer not null default 0,
  buy integer not null default 0,
  hold integer not null default 0,
  sell integer not null default 0,
  strong_sell integer not null default 0,
  primary key (ticker, periodo)
);
alter table lab_analistas enable row level security;
create policy "lectura lab_analistas" on lab_analistas for select to authenticated using (true);

create table lab_sorpresas (
  ticker text not null,
  periodo date not null,
  estimado numeric,
  real numeric,
  sorpresa_pct numeric,
  anio integer,
  trimestre integer,
  primary key (ticker, periodo)
);
alter table lab_sorpresas enable row level security;
create policy "lectura lab_sorpresas" on lab_sorpresas for select to authenticated using (true);

-- Compras (P) y ventas (S) en mercado abierto de directivos; el resto de los códigos
-- (premios, impuestos, regalos) no dicen nada sobre lo que piensan de la acción.
create table lab_insiders (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  nombre text not null,
  fecha_transaccion date not null,
  fecha_presentacion date,
  codigo text not null check (codigo in ('P', 'S')),
  cambio_acciones numeric not null,
  acciones_total numeric,
  precio numeric,
  unique (ticker, nombre, fecha_transaccion, codigo, cambio_acciones)
);
create index idx_lab_insiders_fecha on lab_insiders (fecha_transaccion desc);
alter table lab_insiders enable row level security;
create policy "lectura lab_insiders" on lab_insiders for select to authenticated using (true);

create table lab_filings (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  accesion text not null unique,
  fecha date not null,
  formulario text not null,
  items text[] not null default '{}',
  descripcion text,
  url text not null
);
create index idx_lab_filings_fecha on lab_filings (fecha desc);
alter table lab_filings enable row level security;
create policy "lectura lab_filings" on lab_filings for select to authenticated using (true);

-- Calendario: además de balances y Fed, publicaciones macro (CPI, empleo, PBI) y dividendos.
-- Dos publicaciones pueden caer el mismo día (PBI y PCE), así que el código entra en la clave única.
alter table lab_eventos_calendario drop constraint lab_eventos_calendario_tipo_check;
alter table lab_eventos_calendario
  add constraint lab_eventos_calendario_tipo_check check (tipo in ('balance', 'fed', 'macro', 'dividendo'));
drop index uq_lab_eventos_calendario;
create unique index uq_lab_eventos_calendario
  on lab_eventos_calendario (tipo, coalesce(ticker, ''), fecha, coalesce(detalle->>'codigo', ''));

alter table lab_ejecuciones drop constraint lab_ejecuciones_tarea_check;
alter table lab_ejecuciones
  add constraint lab_ejecuciones_tarea_check check (tarea in ('monitor', 'noticias', 'gdelt', 'macro', 'fundamentales'));
