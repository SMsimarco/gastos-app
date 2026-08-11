"use client";

import { useState } from "react";
import { IconTrash } from "@/components/icons";

type Meta = { id: string; nombre: string; monto_objetivo: number; monto_actual: number };

const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");

export function GestionMetas({ metasIniciales }: { metasIniciales: Meta[] }) {
  const [metas, setMetas] = useState(metasIniciales);
  const [nombre, setNombre] = useState("");
  const [montoObjetivo, setMontoObjetivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aportes, setAportes] = useState<Record<string, string>>({});

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || !montoObjetivo) return;
    setGuardando(true);
    try {
      const res = await fetch("/api/metas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, monto_objetivo: Number(montoObjetivo) }),
      });
      const data = await res.json();
      if (res.ok) {
        setMetas((prev) => [data.meta, ...prev]);
        setNombre("");
        setMontoObjetivo("");
      }
    } finally {
      setGuardando(false);
    }
  }

  async function agregarAporte(id: string) {
    const monto = Number(aportes[id]);
    if (!monto || monto <= 0) return;
    const res = await fetch(`/api/metas/${id}/aporte`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monto }),
    });
    const data = await res.json();
    if (res.ok) {
      setMetas((prev) => prev.map((m) => (m.id === id ? data.meta : m)));
      setAportes((prev) => ({ ...prev, [id]: "" }));
    }
  }

  async function borrar(id: string) {
    setMetas((prev) => prev.filter((m) => m.id !== id));
    await fetch("/api/metas", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-md mx-auto p-5 pb-12">
      <div className="pt-3">
        <h1 className="text-2xl font-semibold tracking-tight">Metas de ahorro</h1>
        <p className="text-muted text-sm mt-1">Ponete un objetivo y anotá lo que vas juntando.</p>
      </div>

      <form onSubmit={crear} className="card p-4 flex flex-col gap-3">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="¿Para qué estás ahorrando?"
          className="bg-surface-2 border border-border-soft rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <input
          type="number"
          value={montoObjetivo}
          onChange={(e) => setMontoObjetivo(e.target.value)}
          placeholder="Monto objetivo ($)"
          className="bg-surface-2 border border-border-soft rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={guardando || !nombre.trim() || !montoObjetivo}
          className="pressable bg-accent text-black font-medium rounded-xl px-4 py-2.5 text-sm disabled:opacity-50 hover:brightness-110 transition-[filter]"
        >
          Crear meta
        </button>
      </form>

      <div className="flex flex-col gap-3">
        {metas.length === 0 && <p className="text-muted text-sm py-2">Todavía no creaste ninguna meta.</p>}
        {metas.map((m) => {
          const pct = Math.min(100, Math.round((m.monto_actual / m.monto_objetivo) * 100));
          const completa = m.monto_actual >= m.monto_objetivo;

          return (
            <div key={m.id} className="card p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{completa ? "🎉" : "🚩"} {m.nombre}</span>
                <button
                  onClick={() => borrar(m.id)}
                  className="text-muted hover:text-danger p-1 transition-colors"
                  aria-label="Borrar meta"
                >
                  <IconTrash size={15} />
                </button>
              </div>
              <div className="flex items-center justify-between text-sm text-muted tabular-nums">
                <span>${fmt(m.monto_actual)}</span>
                <span>${fmt(m.monto_objetivo)}</span>
              </div>
              <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{ width: `${pct}%`, background: completa ? "#34d399" : "#3987e5" }}
                />
              </div>
              {!completa && (
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={aportes[m.id] ?? ""}
                    onChange={(e) => setAportes((prev) => ({ ...prev, [m.id]: e.target.value }))}
                    placeholder="Agregar aporte ($)"
                    className="flex-1 bg-surface-2 border border-border-soft rounded-xl px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => agregarAporte(m.id)}
                    className="pressable bg-surface-2 border border-border-soft rounded-xl px-3 py-2 text-sm hover:border-accent transition-colors"
                  >
                    Sumar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
