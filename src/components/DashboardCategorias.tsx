"use client";

import { useMemo, useState } from "react";
import { armarDashboardCategorias, type FilaCategoriaSql } from "@/lib/dashboardCategorias";

type Rango = "mes" | "anio" | "todo";
const RANGOS: Array<{ id: Rango; label: string }> = [
  { id: "mes", label: "Este mes" },
  { id: "anio", label: "Este año" },
  { id: "todo", label: "Todo" },
];

const ars = (valor: number) => `$${Math.round(valor).toLocaleString("es-AR")}`;
const usd = (valor: number) => `US$${valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function DashboardCategorias({ datos }: { datos: Record<Rango, FilaCategoriaSql[]> }) {
  const [rango, setRango] = useState<Rango>("mes");
  const dashboard = useMemo(() => armarDashboardCategorias(datos[rango]), [datos, rango]);
  const maximo = dashboard.conGastos[0]?.totalArs ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8 pt-2">
      <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
        {RANGOS.map((item) => (
          <button key={item.id} onClick={() => setRango(item.id)} className={`pressable flex-1 rounded-lg py-2 text-sm transition-colors ${rango === item.id ? "bg-accent font-medium text-black" : "text-muted hover:text-foreground"}`}>{item.label}</button>
        ))}
      </div>

      <section className="card flex flex-col gap-1 p-4">
        <p className="text-sm text-muted">Total gastado</p>
        <p className="text-3xl font-semibold tabular-nums">{ars(dashboard.totalArs)}</p>
        <p className="text-xs text-muted">{dashboard.cantidad} {dashboard.cantidad === 1 ? "gasto" : "gastos"}{dashboard.totalUsd > 0 ? ` · ${usd(dashboard.totalUsd)} en dólares` : ""}</p>
      </section>

      <section className="card flex flex-col gap-4 p-4">
        <p className="font-medium">Por categoría</p>
        {dashboard.conGastos.length === 0 && <p className="text-sm text-muted">Todavía no hay gastos en este período.</p>}
        {dashboard.conGastos.map((fila) => (
          <div key={fila.id ?? fila.nombre} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{fila.emoji} {fila.nombre}</span>
              <span className="shrink-0 font-semibold tabular-nums">{ars(fila.totalArs)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full" style={{ width: `${maximo > 0 ? Math.max(2, (fila.totalArs / maximo) * 100) : 0}%`, backgroundColor: fila.color }} /></div>
            <p className="text-xs text-muted">{String(fila.porcentaje).replace(".", ",")}% del total · {fila.cantidad} {fila.cantidad === 1 ? "gasto" : "gastos"}{fila.totalUsd > 0 ? ` · ${usd(fila.totalUsd)}` : ""}</p>
          </div>
        ))}
        {dashboard.sinGastos.length > 0 && (
          <p className="border-t border-border-soft pt-3 text-xs text-muted">Sin gastos en este período: {dashboard.sinGastos.map((fila) => `${fila.emoji} ${fila.nombre}`).join(" · ")}</p>
        )}
      </section>
    </div>
  );
}
