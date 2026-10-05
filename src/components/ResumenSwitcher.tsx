"use client";

import { useRef, useState, type TouchEvent } from "react";
import { GraficoSemana } from "@/components/GraficoSemana";
import { GraficosMes, type Kpis, type Gasto } from "@/components/GraficosMes";
import { GraficoAnio } from "@/components/GraficoAnio";
import { DashboardCategorias } from "@/components/DashboardCategorias";
import type { FilaCategoriaSql } from "@/lib/dashboardCategorias";

type Dia = { fecha: string; total_dia: number; acumulado: number };
type CategoriaTotal = {
  categoria_id: string | null;
  categoria_nombre: string;
  categoria_emoji: string;
  categoria_color: string;
  total_ars: number;
  total_usd: number;
  cantidad: number;
};
type Comercio = { comercio: string; total_ars: number; cantidad: number };
type ResumenMes = {
  mes: number;
  gastado_ars: number;
  gastado_usd: number;
  ingresado_ars: number;
  ingresado_usd: number;
};
type CategoriaMes = { mes: number; categoria_nombre: string; categoria_emoji: string; total_ars: number };

const PERIODOS = [
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mes" },
  { id: "anio", label: "Año" },
  { id: "categorias", label: "Categorías" },
] as const;

type Periodo = (typeof PERIODOS)[number]["id"];

export function ResumenSwitcher({
  semana,
  mes,
  anio,
  categorias,
}: {
  semana: { estaSemana: Dia[]; semanaAnterior: Dia[]; ultimosGastos: Gasto[] };
  mes: {
    kpis: Kpis;
    categorias: CategoriaTotal[];
    acumuladoEsteMes: Dia[];
    acumuladoMesAnterior: Dia[];
    comercios: Comercio[];
    ultimosGastos: Gasto[];
    desde: string;
    hasta: string;
  };
  anio: {
    anio: number;
    resumen: ResumenMes[];
    categoriaMensual: CategoriaMes[];
    diario: Dia[];
    ultimosGastos: Gasto[];
  };
  categorias: { mes: FilaCategoriaSql[]; anio: FilaCategoriaSql[]; todo: FilaCategoriaSql[] };
}) {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const inicioToque = useRef<{ x: number; y: number } | null>(null);

  function alEmpezarToque(e: TouchEvent) {
    // Si el gesto arranca en un área con scroll horizontal propio (gráfico del año), no cambia de período.
    if ((e.target as HTMLElement).closest(".overflow-x-auto")) return;
    const toque = e.touches[0];
    inicioToque.current = { x: toque.clientX, y: toque.clientY };
  }

  // Deslizar a la izquierda avanza (Semana > Mes > Año), a la derecha vuelve.
  // Se ignoran gestos mayormente verticales (scroll) o cortos.
  function alTerminarToque(e: TouchEvent) {
    const inicio = inicioToque.current;
    inicioToque.current = null;
    if (!inicio) return;
    const toque = e.changedTouches[0];
    const dx = toque.clientX - inicio.x;
    const dy = toque.clientY - inicio.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const indice = PERIODOS.findIndex((p) => p.id === periodo);
    const siguiente = PERIODOS[indice + (dx < 0 ? 1 : -1)];
    if (siguiente) setPeriodo(siguiente.id);
  }

  return (
    <div className="flex flex-col" onTouchStart={alEmpezarToque} onTouchEnd={alTerminarToque}>
      <div className="sticky top-0 z-10 backdrop-blur-md px-4 pt-4 pb-2" style={{ backgroundColor: "rgba(238, 245, 250, 0.85)" }}>
        <div className="flex gap-1 bg-surface-2 rounded-xl p-1 w-full max-w-md mx-auto">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriodo(p.id)}
              className={`pressable flex-1 py-2 text-sm rounded-lg transition-colors ${
                periodo === p.id ? "bg-accent text-black font-medium" : "text-muted hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {periodo === "semana" && <GraficoSemana {...semana} />}
      {periodo === "mes" && <GraficosMes {...mes} />}
      {periodo === "anio" && <GraficoAnio {...anio} />}
      {periodo === "categorias" && <DashboardCategorias datos={categorias} />}
    </div>
  );
}
