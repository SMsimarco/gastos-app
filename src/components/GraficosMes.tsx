"use client";

import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import { PALETTE_CATEGORICA, CHART_CHROME } from "@/lib/palette";

export type Kpis = {
  gastado: number;
  ingresado: number;
  balance: number;
  promedio_diario: number;
  proyeccion_fin_mes: number;
} | null;

type CategoriaTotal = {
  categoria_id: string | null;
  categoria_nombre: string;
  categoria_emoji: string;
  categoria_color: string;
  total_ars: number;
  total_usd: number;
  cantidad: number;
};

type AcumuladoDia = { fecha: string; total_dia: number; acumulado: number };

type Comercio = { comercio: string; total_ars: number; cantidad: number };

export type Gasto = {
  id: string;
  descripcion: string;
  fecha: string;
  monto_ars: number;
  comercio: string | null;
  categorias: { nombre: string; emoji: string } | null;
};

const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");

function StatTile({ label, valor, destacado }: { label: string; valor: string; destacado?: boolean }) {
  return (
    <div className="card px-4 py-3 flex flex-col gap-1">
      <span className="text-muted text-xs uppercase tracking-wide">{label}</span>
      <span
        className={`font-semibold tabular-nums ${destacado ? "text-2xl" : "text-lg"}`}
        style={destacado ? { color: valor.startsWith("-") ? "#e66767" : undefined } : undefined}
      >
        {valor}
      </span>
    </div>
  );
}

const tooltipStyle = {
  background: "#131415",
  border: "1px solid #232527",
  borderRadius: 8,
  color: CHART_CHROME.texto,
  fontSize: 13,
};

export function GraficosMes({
  kpis,
  categorias,
  acumuladoEsteMes,
  acumuladoMesAnterior,
  comercios,
  ultimosGastos,
  desde,
  hasta,
}: {
  kpis: Kpis;
  categorias: CategoriaTotal[];
  acumuladoEsteMes: AcumuladoDia[];
  acumuladoMesAnterior: AcumuladoDia[];
  comercios: Comercio[];
  ultimosGastos: Gasto[];
  desde: string;
  hasta: string;
}) {
  const [categoriaAbierta, setCategoriaAbierta] = useState<string | null>(null);
  const [gastosPorCategoria, setGastosPorCategoria] = useState<Record<string, Gasto[]>>({});
  const [cargandoCategoria, setCargandoCategoria] = useState<string | null>(null);

  async function toggleCategoria(id: string | null) {
    if (!id) return;
    if (categoriaAbierta === id) {
      setCategoriaAbierta(null);
      return;
    }
    setCategoriaAbierta(id);
    if (!gastosPorCategoria[id]) {
      setCargandoCategoria(id);
      const params = new URLSearchParams({ categoria_id: id, desde, hasta });
      const res = await fetch(`/api/movimientos?${params.toString()}`);
      const data = await res.json();
      setGastosPorCategoria((prev) => ({ ...prev, [id]: data.movimientos ?? [] }));
      setCargandoCategoria(null);
    }
  }

  const dataAcumulado = Array.from(
    { length: Math.max(acumuladoEsteMes.length, acumuladoMesAnterior.length) },
    (_, i) => ({
      dia: i + 1,
      esteMes: acumuladoEsteMes[i]?.acumulado ?? null,
      mesAnterior: acumuladoMesAnterior[i]?.acumulado ?? null,
    })
  );

  const categoriasConGasto = categorias
    .filter((c) => c.total_ars > 0)
    .sort((a, b) => b.total_ars - a.total_ars);

  const top6 = categoriasConGasto.slice(0, 6);
  const resto = categoriasConGasto.slice(6);
  const restoSuma = resto.reduce((acc, c) => acc + c.total_ars, 0);

  const dataDonut = [
    ...top6.map((c, i) => ({
      id: c.categoria_id,
      nombre: `${c.categoria_emoji} ${c.categoria_nombre}`,
      valor: c.total_ars,
      color: PALETTE_CATEGORICA[i],
    })),
    ...(restoSuma > 0
      ? [{ id: null, nombre: "📦 Otras categorías", valor: restoSuma, color: "#5a5a5a" }]
      : []),
  ];

  const dataComercios = [...comercios].sort((a, b) => b.total_ars - a.total_ars).slice(0, 10);

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto p-4">
      {kpis && (
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Gastado" valor={`$${fmt(kpis.gastado)}`} destacado />
          <StatTile label="Ingresado" valor={`$${fmt(kpis.ingresado)}`} destacado />
          <StatTile
            label="Balance"
            valor={`${kpis.balance < 0 ? "-" : ""}$${fmt(Math.abs(kpis.balance))}`}
          />
          <StatTile label="Promedio diario" valor={`$${fmt(kpis.promedio_diario)}`} />
          <StatTile label="Proyección fin de mes" valor={`$${fmt(kpis.proyeccion_fin_mes)}`} />
        </div>
      )}

      <div className="card p-4">
        <h2 className="text-sm text-muted uppercase tracking-wide mb-3">
          Gasto acumulado — este mes vs mes anterior
        </h2>
        {dataAcumulado.every((d) => !d.esteMes) ? (
          <p className="text-muted text-sm">Todavía no hay gastos este mes.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dataAcumulado}>
              <CartesianGrid stroke={CHART_CHROME.gridline} vertical={false} />
              <XAxis dataKey="dia" stroke={CHART_CHROME.axis} fontSize={12} />
              <YAxis stroke={CHART_CHROME.axis} fontSize={12} width={50} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, color: CHART_CHROME.textoSecundario }} />
              <Line
                type="monotone"
                dataKey="esteMes"
                name="Este mes"
                stroke={PALETTE_CATEGORICA[0]}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="mesAnterior"
                name="Mes anterior"
                stroke={PALETTE_CATEGORICA[1]}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card p-4">
        <h2 className="text-sm text-muted uppercase tracking-wide mb-3">Por categoría</h2>
        {dataDonut.length === 0 ? (
          <p className="text-muted text-sm">Todavía no hay gastos este mes.</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={dataDonut}
                  dataKey="valor"
                  nameKey="nombre"
                  innerRadius={55}
                  outerRadius={90}
                  strokeWidth={2}
                  stroke="#171717"
                >
                  {dataDonut.map((d) => (
                    <Cell key={d.nombre} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value) => `$${fmt(Number(value))}`}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-1 mt-2">
              {dataDonut.map((d) => (
                <div key={d.nombre} className="flex flex-col">
                  <button
                    onClick={() => toggleCategoria(d.id)}
                    disabled={!d.id}
                    className="flex items-center justify-between text-sm py-1 disabled:cursor-default"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block"
                        style={{ background: d.color }}
                      />
                      {d.nombre}
                    </span>
                    <span className="tabular-nums text-muted">${fmt(d.valor)}</span>
                  </button>
                  {categoriaAbierta === d.id && d.id && (
                    <div className="flex flex-col gap-1.5 pl-4.5 pb-2">
                      {cargandoCategoria === d.id ? (
                        <p className="text-muted text-xs">Cargando...</p>
                      ) : (gastosPorCategoria[d.id] ?? []).length === 0 ? (
                        <p className="text-muted text-xs">Sin gastos.</p>
                      ) : (
                        gastosPorCategoria[d.id].map((g) => (
                          <div key={g.id} className="flex items-center justify-between text-xs">
                            <span className="truncate text-muted">
                              {g.descripcion}
                              {g.comercio ? ` · ${g.comercio}` : ""}
                            </span>
                            <span className="tabular-nums shrink-0 ml-2">${fmt(g.monto_ars)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card p-4">
        <h2 className="text-sm text-muted uppercase tracking-wide mb-3">Últimos gastos</h2>
        {ultimosGastos.length === 0 ? (
          <p className="text-muted text-sm">Todavía no hay gastos este mes.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {ultimosGastos.map((g) => (
              <div key={g.id} className="flex items-center justify-between text-sm">
                <span className="truncate">
                  {g.categorias?.emoji ?? "📦"} {g.descripcion}
                </span>
                <span className="tabular-nums text-muted shrink-0 ml-2">${fmt(g.monto_ars)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-4">
        <h2 className="text-sm text-muted uppercase tracking-wide mb-3">Top comercios</h2>
        {dataComercios.length === 0 ? (
          <p className="text-muted text-sm">Todavía no hay comercios registrados este mes.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(120, dataComercios.length * 34)}>
            <BarChart data={dataComercios} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid stroke={CHART_CHROME.gridline} horizontal={false} />
              <XAxis type="number" stroke={CHART_CHROME.axis} fontSize={12} />
              <YAxis
                type="category"
                dataKey="comercio"
                stroke={CHART_CHROME.axis}
                fontSize={12}
                width={100}
              />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => `$${fmt(Number(value))}`} />
              <Bar dataKey="total_ars" fill={PALETTE_CATEGORICA[0]} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
