"use client";

import { useState } from "react";
import { IconCheck } from "@/components/icons";

type Bolsillo = {
  id: string;
  clave: "gastos" | "emergencia" | "depto" | "aprender";
  nombre: string;
  moneda: "ARS" | "USD";
  saldo: number;
  meta: number | null;
  orden: number;
};

type ConfigPlan = {
  meses_emergencia: number;
  meses_cobertura_gastos: number;
  pct_depto: number;
  gasto_mensual_manual: number | null;
  umbral_compra_usd: number;
} | null;

type DetalleReparto = {
  gastos: number;
  emergencia: number;
  depto: number;
  aprender: number;
  metaEmergenciaUsd: number;
  sugerirCompraVOO: boolean;
  explicacion: string[];
};

type RepartoPendiente = {
  id: string;
  monto_ars: number;
  tc_referencia: number;
  detalle: DetalleReparto;
} | null;

const fmtArs = (n: number) => Math.round(n).toLocaleString("es-AR");
const fmtUsd = (n: number) => n.toFixed(2);

export function GestionPlan({
  bolsillosIniciales,
  configInicial,
  gastoMensualArsInicial,
  mepReferenciaInicial,
  repartoPendienteInicial,
}: {
  bolsillosIniciales: Bolsillo[];
  configInicial: ConfigPlan;
  gastoMensualArsInicial: number | null;
  mepReferenciaInicial: number | null;
  repartoPendienteInicial: RepartoPendiente;
}) {
  const [bolsillos, setBolsillos] = useState(bolsillosIniciales);
  const [reparto, setReparto] = useState(repartoPendienteInicial);
  const [config, setConfig] = useState(configInicial);
  const [gastoMensualArs] = useState(gastoMensualArsInicial);
  const [mepReferencia] = useState(mepReferenciaInicial);
  const [procesandoReparto, setProcesandoReparto] = useState(false);
  const [tcUsado, setTcUsado] = useState(reparto ? String(reparto.tc_referencia) : "");
  const [ajustando, setAjustando] = useState<string | null>(null);
  const [valorAjuste, setValorAjuste] = useState<Record<string, string>>({});
  const [guardandoConfig, setGuardandoConfig] = useState(false);

  async function aplicarReparto() {
    if (!reparto) return;
    setProcesandoReparto(true);
    try {
      const res = await fetch(`/api/plan/repartos/${reparto.id}/aplicar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tc_usado: tcUsado ? Number(tcUsado) : undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        setBolsillos(data.bolsillos);
        setReparto(null);
      }
    } finally {
      setProcesandoReparto(false);
    }
  }

  async function descartarReparto() {
    if (!reparto) return;
    setProcesandoReparto(true);
    try {
      const res = await fetch(`/api/plan/repartos/${reparto.id}/descartar`, { method: "POST" });
      if (res.ok) setReparto(null);
    } finally {
      setProcesandoReparto(false);
    }
  }

  async function guardarAjuste(clave: string) {
    const saldoReal = Number(valorAjuste[clave]);
    if (Number.isNaN(saldoReal)) return;
    const res = await fetch(`/api/plan/bolsillos/${clave}/ajuste`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saldo_real: saldoReal }),
    });
    const data = await res.json();
    if (res.ok && data.bolsillo) {
      setBolsillos((prev) => prev.map((b) => (b.clave === clave ? data.bolsillo : b)));
    }
    setAjustando(null);
  }

  async function guardarConfig(cambios: Partial<NonNullable<ConfigPlan>>) {
    setGuardandoConfig(true);
    try {
      const res = await fetch("/api/plan/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      });
      const data = await res.json();
      if (res.ok) setConfig(data.config);
    } finally {
      setGuardandoConfig(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-md mx-auto p-5 pb-12">
      <div className="pt-3">
        <h1 className="text-2xl font-semibold tracking-tight">Plan de ahorro</h1>
        <p className="text-muted text-sm mt-1">Cada cobro se reparte solo entre tus bolsillos.</p>
      </div>

      {reparto && (
        <div className="card p-4 flex flex-col gap-3 border-accent/40">
          <div className="flex items-center justify-between">
            <span className="font-medium">💰 Cobraste ${fmtArs(reparto.monto_ars)}</span>
            <span className="text-xs text-muted">MEP ${reparto.tc_referencia}</span>
          </div>
          <ul className="text-sm text-muted flex flex-col gap-1">
            {reparto.detalle.explicacion.map((linea, i) => (
              <li key={i}>{linea}</li>
            ))}
          </ul>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Cotización usada en ARQ (para el registro)</label>
            <input
              type="number"
              value={tcUsado}
              onChange={(e) => setTcUsado(e.target.value)}
              className="bg-surface-2 border border-border-soft rounded-xl px-3 py-2 text-sm outline-none focus:border-accent tabular-nums"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={aplicarReparto}
              disabled={procesandoReparto}
              className="pressable flex-1 bg-accent text-black font-medium rounded-xl px-4 py-2.5 text-sm disabled:opacity-50 hover:brightness-110 transition-[filter]"
            >
              Ya lo hice en ARQ
            </button>
            <button
              onClick={descartarReparto}
              disabled={procesandoReparto}
              className="pressable bg-surface-2 border border-border-soft rounded-xl px-4 py-2.5 text-sm hover:border-danger hover:text-danger transition-colors"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      <div className="text-sm text-muted flex flex-col gap-0.5">
        <span>
          Gasto mensual real: {gastoMensualArs !== null ? `$${fmtArs(gastoMensualArs)} (promedio de los últimos 3 meses)` : "sin datos suficientes todavía"}
        </span>
        {config && gastoMensualArs !== null && mepReferencia && (
          <span>
            Meta de emergencia: US${fmtUsd((config.meses_emergencia * gastoMensualArs) / mepReferencia)} (MEP ${mepReferencia})
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {bolsillos.map((b) => {
          const pct = b.meta ? Math.min(100, Math.round((b.saldo / b.meta) * 100)) : null;
          const simbolo = b.moneda === "USD" ? "US$" : "$";
          const fmt = b.moneda === "USD" ? fmtUsd : fmtArs;

          return (
            <div key={b.id} className="card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{b.nombre}</span>
                <span className="text-sm tabular-nums">
                  {simbolo}{fmt(b.saldo)}
                  {b.meta ? ` / ${simbolo}${fmt(b.meta)}` : ""}
                </span>
              </div>
              {pct !== null && (
                <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{ width: `${pct}%`, background: "#3987e5" }}
                  />
                </div>
              )}
              {ajustando === b.clave ? (
                <div className="flex gap-2 mt-1">
                  <input
                    type="number"
                    autoFocus
                    value={valorAjuste[b.clave] ?? ""}
                    onChange={(e) => setValorAjuste((prev) => ({ ...prev, [b.clave]: e.target.value }))}
                    placeholder={`Saldo real en ARQ (${simbolo})`}
                    className="flex-1 bg-surface-2 border border-border-soft rounded-xl px-3 py-2 text-sm outline-none focus:border-accent tabular-nums"
                  />
                  <button
                    onClick={() => guardarAjuste(b.clave)}
                    className="pressable bg-accent text-black rounded-xl px-3 py-2 text-sm hover:brightness-110 transition-[filter]"
                    aria-label="Confirmar ajuste"
                  >
                    <IconCheck size={16} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setAjustando(b.clave);
                    setValorAjuste((prev) => ({ ...prev, [b.clave]: String(b.saldo) }));
                  }}
                  className="text-xs text-muted hover:text-foreground self-start transition-colors"
                >
                  Ajustar saldo
                </button>
              )}
            </div>
          );
        })}
      </div>

      {config && (
        <div className="card p-4 flex flex-col gap-3">
          <span className="font-medium text-sm">Configuración</span>
          <label className="flex flex-col gap-1 text-sm">
            Meses de emergencia
            <input
              type="number"
              defaultValue={config.meses_emergencia}
              onBlur={(e) => guardarConfig({ meses_emergencia: Number(e.target.value) })}
              className="bg-surface-2 border border-border-soft rounded-xl px-3 py-2 text-sm outline-none focus:border-accent tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            % a depto (el resto va a aprender)
            <input
              type="number"
              defaultValue={config.pct_depto}
              onBlur={(e) => guardarConfig({ pct_depto: Number(e.target.value) })}
              className="bg-surface-2 border border-border-soft rounded-xl px-3 py-2 text-sm outline-none focus:border-accent tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Gasto mensual manual ($, opcional — pisa el cálculo automático)
            <input
              type="number"
              defaultValue={config.gasto_mensual_manual ?? ""}
              onBlur={(e) => guardarConfig({ gasto_mensual_manual: e.target.value ? Number(e.target.value) : null })}
              className="bg-surface-2 border border-border-soft rounded-xl px-3 py-2 text-sm outline-none focus:border-accent tabular-nums"
            />
          </label>
          {guardandoConfig && <span className="text-xs text-muted">Guardando…</span>}
        </div>
      )}
    </div>
  );
}
