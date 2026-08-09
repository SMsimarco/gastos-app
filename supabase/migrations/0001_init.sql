-- Schema inicial: gastos-voz
-- Un solo usuario. RLS activado en todas las tablas: la PWA usa anon key + Auth,
-- n8n usa service_role desde el server (bypassea RLS).

create extension if not exists "pgcrypto";

-- ============================================================
-- CATEGORIAS
-- ============================================================
create table categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  emoji text not null,
  color text not null,
  tipo text not null check (tipo in ('gasto', 'ingreso')),
  orden int not null default 0,
  unique (nombre, tipo)
);

-- ============================================================
-- TARJETAS
-- ============================================================
create table tarjetas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  dia_cierre int not null check (dia_cierre between 1 and 31),
  dia_vencimiento int not null check (dia_vencimiento between 1 and 31)
);

-- ============================================================
-- MOVIMIENTOS (gastos e ingresos en la misma tabla)
-- ============================================================
create table movimientos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('gasto', 'ingreso')),
  fecha date not null,
  monto_ars numeric not null check (monto_ars > 0),
  monto_usd numeric,
  tc_usado numeric,
  moneda_origen text not null default 'ARS' check (moneda_origen in ('ARS', 'USD')),
  categoria_id uuid references categorias(id),
  comercio text,
  descripcion text,
  metodo_pago text check (metodo_pago in ('efectivo', 'debito', 'credito', 'transferencia', 'mercadopago')),
  tarjeta_id uuid references tarjetas(id),
  -- cuotas
  cuotas_total int not null default 1 check (cuotas_total >= 1),
  cuota_nro int not null default 1,
  movimiento_padre_id uuid references movimientos(id),
  -- trazabilidad
  fuente text not null check (fuente in ('audio', 'texto', 'foto', 'recurrente', 'manual')),
  transcripcion_raw text,
  confianza text check (confianza in ('alta', 'media', 'baja')),
  created_at timestamptz not null default now()
);

create index idx_movimientos_fecha on movimientos (fecha);
create index idx_movimientos_categoria on movimientos (categoria_id);
create index idx_movimientos_padre on movimientos (movimiento_padre_id);

-- ============================================================
-- PRESUPUESTOS
-- ============================================================
create table presupuestos (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid not null references categorias(id),
  monto_mensual numeric not null check (monto_mensual > 0),
  mes date not null, -- primer día del mes, ej. 2026-08-01
  unique (categoria_id, mes)
);

-- ============================================================
-- RECURRENTES
-- ============================================================
create table recurrentes (
  id uuid primary key default gen_random_uuid(),
  descripcion text not null,
  monto numeric not null check (monto > 0),
  categoria_id uuid not null references categorias(id),
  dia_del_mes int not null check (dia_del_mes between 1 and 31),
  activo boolean not null default true,
  metodo_pago text check (metodo_pago in ('efectivo', 'debito', 'credito', 'transferencia', 'mercadopago')),
  ultima_ejecucion date
);

-- ============================================================
-- REGLAS DE COMERCIO (auto-categorización)
-- ============================================================
create table reglas_comercio (
  id uuid primary key default gen_random_uuid(),
  patron text not null, -- ej. "Coto", case-insensitive match contra comercio
  categoria_id uuid not null references categorias(id)
);

-- ============================================================
-- TIPO DE CAMBIO
-- ============================================================
create table tipo_cambio (
  fecha date primary key,
  blue_venta numeric not null,
  oficial_venta numeric not null
);

-- ============================================================
-- RLS
-- ============================================================
alter table movimientos enable row level security;
alter table categorias enable row level security;
alter table presupuestos enable row level security;
alter table recurrentes enable row level security;
alter table reglas_comercio enable row level security;
alter table tipo_cambio enable row level security;
alter table tarjetas enable row level security;

-- Un solo usuario autenticado (vos) puede leer/escribir todo.
-- n8n usa service_role y bypassea RLS directamente, no necesita policy.
create policy "usuario autenticado full access" on movimientos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "usuario autenticado full access" on categorias
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "usuario autenticado full access" on presupuestos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "usuario autenticado full access" on recurrentes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "usuario autenticado full access" on reglas_comercio
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "usuario autenticado full access" on tipo_cambio
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "usuario autenticado full access" on tarjetas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
