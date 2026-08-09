-- Seeds: categorías fijas con emoji y color

insert into categorias (nombre, emoji, color, tipo, orden) values
  ('Supermercado',          '🛒', '#22c55e', 'gasto', 1),
  ('Delivery/Restaurantes', '🍔', '#f97316', 'gasto', 2),
  ('Transporte/Nafta',      '⛽', '#eab308', 'gasto', 3),
  ('Servicios',             '💡', '#38bdf8', 'gasto', 4),
  ('Alquiler',              '🏠', '#a855f7', 'gasto', 5),
  ('Salud',                 '💊', '#ef4444', 'gasto', 6),
  ('Ocio',                  '🎮', '#ec4899', 'gasto', 7),
  ('Ropa',                  '👕', '#06b6d4', 'gasto', 8),
  ('Educación',             '📚', '#6366f1', 'gasto', 9),
  ('Suscripciones',         '📺', '#8b5cf6', 'gasto', 10),
  ('Impuestos',             '🧾', '#64748b', 'gasto', 11),
  ('Otros',                 '📦', '#94a3b8', 'gasto', 12),
  ('Clientes',              '💼', '#22c55e', 'ingreso', 1),
  ('Sueldo',                '💰', '#16a34a', 'ingreso', 2),
  ('Ventas',                '🏷️', '#0ea5e9', 'ingreso', 3),
  ('Otros',                 '📦', '#94a3b8', 'ingreso', 4);
