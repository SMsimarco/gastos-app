-- Agregaciones para la vista Año.

-- Gastado/ingresado por mes, en ARS y USD (para barras + ingresos vs gastos).
create or replace function resumen_anual(anio int)
returns table (
  mes int,
  gastado_ars numeric,
  gastado_usd numeric,
  ingresado_ars numeric,
  ingresado_usd numeric
)
language sql stable as $$
  select
    meses.mes,
    coalesce(sum(m.monto_ars) filter (where m.tipo = 'gasto'), 0),
    coalesce(sum(m.monto_usd) filter (where m.tipo = 'gasto'), 0),
    coalesce(sum(m.monto_ars) filter (where m.tipo = 'ingreso'), 0),
    coalesce(sum(m.monto_usd) filter (where m.tipo = 'ingreso'), 0)
  from generate_series(1, 12) as meses(mes)
  left join movimientos m
    on extract(month from m.fecha) = meses.mes
    and extract(year from m.fecha) = anio
  group by meses.mes
  order by meses.mes;
$$;

-- Gasto por categoria y mes (para el area apilada del año).
create or replace function totales_categoria_mensual(anio int)
returns table (
  mes int,
  categoria_nombre text,
  categoria_emoji text,
  total_ars numeric
)
language sql stable as $$
  select
    extract(month from m.fecha)::int,
    c.nombre,
    c.emoji,
    sum(m.monto_ars)
  from movimientos m
  join categorias c on c.id = m.categoria_id
  where m.tipo = 'gasto'
    and extract(year from m.fecha) = anio
  group by extract(month from m.fecha), c.nombre, c.emoji
  order by 1;
$$;
