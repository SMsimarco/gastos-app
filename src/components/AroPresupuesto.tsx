"use client";

import Link from "next/link";

const fmt = (n: number) => Math.round(Math.abs(n)).toLocaleString("es-AR");

// Aro de presupuesto mensual: arranca lleno y se va vaciando a medida que
// gastás. Tocarlo lleva a /presupuestos (ahí se ve el detalle por categoría
// y se configura). Sin presupuesto todavía, invita a crear uno.
export function AroPresupuesto({
  gastadoMes,
  presupuestoTotal,
}: {
  gastadoMes: number;
  presupuestoTotal: number | null;
}) {
  const R = 64;
  const C = 2 * Math.PI * R;

  const tienePresupuesto = presupuestoTotal !== null && presupuestoTotal > 0;
  const pctGastado = tienePresupuesto ? gastadoMes / presupuestoTotal : 0;
  const restanteFrac = Math.max(0, 1 - pctGastado);
  const excedido = tienePresupuesto && gastadoMes > presupuestoTotal!;
  const color = excedido || pctGastado > 0.9 ? "var(--danger)" : "var(--accent)";

  return (
    <Link
      href="/presupuestos"
      className="pressable relative flex items-center justify-center w-40 h-40 mx-auto shrink-0"
      aria-label="Ver presupuestos"
    >
      <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
        <circle cx="80" cy="80" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="12" />
        {tienePresupuesto && (
          <circle
            cx="80"
            cy="80"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - restanteFrac)}
            style={{ transition: "stroke-dashoffset 0.4s ease, stroke 0.4s ease" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
        {tienePresupuesto ? (
          <>
            <span className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: excedido ? "var(--danger)" : undefined }}>
              {excedido ? "-" : ""}${fmt(presupuestoTotal! - gastadoMes)}
            </span>
            <span className="text-muted text-xs mt-0.5">
              {excedido ? "te pasaste de" : "de"} ${fmt(presupuestoTotal!)}
            </span>
          </>
        ) : (
          <>
            <span className="text-3xl">🎯</span>
            <span className="text-muted text-xs mt-1 leading-tight">Configurá tu<br />presupuesto</span>
          </>
        )}
      </div>
    </Link>
  );
}
