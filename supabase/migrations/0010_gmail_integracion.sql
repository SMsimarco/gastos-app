-- Auto-registro de gastos desde emails de billeteras virtuales (MP, etc.).
-- El cron lee la casilla del usuario buscando mails de los remitentes
-- configurados y les pasa el texto a Gemini (mismo pipeline que un mensaje
-- de texto escrito a mano).

alter table movimientos drop constraint movimientos_fuente_check;
alter table movimientos add constraint movimientos_fuente_check
  check (fuente in ('audio', 'texto', 'foto', 'recurrente', 'manual', 'email'));

create table gmail_integracion (
  usuario_id uuid primary key references auth.users(id),
  refresh_token text,
  remitentes text[] not null default array['mercadopago.com.ar', 'mercadopago.com'],
  activo boolean not null default false,
  label_procesado_id text,
  label_omitido_id text,
  ultimo_check timestamptz,
  created_at timestamptz not null default now()
);

alter table gmail_integracion enable row level security;

-- A propósito, SIN policies para "authenticated": esta tabla guarda un
-- refresh_token de Gmail (acceso de lectura a la casilla completa), más
-- sensible que el resto de las tablas del usuario. Ni el propio dueño puede
-- leer/escribir esta fila desde el cliente — todo pasa por rutas server-side
-- que ya verificaron la sesión a mano (ver SECURITY.md).
