-- Plan de ahorro: bolsillos, reparto de cobros y config. La app no mueve
-- plata real (vive en ARQ): esta tabla solo calcula, registra y avisa.

-- 1. Bolsillos.
create table bolsillos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  clave text not null check (clave in ('gastos', 'emergencia', 'depto', 'aprender')),
  nombre text not null,
  moneda text not null check (moneda in ('ARS', 'USD')),
  saldo numeric not null default 0,
  meta numeric,
  orden int not null default 0,
  unique (usuario_id, clave)
);

create index idx_bolsillos_usuario on bolsillos (usuario_id);

alter table bolsillos enable row level security;

create policy "solo mis bolsillos" on bolsillos
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

-- 2. Movimientos de bolsillo (trazabilidad de aportes/retiros/ajustes).
create table movimientos_bolsillo (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  bolsillo_id uuid not null references bolsillos(id),
  tipo text not null check (tipo in ('aporte', 'retiro', 'ajuste')),
  monto numeric not null, -- en la moneda del bolsillo; negativo en retiros/ajustes a la baja
  tc_usado numeric,
  reparto_id uuid, -- referencia a repartos(id), se agrega el fk mas abajo (se crea despues)
  nota text,
  created_at timestamptz not null default now()
);

create index idx_movimientos_bolsillo_usuario on movimientos_bolsillo (usuario_id);
create index idx_movimientos_bolsillo_bolsillo on movimientos_bolsillo (bolsillo_id);

alter table movimientos_bolsillo enable row level security;

create policy "solo mis movimientos_bolsillo" on movimientos_bolsillo
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

-- 3. Repartos (snapshot de cada cálculo, uno por ingreso).
create table repartos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  -- on delete set null: si se borra el ingreso, el reparto queda como
  -- registro histórico (el snapshot vive en "detalle") en vez de romper por FK.
  ingreso_id uuid references movimientos(id) on delete set null,
  monto_ars numeric not null,
  tc_referencia numeric not null,
  detalle jsonb not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aplicado', 'descartado')),
  created_at timestamptz not null default now(),
  aplicado_at timestamptz
);

create index idx_repartos_usuario on repartos (usuario_id);

alter table repartos enable row level security;

create policy "solo mis repartos" on repartos
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

alter table movimientos_bolsillo
  add constraint movimientos_bolsillo_reparto_id_fkey
  foreign key (reparto_id) references repartos(id);

-- 4. Config del plan (una fila por usuario).
create table config_plan (
  usuario_id uuid primary key references auth.users(id),
  meses_emergencia int not null default 3,
  meses_cobertura_gastos numeric not null default 1.5,
  pct_depto int not null default 85 check (pct_depto between 0 and 100),
  gasto_mensual_manual numeric,
  umbral_compra_usd numeric not null default 100
);

alter table config_plan enable row level security;

create policy "solo mi config_plan" on config_plan
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

-- 5. Tipo de cambio: agregar MEP (referencia del plan; movimientos.monto_usd sigue con oficial).
alter table tipo_cambio add column mep_venta numeric;

-- 6. Función para aplicar un movimiento de bolsillo y actualizar el saldo
-- en la misma operación (transaccional dentro de la función).
create or replace function aplicar_movimiento_bolsillo(
  p_usuario_id uuid,
  p_bolsillo_id uuid,
  p_tipo text,
  p_monto numeric,
  p_tc_usado numeric,
  p_reparto_id uuid,
  p_nota text
)
returns movimientos_bolsillo
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_mov movimientos_bolsillo;
begin
  insert into movimientos_bolsillo (usuario_id, bolsillo_id, tipo, monto, tc_usado, reparto_id, nota)
  values (p_usuario_id, p_bolsillo_id, p_tipo, p_monto, p_tc_usado, p_reparto_id, p_nota)
  returning * into v_mov;

  update bolsillos
  set saldo = saldo + p_monto
  where id = p_bolsillo_id and usuario_id = p_usuario_id;

  return v_mov;
end;
$$;

-- 7. Bolsillos por defecto para cada usuario nuevo.
create or replace function crear_bolsillos_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into bolsillos (usuario_id, clave, nombre, moneda, orden) values
    (new.id, 'gastos', 'Gastos', 'ARS', 1),
    (new.id, 'emergencia', 'Fondo de emergencia', 'USD', 2),
    (new.id, 'depto', 'Fondo depto (VOO)', 'USD', 3),
    (new.id, 'aprender', 'Aprender / especular', 'USD', 4);

  insert into config_plan (usuario_id) values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created_bolsillos
  after insert on auth.users
  for each row execute function crear_bolsillos_default();

-- 8. Backfill para usuarios existentes.
insert into bolsillos (usuario_id, clave, nombre, moneda, orden)
select u.id, b.clave, b.nombre, b.moneda, b.orden
from auth.users u
cross join (values
  ('gastos', 'Gastos', 'ARS', 1),
  ('emergencia', 'Fondo de emergencia', 'USD', 2),
  ('depto', 'Fondo depto (VOO)', 'USD', 3),
  ('aprender', 'Aprender / especular', 'USD', 4)
) as b(clave, nombre, moneda, orden)
on conflict (usuario_id, clave) do nothing;

insert into config_plan (usuario_id)
select id from auth.users
on conflict (usuario_id) do nothing;
