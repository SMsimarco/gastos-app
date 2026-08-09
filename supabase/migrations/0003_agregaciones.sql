-- Agregaciones server-side para la PWA. Nada de sumar 5000 filas en JS.

-- Totales por categoría en un rango de fechas (para donut + drill-down).
create or replace function totales_por_categoria(desde date, hasta date, tipo_filtro text default 'gasto')
returns table (
  categoria_id uuid,
  categoria_nombre text,
  categoria_emoji text,
  categoria_color text,
  total_ars numeric,
  total_usd numeric,
  cantidad bigint
)
language sql stable as $$
  select
    c.id,
    c.nombre,
    c.emoji,
    c.color,
    coalesce(sum(m.monto_ars), 0),
    coalesce(sum(m.monto_usd), 0),
    count(m.id)
  from categorias c
  left join movimientos m
    on m.categoria_id = c.id
    and m.tipo = tipo_filtro
    and m.fecha between desde and hasta
  where c.tipo = tipo_filtro
  group by c.id, c.nombre, c.emoji, c.color, c.orden
  order by c.orden;
$$;

-- Serie diaria acumulada de gasto (para el gráfico "gasto acumulado del mes vs mes anterior").
create or replace function gasto_acumulado_diario(desde date, hasta date)
returns table (
  fecha date,
  total_dia numeric,
  acumulado numeric
)
language sql stable as $$
  with dias as (
    select generate_series(desde, hasta, interval '1 day')::date as fecha
  ),
  por_dia as (
    select d.fecha, coalesce(sum(m.monto_ars), 0) as total_dia
    from dias d
    left join movimientos m on m.fecha = d.fecha and m.tipo = 'gasto'
    group by d.fecha
  )
  select fecha, total_dia, sum(total_dia) over (order by fecha) as acumulado
  from por_dia
  order by fecha;
$$;

-- Top comercios por monto en un rango (para barras horizontales top 10).
create or replace function top_comercios(desde date, hasta date, limite int default 10)
returns table (
  comercio text,
  total_ars numeric,
  cantidad bigint
)
language sql stable as $$
  select comercio, sum(monto_ars), count(*)
  from movimientos
  where tipo = 'gasto'
    and comercio is not null
    and fecha between desde and hasta
  group by comercio
  order by sum(monto_ars) desc
  limit limite;
$$;

-- KPIs del mes: gastado, ingresado, balance, promedio diario, proyección a fin de mes.
create or replace function kpis_mes(mes_inicio date)
returns table (
  gastado numeric,
  ingresado numeric,
  balance numeric,
  promedio_diario numeric,
  proyeccion_fin_mes numeric
)
language sql stable as $$
  with rango as (
    select mes_inicio as inicio, (mes_inicio + interval '1 month - 1 day')::date as fin
  ),
  agg as (
    select
      coalesce(sum(monto_ars) filter (where tipo = 'gasto'), 0) as gastado,
      coalesce(sum(monto_ars) filter (where tipo = 'ingreso'), 0) as ingresado
    from movimientos, rango
    where fecha between rango.inicio and least(rango.fin, current_date)
  ),
  dias_transcurridos as (
    select greatest(1, (least((select fin from rango), current_date) - (select inicio from rango) + 1)) as n
  ),
  dias_totales as (
    select ((select fin from rango) - (select inicio from rango) + 1) as n
  )
  select
    agg.gastado,
    agg.ingresado,
    agg.ingresado - agg.gastado,
    round(agg.gastado / (select n from dias_transcurridos), 2),
    round((agg.gastado / (select n from dias_transcurridos)) * (select n from dias_totales), 2)
  from agg;
$$;
