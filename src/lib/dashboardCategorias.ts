// Dashboard de gasto por categoría: arma las filas (total, porcentaje del total, cantidad) y el total general a partir
// de lo que devuelve la función SQL totales_por_categoria. Puro y con tests.
export type FilaCategoriaSql = {
  categoria_id: string | null;
  categoria_nombre: string;
  categoria_emoji: string;
  categoria_color: string;
  total_ars: number | string;
  total_usd: number | string;
  cantidad: number | string;
};

export type FilaDashboard = {
  id: string | null;
  nombre: string;
  emoji: string;
  color: string;
  totalArs: number;
  totalUsd: number;
  cantidad: number;
  porcentaje: number; // del total gastado, con un decimal
};

export type Dashboard = {
  totalArs: number;
  totalUsd: number;
  cantidad: number;
  conGastos: FilaDashboard[]; // de mayor a menor
  sinGastos: FilaDashboard[]; // categorías sin gastos en el período (por ejemplo Deportes antes del primer gasto)
};

const redondear1 = (valor: number) => Math.round(valor * 10) / 10;

export function armarDashboardCategorias(filas: FilaCategoriaSql[]): Dashboard {
  const base = filas.map((fila) => ({
    id: fila.categoria_id,
    nombre: fila.categoria_nombre,
    emoji: fila.categoria_emoji,
    color: fila.categoria_color,
    totalArs: Number(fila.total_ars) || 0,
    totalUsd: Number(fila.total_usd) || 0,
    cantidad: Number(fila.cantidad) || 0,
  }));
  const totalArs = base.reduce((total, fila) => total + fila.totalArs, 0);
  const completas: FilaDashboard[] = base.map((fila) => ({ ...fila, porcentaje: totalArs > 0 ? redondear1((fila.totalArs / totalArs) * 100) : 0 }));
  const conGastos = completas.filter((fila) => fila.cantidad > 0 || fila.totalArs > 0).sort((a, b) => b.totalArs - a.totalArs || a.nombre.localeCompare(b.nombre));
  const sinGastos = completas.filter((fila) => fila.cantidad === 0 && fila.totalArs === 0).sort((a, b) => a.nombre.localeCompare(b.nombre));
  return {
    totalArs,
    totalUsd: base.reduce((total, fila) => total + fila.totalUsd, 0),
    cantidad: base.reduce((total, fila) => total + fila.cantidad, 0),
    conGastos,
    sinGastos,
  };
}
