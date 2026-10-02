-- Modulo de inversiones, fase 1. Evoluciona el plan de ahorro creado en 0009
-- sin reescribir una migracion que puede estar aplicada en produccion.

-- 1. Bolsillos: renombrar el fondo del depto y sumar el acumulador de compras.
alter table bolsillos drop constraint if exists bolsillos_clave_check;

update bolsillos
set clave = 'largo_plazo', nombre = 'Largo plazo (VOO)'
where clave = 'depto';

alter table bolsillos
  add constraint bolsillos_clave_check
  check (clave in ('gastos', 'emergencia', 'largo_plazo', 'aprender', 'por_invertir'));

insert into bolsillos (usuario_id, clave, nombre, moneda, orden)
select id, 'por_invertir', 'Por invertir', 'USD', 5
from auth.users
on conflict (usuario_id, clave) do nothing;

-- 2. Configuracion de la politica. Las columnas viejas quedan durante esta
-- migracion para no romper instalaciones que aun ejecuten codigo anterior.
alter table config_plan
  add column if not exists pct_gastos int not null default 25,
  add column if not exists pct_largo_plazo int not null default 65,
  add column if not exists pct_aprender int not null default 10,
  add column if not exists emergencia_primero boolean not null default true,
  add column if not exists minimo_compra_usd numeric not null default 100,
  add column if not exists fecha_objetivo_depto date,
  add column if not exists monto_objetivo_depto_usd numeric,
  add column if not exists anios_transicion int not null default 3;

update config_plan
set pct_gastos = 25,
    pct_largo_plazo = 65,
    pct_aprender = 10,
    minimo_compra_usd = coalesce(umbral_compra_usd, 100);

alter table config_plan
  add constraint config_plan_porcentajes_check
  check (
    pct_gastos between 0 and 100
    and pct_largo_plazo between 0 and 100
    and pct_aprender between 0 and 100
    and pct_gastos + pct_largo_plazo + pct_aprender = 100
  ),
  add constraint config_plan_meses_emergencia_check check (meses_emergencia > 0),
  add constraint config_plan_minimo_compra_check check (minimo_compra_usd > 0),
  add constraint config_plan_anios_transicion_check check (anios_transicion > 0);

-- 3. Trazabilidad preparada para las operaciones de cartera de la fase 2.
alter table movimientos_bolsillo drop constraint if exists movimientos_bolsillo_tipo_check;
alter table movimientos_bolsillo
  add constraint movimientos_bolsillo_tipo_check
  check (tipo in ('aporte', 'retiro', 'ajuste', 'compra', 'venta')),
  add column if not exists operacion_id uuid;

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
  perform 1 from bolsillos where id = p_bolsillo_id and usuario_id = p_usuario_id;
  if not found then
    raise exception 'El bolsillo no pertenece al usuario';
  end if;

  insert into movimientos_bolsillo (usuario_id, bolsillo_id, tipo, monto, tc_usado, reparto_id, nota)
  values (p_usuario_id, p_bolsillo_id, p_tipo, p_monto, p_tc_usado, p_reparto_id, p_nota)
  returning * into v_mov;

  update bolsillos set saldo = saldo + p_monto where id = p_bolsillo_id and usuario_id = p_usuario_id;
  return v_mov;
end;
$$;
-- 4. Los usuarios nuevos reciben la politica y los cinco bolsillos.
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
    (new.id, 'largo_plazo', 'Largo plazo (VOO)', 'USD', 3),
    (new.id, 'aprender', 'Aprender', 'USD', 4),
    (new.id, 'por_invertir', 'Por invertir', 'USD', 5);

  insert into config_plan (usuario_id) values (new.id);
  return new;
end;
$$;

-- 5. Un ingreso solo puede tener un reparto automatico.
create unique index if not exists idx_repartos_ingreso_unico
  on repartos (ingreso_id)
  where ingreso_id is not null;

-- 6. Aplicar el reparto completo en una unica transaccion. El detalle se
-- calcula en el servidor con la sesion autenticada; esta funcion vuelve a
-- validar propiedad y estado antes de tocar saldos.
create or replace function aplicar_reparto(
  p_usuario_id uuid,
  p_reparto_id uuid,
  p_tc_usado numeric,
  p_detalle jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_clave text;
  v_monto numeric;
  v_bolsillo_id uuid;
begin
  if p_tc_usado is null or p_tc_usado <= 0 then
    raise exception 'Cotizacion invalida';
  end if;

  perform 1
  from repartos
  where id = p_reparto_id
    and usuario_id = p_usuario_id
    and estado = 'pendiente'
  for update;

  if not found then
    raise exception 'El reparto no existe o ya no esta pendiente';
  end if;

  foreach v_clave in array array['gastos', 'emergencia', 'largo_plazo', 'aprender', 'por_invertir']
  loop
    v_monto := coalesce((p_detalle ->> v_clave)::numeric, 0);
    if v_monto <= 0 then
      continue;
    end if;

    select id into v_bolsillo_id
    from bolsillos
    where usuario_id = p_usuario_id and clave = v_clave
    for update;

    if v_bolsillo_id is null then
      raise exception 'Falta el bolsillo %', v_clave;
    end if;

    insert into movimientos_bolsillo (
      usuario_id, bolsillo_id, tipo, monto, tc_usado, reparto_id, nota
    ) values (
      p_usuario_id,
      v_bolsillo_id,
      'aporte',
      v_monto,
      case when v_clave = 'gastos' then null else p_tc_usado end,
      p_reparto_id,
      'Aplicacion de reparto'
    );

    update bolsillos set saldo = saldo + v_monto where id = v_bolsillo_id;
  end loop;

  update repartos
  set detalle = p_detalle,
      estado = 'aplicado',
      aplicado_at = now()
  where id = p_reparto_id and usuario_id = p_usuario_id;
end;
$$;

