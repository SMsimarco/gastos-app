"use client";

import { useState } from "react";
import { GraficoSemana } from "@/components/GraficoSemana";
import { GraficosMes, type Kpis, type Gasto } from "@/components/GraficosMes";
import { GraficoAnio } from "@/components/GraficoAnio";

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
] as const;

type Periodo = (typeof PERIODOS)[number]["id"];

export function ResumenSwitcher({
  semana,
  mes,
  anio,
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
}) {
  const [periodo, setPeriodo] = useState<Periodo>("mes");

  return (
    <div className="flex flex-col">
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
    </div>
  );
}
