"use client";

import { useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { PALETTE_CATEGORICA, CHART_CHROME } from "@/lib/palette";
import type { Gasto } from "@/components/GraficosMes";

type Dia = { fecha: string; total_dia: number; acumulado: number };

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");

const tooltipStyle = {
  background: "#ffffff",
  border: "1px solid #d7e6f0",
  borderRadius: 8,
  color: CHART_CHROME.texto,
  fontSize: 13,
  boxShadow: "0 4px 16px -4px rgba(15, 37, 51, 0.2)",
};

export function GraficoSemana({
  estaSemana,
  semanaAnterior,
  ultimosGastos,
}: {
  estaSemana: Dia[];
  semanaAnterior: Dia[];
  ultimosGastos: Gasto[];
}) {
  const [busqueda, setBusqueda] = useState("");
  const gastosFiltrados = ultimosGastos.filter((g) => {
    if (!busqueda.trim()) return true;
    const q = busqueda.toLowerCase();
    return (
      g.descripcion?.toLowerCase().includes(q) ||
      g.comercio?.toLowerCase().includes(q) ||
      g.categorias?.nombre.toLowerCase().includes(q)
    );
  });

  const totalEstaSemana = estaSemana.reduce((acc, d) => acc + d.total_dia, 0);
  const totalSemanaAnterior = semanaAnterior.reduce((acc, d) => acc + d.total_dia, 0);
  const diferenciaPct =
    totalSemanaAnterior > 0
      ? Math.round(((totalEstaSemana - totalSemanaAnterior) / totalSemanaAnterior) * 100)
      : null;

  const hoyStr = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });

  const dataBarras = estaSemana.map((d, i) => ({
    dia: DIAS[i] ?? d.fecha,
    total: d.total_dia,
    esHoy: d.fecha === hoyStr,
  }));

  return (
    <div className="flex flex-col gap-6 w-full max-w-md mx-auto p-4 pb-10">
      <div className="flex flex-col gap-1 pt-2">
        <span className="text-muted text-xs uppercase tracking-wide">Gastado esta semana</span>
        <span className="text-4xl font-semibold tabular-nums">${fmt(totalEstaSemana)}</span>
        {diferenciaPct !== null && (
          <span className="text-sm text-muted">
            {diferenciaPct > 0 ? "↑" : diferenciaPct < 0 ? "↓" : "="} {Math.abs(diferenciaPct)}% vs.
            semana pasada (${fmt(totalSemanaAnterior)})
          </span>
        )}
      </div>

      <div className="card p-4">
        <h2 className="text-sm text-muted uppercase tracking-wide mb-3">Por día</h2>
        {dataBarras.every((d) => d.total === 0) ? (
          <p className="text-muted text-sm">Todavía no hay gastos esta semana.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dataBarras}>
              <CartesianGrid stroke={CHART_CHROME.gridline} vertical={false} />
              <XAxis dataKey="dia" stroke={CHART_CHROME.axis} fontSize={12} />
              <YAxis stroke={CHART_CHROME.axis} fontSize={12} width={50} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `$${fmt(Number(v))}`} />
              <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                {dataBarras.map((d) => (
                  <Cell
                    key={d.dia}
                    fill={d.esHoy ? PALETTE_CATEGORICA[0] : "#cbd8e3"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm text-muted uppercase tracking-wide">Gastos de la semana</h2>
          <span className="text-xs text-muted tabular-nums">{ultimosGastos.length}</span>
        </div>
        {ultimosGastos.length === 0 ? (
          <p className="text-muted text-sm">Todavía no hay gastos esta semana.</p>
        ) : (
          <>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre, comercio o categoría..."
              className="w-full bg-surface-2 border border-border-soft rounded-xl px-3 py-2 text-sm outline-none focus:border-accent mb-3"
            />
            {gastosFiltrados.length === 0 ? (
              <p className="text-muted text-sm">Ningún gasto coincide con &quot;{busqueda}&quot;.</p>
            ) : (
              <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
                {gastosFiltrados.map((g) => (
                  <div key={g.id} className="flex items-center justify-between text-sm">
                    <span className="min-w-0">
                      <span className="truncate block">
                        {g.categorias?.emoji ?? "📦"} {g.descripcion}
                      </span>
                      {g.comercio && <span className="text-muted text-xs">{g.comercio} · {g.fecha}</span>}
                    </span>
                    <span className="tabular-nums text-muted shrink-0 ml-2">${fmt(g.monto_ars)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
