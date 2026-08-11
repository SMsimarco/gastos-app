"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  ComposedChart,
  Line,
} from "recharts";
import { PALETTE_CATEGORICA, CHART_CHROME } from "@/lib/palette";

type ResumenMes = {
  mes: number;
  gastado_ars: number;
  gastado_usd: number;
  ingresado_ars: number;
  ingresado_usd: number;
};

type CategoriaMes = { mes: number; categoria_nombre: string; categoria_emoji: string; total_ars: number };

type Dia = { fecha: string; total_dia: number; acumulado: number };

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");

const tooltipStyle = {
  background: "#131415",
  border: "1px solid #232527",
  borderRadius: 8,
  color: CHART_CHROME.texto,
  fontSize: 13,
};

function Heatmap({ diario }: { diario: Dia[] }) {
  if (diario.length === 0) return <p className="text-muted text-sm">Sin datos todavía.</p>;

  const primerDia = new Date(`${diario[0].fecha}T00:00:00Z`);
  const diaSemanaPrimero = (primerDia.getUTCDay() + 6) % 7; // 0=lunes

  const max = Math.max(...diario.map((d) => d.total_dia), 1);
  const bucket = (v: number) => {
    if (v <= 0) return 0;
    const r = v / max;
    if (r < 0.25) return 1;
    if (r < 0.5) return 2;
    if (r < 0.75) return 3;
    return 4;
  };
  const colores = ["#262626", "#1c5cab33", "#1c5cab88", "#2a78d6", "#3987e5"];

  const celdas = [
    ...Array.from({ length: diaSemanaPrimero }, () => null),
    ...diario,
  ];

  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-[3px]"
        style={{
          gridTemplateRows: "repeat(7, 11px)",
          gridAutoFlow: "column",
          gridAutoColumns: "11px",
        }}
      >
        {celdas.map((d, i) =>
          d === null ? (
            <div key={`vacio-${i}`} />
          ) : (
            <div
              key={d.fecha}
              title={`${d.fecha}: $${fmt(d.total_dia)}`}
              className="rounded-[2px]"
              style={{ background: colores[bucket(d.total_dia)] }}
            />
          )
        )}
      </div>
      <div className="flex items-center gap-2 mt-2 text-xs text-muted">
        <span>Menos</span>
        {colores.map((c, i) => (
          <span key={i} className="w-2.5 h-2.5 rounded-[2px] inline-block" style={{ background: c }} />
        ))}
        <span>Más</span>
      </div>
    </div>
  );
}

export function GraficoAnio({
  anio,
  resumen,
  categoriaMensual,
  diario,
}: {
  anio: number;
  resumen: ResumenMes[];
  categoriaMensual: CategoriaMes[];
  diario: Dia[];
}) {
  const [moneda, setMoneda] = useState<"ARS" | "USD">("ARS");

  const dataBarrasMes = resumen.map((r) => ({
    mes: MESES[r.mes - 1],
    total: moneda === "ARS" ? r.gastado_ars : r.gastado_usd,
  }));

  const dataIngresosGastos = useMemo(() => {
    let acumulado = 0;
    return resumen.map((r) => {
      acumulado += r.ingresado_ars - r.gastado_ars;
      return {
        mes: MESES[r.mes - 1],
        gastado: r.gastado_ars,
        ingresado: r.ingresado_ars,
        balanceAcumulado: acumulado,
      };
    });
  }, [resumen]);

  const { dataArea, categoriasArea } = useMemo(() => {
    const totalesPorCategoria = new Map<string, number>();
    for (const c of categoriaMensual) {
      totalesPorCategoria.set(
        c.categoria_nombre,
        (totalesPorCategoria.get(c.categoria_nombre) ?? 0) + c.total_ars
      );
    }
    const ordenadas = [...totalesPorCategoria.entries()].sort((a, b) => b[1] - a[1]);
    const top5 = ordenadas.slice(0, 5).map(([nombre]) => nombre);
    const resto = new Set(ordenadas.slice(5).map(([nombre]) => nombre));

    const porMes: Record<number, Record<string, number>> = {};
    for (let m = 1; m <= 12; m++) porMes[m] = {};

    for (const c of categoriaMensual) {
      const clave = resto.has(c.categoria_nombre) ? "Otras" : c.categoria_nombre;
      porMes[c.mes][clave] = (porMes[c.mes][clave] ?? 0) + c.total_ars;
    }

    const categorias = [...top5, ...(resto.size > 0 ? ["Otras"] : [])];
    const data = Array.from({ length: 12 }, (_, i) => ({
      mes: MESES[i],
      ...categorias.reduce((acc, cat) => ({ ...acc, [cat]: porMes[i + 1][cat] ?? 0 }), {}),
    }));

    return { dataArea: data, categoriasArea: categorias };
  }, [categoriaMensual]);

  const hayDatos = resumen.some((r) => r.gastado_ars > 0 || r.ingresado_ars > 0);

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto p-4 pb-10">
      <h1 className="text-2xl font-semibold pt-2">{anio}</h1>

      {!hayDatos ? (
        <p className="text-muted text-sm">Todavía no hay movimientos este año.</p>
      ) : (
        <>
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm text-muted uppercase tracking-wide">Gasto por mes</h2>
              <div className="flex gap-1 bg-surface-2 rounded-lg p-1">
                {(["ARS", "USD"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMoneda(m)}
                    className={`pressable px-3 py-1 text-xs rounded-md transition-colors ${
                      moneda === m ? "bg-accent text-black font-medium" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dataBarrasMes}>
                <CartesianGrid stroke={CHART_CHROME.gridline} vertical={false} />
                <XAxis dataKey="mes" stroke={CHART_CHROME.axis} fontSize={12} />
                <YAxis stroke={CHART_CHROME.axis} fontSize={12} width={50} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => `${moneda === "ARS" ? "$" : "US$"}${fmt(Number(v))}`}
                />
                <Bar dataKey="total" fill={PALETTE_CATEGORICA[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card p-4">
            <h2 className="text-sm text-muted uppercase tracking-wide mb-3">
              Ingresos vs gastos — balance acumulado
            </h2>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={dataIngresosGastos}>
                <CartesianGrid stroke={CHART_CHROME.gridline} vertical={false} />
                <XAxis dataKey="mes" stroke={CHART_CHROME.axis} fontSize={12} />
                <YAxis stroke={CHART_CHROME.axis} fontSize={12} width={50} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => `$${fmt(Number(v))}`} />
                <Legend wrapperStyle={{ fontSize: 12, color: CHART_CHROME.textoSecundario }} />
                <Bar dataKey="ingresado" name="Ingresado" fill={PALETTE_CATEGORICA[5]} radius={[3, 3, 0, 0]} />
                <Bar dataKey="gastado" name="Gastado" fill={PALETTE_CATEGORICA[7]} radius={[3, 3, 0, 0]} />
                <Line
                  type="monotone"
                  dataKey="balanceAcumulado"
                  name="Balance acumulado"
                  stroke={PALETTE_CATEGORICA[0]}
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="card p-4">
            <h2 className="text-sm text-muted uppercase tracking-wide mb-3">Gasto por categoría en el año</h2>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dataArea}>
                <CartesianGrid stroke={CHART_CHROME.gridline} vertical={false} />
                <XAxis dataKey="mes" stroke={CHART_CHROME.axis} fontSize={12} />
                <YAxis stroke={CHART_CHROME.axis} fontSize={12} width={50} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => `$${fmt(Number(v))}`} />
                <Legend wrapperStyle={{ fontSize: 11, color: CHART_CHROME.textoSecundario }} />
                {categoriasArea.map((cat, i) => (
                  <Area
                    key={cat}
                    type="monotone"
                    dataKey={cat}
                    stackId="1"
                    stroke={cat === "Otras" ? "#5a5a5a" : PALETTE_CATEGORICA[i]}
                    fill={cat === "Otras" ? "#5a5a5a" : PALETTE_CATEGORICA[i]}
                    fillOpacity={0.5}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <div className="card p-4">
        <h2 className="text-sm text-muted uppercase tracking-wide mb-3">Actividad diaria</h2>
        <Heatmap diario={diario} />
      </div>
    </div>
  );
}
