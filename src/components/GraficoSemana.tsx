"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { PALETTE_CATEGORICA, CHART_CHROME } from "@/lib/palette";

type Dia = { fecha: string; total_dia: number; acumulado: number };

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");

const tooltipStyle = {
  background: "#171717",
  border: "1px solid #262626",
  borderRadius: 8,
  color: CHART_CHROME.texto,
  fontSize: 13,
};

export function GraficoSemana({
  estaSemana,
  semanaAnterior,
}: {
  estaSemana: Dia[];
  semanaAnterior: Dia[];
}) {
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

      <div className="bg-surface border border-border rounded-lg p-4">
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
                    fill={d.esHoy ? PALETTE_CATEGORICA[0] : "#3a3a3a"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
