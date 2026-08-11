"use client";

import { useState } from "react";
import { IconTrash } from "@/components/icons";

type Categoria = { id: string; nombre: string; emoji: string };
export type Presupuesto = {
  id: string;
  categoria_id: string;
  monto_mensual: number;
  categorias: { nombre: string; emoji: string } | null;
};
type GastoCategoria = { categoria_id: string; total_ars: number };

const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");

export function GestionPresupuestos({
  categorias,
  presupuestosIniciales,
  gastadoPorCategoria,
  mes,
}: {
  categorias: Categoria[];
  presupuestosIniciales: Presupuesto[];
  gastadoPorCategoria: GastoCategoria[];
  mes: string;
}) {
  const [presupuestos, setPresupuestos] = useState(presupuestosIniciales);
  const [categoriaId, setCategoriaId] = useState("");
  const [monto, setMonto] = useState("");
  const [guardando, setGuardando] = useState(false);

  const gastoPorCategoria = new Map(gastadoPorCategoria.map((g) => [g.categoria_id, g.total_ars]));
  const categoriasDisponibles = categorias.filter(
    (c) => !presupuestos.some((p) => p.categoria_id === c.id)
  );

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!categoriaId || !monto) return;
    setGuardando(true);
    try {
      const res = await fetch("/api/presupuestos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoria_id: categoriaId, monto_mensual: Number(monto), mes }),
      });
      const data = await res.json();
      if (res.ok) {
        const cat = categorias.find((c) => c.id === categoriaId);
        setPresupuestos((prev) => [
          ...prev,
          { ...data.presupuesto, categorias: cat ? { nombre: cat.nombre, emoji: cat.emoji } : null },
        ]);
        setCategoriaId("");
        setMonto("");
      }
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(id: string) {
    setPresupuestos((prev) => prev.filter((p) => p.id !== id));
    await fetch("/api/presupuestos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-md mx-auto p-5 pb-12">
      <div className="pt-3">
        <h1 className="text-2xl font-semibold tracking-tight">Presupuestos</h1>
        <p className="text-muted text-sm mt-1">Te avisamos cuando te pasás de lo planeado este mes.</p>
      </div>

      <form onSubmit={agregar} className="card p-4 flex flex-col gap-3">
        <select
          value={categoriaId}
          onChange={(e) => setCategoriaId(e.target.value)}
          className="bg-surface-2 border border-border-soft rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent"
        >
          <option value="">Elegí una categoría...</option>
          {categoriasDisponibles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.nombre}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          placeholder="Monto mensual ($)"
          className="bg-surface-2 border border-border-soft rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={guardando || !categoriaId || !monto}
          className="pressable bg-accent text-black font-medium rounded-xl px-4 py-2.5 text-sm disabled:opacity-50 hover:brightness-110 transition-[filter]"
        >
          Agregar presupuesto
        </button>
      </form>

      <div className="flex flex-col gap-2">
        {presupuestos.length === 0 && (
          <p className="text-muted text-sm py-2">Todavía no configuraste ningún presupuesto.</p>
        )}
        {presupuestos.map((p) => {
          const gastado = gastoPorCategoria.get(p.categoria_id) ?? 0;
          const pct = Math.min(100, Math.round((gastado / p.monto_mensual) * 100));
          const excedido = gastado > p.monto_mensual;

          return (
            <div key={p.id} className="card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {p.categorias?.emoji ?? "📦"} {p.categorias?.nombre}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm tabular-nums text-muted">
                    ${fmt(gastado)} / ${fmt(p.monto_mensual)}
                  </span>
                  <button
                    onClick={() => borrar(p.id)}
                    className="text-muted hover:text-danger p-1 transition-colors"
                    aria-label="Borrar presupuesto"
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
              </div>
              <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{
                    width: `${pct}%`,
                    background: excedido ? "#f87171" : "#34d399",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
