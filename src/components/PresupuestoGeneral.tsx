"use client";

import { useState } from "react";

const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");

export function PresupuestoGeneral({ montoInicial }: { montoInicial: number | null }) {
  const [monto, setMonto] = useState(montoInicial);
  const [editando, setEditando] = useState(montoInicial === null);
  const [valor, setValor] = useState(montoInicial ? String(montoInicial) : "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    const num = Number(valor);
    if (!num || num <= 0) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/presupuesto-general", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto: num }),
      });
      const data = await res.json();
      if (res.ok) {
        setMonto(num);
        setEditando(false);
      } else {
        setError(data.error ?? "No pude guardarlo");
      }
    } catch {
      setError("No pude guardarlo, revisá tu conexión");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div>
        <span className="font-medium">💰 Tu presupuesto del mes</span>
        <p className="text-muted text-sm mt-0.5">
          Un solo monto total (tu sueldo, por ejemplo) — se va descontando con cualquier gasto, sin
          importar la categoría. Es lo que ves en el aro de Hoy.
        </p>
      </div>

      {editando ? (
        <div className="flex gap-2">
          <input
            type="number"
            autoFocus
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="Ej: 800000"
            className="flex-1 bg-surface-2 border border-border-soft rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent tabular-nums"
          />
          <button
            onClick={guardar}
            disabled={guardando || !valor}
            className="pressable bg-accent text-black font-medium rounded-xl px-4 py-2.5 text-sm disabled:opacity-50 hover:brightness-110 transition-[filter]"
          >
            Guardar
          </button>
        </div>
      ) : null}
      {error && <p className="text-danger text-sm">{error}</p>}
      {!editando && monto !== null && (
        <div className="flex items-center justify-between">
          <span className="text-2xl font-semibold tabular-nums">${fmt(monto!)}</span>
          <button
            onClick={() => {
              setValor(String(monto));
              setEditando(true);
            }}
            className="text-muted hover:text-foreground text-sm transition-colors"
          >
            Editar
          </button>
        </div>
      )}
    </div>
  );
}
