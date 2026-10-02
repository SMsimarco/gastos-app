-- Presupuesto general: un solo monto total por usuario (ej. el sueldo),
-- sin categoría, que se va descontando con CUALQUIER gasto del mes. Vive
-- aparte de "presupuestos" (por categoría, opcional/avanzado) — el aro de
-- la pantalla Hoy prioriza este si está cargado.
create table presupuesto_general (
  usuario_id uuid primary key references auth.users(id),
  monto numeric not null check (monto > 0),
  actualizado_at timestamptz not null default now()
);

alter table presupuesto_general enable row level security;

create policy "solo mi presupuesto general" on presupuesto_general
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);
