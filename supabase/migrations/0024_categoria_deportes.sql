-- Categoría global "Deportes" (cancha, gimnasio, club, fútbol, pádel, entradas). Es de todos los usuarios, como las
-- demás categorías sembradas (usuario_id null). Seguro de repetir.
insert into categorias (nombre, emoji, color, tipo, orden)
values ('Deportes', '⚽', '#14b8a6', 'gasto', 13)
on conflict (nombre, tipo) do nothing;
