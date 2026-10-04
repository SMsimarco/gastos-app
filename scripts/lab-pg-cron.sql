-- Laboratorio (SIMULADO): programación de las tareas con Supabase pg_cron + pg_net.
-- Vercel está en plan Hobby (crons de una vez por día), por eso la frecuencia de 15/30 minutos
-- la maneja Supabase llamando a los endpoints /api/lab/*. Ver NOTES.md > Fase 6A.
--
-- Cómo usarlo (SQL Editor de Supabase, una sola vez, después de aplicar la migración 0018):
--   1. Reemplazá TU_LAB_CRON_SECRET por el mismo valor que cargaste como LAB_CRON_SECRET en Vercel.
--   2. Ejecutá todo el script. Es seguro repetirlo: cron.schedule con el mismo nombre actualiza el job.
-- Para pausar todo:  select cron.unschedule(jobid) from cron.job where jobname like 'lab-%';
--
-- Horarios en UTC. El mercado de EE.UU. abre 9:30 y cierra 16:00 de Nueva York (13:30-20:00 UTC en
-- horario de verano, 14:30-21:00 UTC en invierno). El monitor corre en una ventana amplia y el endpoint
-- consulta el reloj de Alpaca: con el mercado cerrado o en feriado no hace nada.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- El secreto va al Vault (cifrado) en vez de quedar en el texto de cada job.
select vault.create_secret('TU_LAB_CRON_SECRET', 'lab_cron_secret')
where not exists (select 1 from vault.secrets where name = 'lab_cron_secret');

-- Monitor de mercado: cada 15 minutos, lunes a viernes.
select cron.schedule('lab-monitor', '*/15 13-21 * * 1-5', $job$
  select net.http_get(
    url := 'https://gastosvoz.vercel.app/api/lab/monitor',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lab_cron_secret')),
    timeout_milliseconds := 55000
  );
$job$);

-- Noticias por empresa (Alpaca) y resumen con IA de todo lo pendiente: cada 30 minutos, todos los días
-- y también fuera de horario.
select cron.schedule('lab-noticias', '*/30 * * * *', $job$
  select net.http_get(
    url := 'https://gastosvoz.vercel.app/api/lab/noticias',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lab_cron_secret')),
    timeout_milliseconds := 58000
  );
$job$);

-- Noticias globales de GDELT: PAUSADO. Verificado el 2026-10-04: desde la red de prueba y desde Vercel
-- falla casi siempre (HTTP 429 o "fetch failed" por timeout de conexión). Las noticias globales salen
-- hoy del flujo general de Alpaca (job lab-noticias). Para reactivar GDELT (un tema por corrida, cada
-- 10 min), descomentá el bloque y ejecutalo, o: select cron.alter_job(<jobid>, active := true);
-- select cron.schedule('lab-gdelt', '*/10 * * * *', $job$
--   select net.http_get(
--     url := 'https://gastosvoz.vercel.app/api/lab/gdelt',
--     headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lab_cron_secret')),
--     timeout_milliseconds := 58000
--   );
-- $job$);

-- Indicadores, macro y calendario: una vez por día, después del cierre (22:30 UTC cubre verano e invierno).
select cron.schedule('lab-macro', '30 22 * * 1-5', $job$
  select net.http_get(
    url := 'https://gastosvoz.vercel.app/api/lab/macro',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lab_cron_secret')),
    timeout_milliseconds := 58000
  );
$job$);

-- Limpieza: precios intradía de más de 30 días y registros de ejecución de más de 60 días.
select cron.schedule('lab-limpieza', '15 5 * * *', $job$
  delete from lab_precios where tipo = 'intradia' and ts < now() - interval '30 days';
  delete from lab_ejecuciones where ts < now() - interval '60 days';
$job$);

-- Para verificar que corren:
--   select jobname, schedule, active from cron.job where jobname like 'lab-%';
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select tarea, ok, ts, error from lab_ejecuciones order by ts desc limit 10;
