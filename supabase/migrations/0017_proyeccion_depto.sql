-- Supuesto configurable para la proyección del objetivo departamento.
alter table config_plan
  add column if not exists rendimiento_anual_supuesto numeric not null default 0.07;

alter table config_plan drop constraint if exists config_plan_rendimiento_anual_check;
alter table config_plan
  add constraint config_plan_rendimiento_anual_check
  check (rendimiento_anual_supuesto > -1 and rendimiento_anual_supuesto <= 1);
