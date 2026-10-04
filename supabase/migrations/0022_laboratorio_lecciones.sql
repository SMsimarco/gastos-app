-- Fase 6, parte B2: lecciones de los bots (capa 3 del aprendizaje del laboratorio, SIMULADO).
-- Cuando una decision cumple su horizonte, el codigo mide el resultado (contra el precio de ejecucion y
-- contra VOO en el mismo periodo) y una llamada de IA escribe una leccion corta que vuelve al briefing
-- del mismo bot. Solo para bots con perfil completo (el bot C no tiene memoria, por diseno).
-- Nada referencia el plan real.

create table lab_lecciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  bot_id uuid not null,
  decision_id uuid not null references lab_decisiones(id) on delete cascade,
  horizonte_ruedas integer not null check (horizonte_ruedas > 0),
  fecha_decision date not null,
  ticker text not null,
  accion text not null check (accion in ('comprar', 'vender')),
  resultado_pct numeric not null,       -- lo que hizo el precio desde la ejecucion hasta el horizonte
  voo_pct numeric,                      -- VOO en el mismo periodo
  exceso_pct numeric,                   -- cuanto aporto la decision contra VOO (en una venta, evitar caer suma)
  veredicto text not null check (veredicto in ('acerto', 'erro', 'neutral')),
  leccion text not null,
  modelo text,
  costo_usd numeric(12, 6) not null default 0,
  creada_at timestamptz not null default now(),
  unique (decision_id, horizonte_ruedas),
  foreign key (usuario_id, bot_id) references lab_bots(usuario_id, id)
);
create index idx_lab_lecciones_bot on lab_lecciones (bot_id, creada_at desc);
alter table lab_lecciones enable row level security;
create policy "solo mis lab_lecciones" on lab_lecciones
  for all to authenticated
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);
