-- Modulo de inversiones, fase 2: activos, operaciones y precios historicos.

alter table config_plan
  add column if not exists inflacion_mensual_pct numeric;

alter table config_plan
  add constraint config_plan_inflacion_check
  check (inflacion_mensual_pct is null or inflacion_mensual_pct >= 0);

create table activos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  ticker text not null,
  nombre text not null,
  tipo text not null check (tipo in ('etf', 'accion', 'cuenta_remunerada')),
  moneda text not null check (moneda in ('ARS', 'USD')),
  bolsillo_clave text not null check (bolsillo_clave in ('gastos', 'emergencia', 'largo_plazo', 'aprender', 'por_invertir')),
  en_politica boolean not null default true,
  tesis text,
  toma_ganancia_pct numeric,
  stop_revision_pct numeric,
  tasa_anual numeric,
  created_at timestamptz not null default now(),
  unique (usuario_id, ticker),
  unique (usuario_id, id),
  check (tasa_anual is null or tasa_anual >= 0)
);

create index idx_activos_usuario on activos (usuario_id);
alter table activos enable row level security;
create policy "solo mis activos" on activos
  for all to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

create table operaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  activo_id uuid not null,
  tipo text not null check (tipo in ('compra', 'venta', 'dividendo')),
  fecha date not null,
  cantidad numeric not null check (cantidad >= 0),
  precio_usd numeric not null check (precio_usd >= 0),
  monto_usd numeric not null check (monto_usd > 0),
  comision_usd numeric not null default 0 check (comision_usd >= 0),
  nota text,
  created_at timestamptz not null default now(),
  foreign key (usuario_id, activo_id) references activos(usuario_id, id)
);

create index idx_operaciones_usuario on operaciones (usuario_id);
create index idx_operaciones_activo_fecha on operaciones (activo_id, fecha);
alter table operaciones enable row level security;
create policy "solo mis operaciones" on operaciones
  for all to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

create table precios (
  ticker text not null,
  fecha date not null,
  cierre_usd numeric not null check (cierre_usd > 0),
  max_52s numeric check (max_52s is null or max_52s > 0),
  primary key (ticker, fecha)
);

alter table precios enable row level security;
create policy "precios visibles para autenticados" on precios
  for select to authenticated using (true);

-- Desde 2026 Supabase puede requerir grants explicitos para exponer tablas
-- nuevas a PostgREST. RLS sigue limitando las filas por usuario.
grant select, insert, update, delete on activos, operaciones to authenticated;
grant select on precios to authenticated;
grant all on activos, operaciones, precios to service_role;

alter table movimientos_bolsillo
  add constraint movimientos_bolsillo_operacion_id_fkey
  foreign key (operacion_id) references operaciones(id);

create or replace function crear_activos_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into activos (usuario_id, ticker, nombre, tipo, moneda, bolsillo_clave, en_politica, tasa_anual) values
    (new.id, 'VOO', 'Vanguard S&P 500 ETF', 'etf', 'USD', 'largo_plazo', true, null),
    (new.id, 'USDC-REM', 'USDc Remunerada', 'cuenta_remunerada', 'USD', 'emergencia', true, 2),
    (new.id, 'ARS-REM', 'ARS Remunerada', 'cuenta_remunerada', 'ARS', 'gastos', true, 19.22);
  return new;
end;
$$;

create trigger on_auth_user_created_activos
  after insert on auth.users
  for each row execute function crear_activos_default();

revoke execute on function crear_activos_default() from public;

insert into activos (usuario_id, ticker, nombre, tipo, moneda, bolsillo_clave, en_politica, tasa_anual)
select u.id, a.ticker, a.nombre, a.tipo, a.moneda, a.bolsillo_clave, true, a.tasa_anual
from auth.users u
cross join (values
  ('VOO', 'Vanguard S&P 500 ETF', 'etf', 'USD', 'largo_plazo', null::numeric),
  ('USDC-REM', 'USDc Remunerada', 'cuenta_remunerada', 'USD', 'emergencia', 2::numeric),
  ('ARS-REM', 'ARS Remunerada', 'cuenta_remunerada', 'ARS', 'gastos', 19.22::numeric)
) as a(ticker, nombre, tipo, moneda, bolsillo_clave, tasa_anual)
on conflict (usuario_id, ticker) do nothing;

create or replace function registrar_operacion_cartera(
  p_usuario_id uuid,
  p_activo_id uuid,
  p_tipo text,
  p_fecha date,
  p_cantidad numeric,
  p_precio_usd numeric,
  p_monto_usd numeric,
  p_comision_usd numeric,
  p_nota text
)
returns table (operacion_id uuid, bolsillo_clave text, saldo_resultante numeric)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_operacion_id uuid;
  v_activo activos;
  v_bolsillo bolsillos;
  v_por_invertir bolsillos;
  v_movimiento numeric;
begin
  select * into v_activo
  from activos
  where id = p_activo_id and usuario_id = p_usuario_id and en_politica = true;

  if v_activo.id is null then
    raise exception 'El activo no existe o no esta en tu politica';
  end if;

  if p_tipo not in ('compra', 'venta', 'dividendo') then
    raise exception 'Tipo de operacion invalido';
  end if;

  insert into operaciones (usuario_id, activo_id, tipo, fecha, cantidad, precio_usd, monto_usd, comision_usd, nota)
  values (p_usuario_id, p_activo_id, p_tipo, p_fecha, p_cantidad, p_precio_usd, p_monto_usd, coalesce(p_comision_usd, 0), p_nota)
  returning id into v_operacion_id;

  select * into v_bolsillo
  from bolsillos
  where usuario_id = p_usuario_id and clave = v_activo.bolsillo_clave
  for update;

  if p_tipo = 'compra' and v_activo.tipo <> 'cuenta_remunerada' then
    select * into v_por_invertir
    from bolsillos
    where usuario_id = p_usuario_id and clave = 'por_invertir'
    for update;

    if v_por_invertir.id is not null and v_por_invertir.saldo >= p_monto_usd + coalesce(p_comision_usd, 0) then
      v_bolsillo := v_por_invertir;
    end if;
  end if;

  if v_bolsillo.id is null then
    raise exception 'Falta el bolsillo asociado al activo';
  end if;

  if p_tipo = 'compra' then
    v_movimiento := -(p_monto_usd + coalesce(p_comision_usd, 0));
  else
    v_movimiento := p_monto_usd - coalesce(p_comision_usd, 0);
  end if;

  insert into movimientos_bolsillo (usuario_id, bolsillo_id, tipo, monto, operacion_id, nota)
  values (
    p_usuario_id,
    v_bolsillo.id,
    case when p_tipo = 'compra' then 'compra' else 'venta' end,
    v_movimiento,
    v_operacion_id,
    'Operacion ' || p_tipo || ' de ' || v_activo.ticker
  );

  update bolsillos set saldo = saldo + v_movimiento where id = v_bolsillo.id;

  return query select v_operacion_id, v_bolsillo.clave, v_bolsillo.saldo + v_movimiento;
end;
$$;

revoke execute on function registrar_operacion_cartera(uuid, uuid, text, date, numeric, numeric, numeric, numeric, text) from public;
grant execute on function registrar_operacion_cartera(uuid, uuid, text, date, numeric, numeric, numeric, numeric, text) to authenticated;
