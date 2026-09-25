-- Vuelve el acceso a Gmail 100% lectura (gmail.readonly): etiquetar mensajes
-- necesitaba gmail.modify/gmail.labels, un permiso de más. El control de
-- "ya lo procesé" pasa a esta tabla en vez de una etiqueta en el mail.

create table gmail_mensajes_procesados (
  usuario_id uuid not null references auth.users(id),
  mensaje_id text not null,
  estado text not null check (estado in ('procesado', 'omitido')),
  created_at timestamptz not null default now(),
  primary key (usuario_id, mensaje_id)
);

alter table gmail_mensajes_procesados enable row level security;
-- Mismo criterio que gmail_integracion: sin policies para "authenticated",
-- solo la toca el server con service_role (ver SECURITY.md).

alter table gmail_integracion drop column label_procesado_id;
alter table gmail_integracion drop column label_omitido_id;
