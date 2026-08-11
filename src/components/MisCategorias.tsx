"use client";

import { useState } from "react";
import { IconTrash } from "@/components/icons";

type CategoriaPropia = { id: string; nombre: string; emoji: string; tipo: string };

export function MisCategorias({ categoriasPropias }: { categoriasPropias: CategoriaPropia[] }) {
  const [categorias, setCategorias] = useState(categoriasPropias);
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<"gasto" | "ingreso">("gasto");
  const [emoji, setEmoji] = useState("🏷️");
  const [guardando, setGuardando] = useState(false);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setGuardando(true);
    try {
      const res = await fetch("/api/categorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, tipo, emoji }),
      });
      const data = await res.json();
      if (res.ok) {
        setCategorias((prev) => [...prev, data.categoria]);
        setNombre("");
      }
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(id: string) {
    setCategorias((prev) => prev.filter((c) => c.id !== id));
    await fetch("/api/categorias", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-md mx-auto p-5 pt-0">
      <div className="card p-4 flex flex-col gap-3">
        <h2 className="text-sm font-medium">Mis categorías</h2>
        <p className="text-muted text-xs -mt-2">
          Además de las categorías fijas, podés crear las tuyas — la app las va a reconocer al capturar.
        </p>

        <form onSubmit={agregar} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              maxLength={2}
              className="w-14 bg-surface-2 border border-border-soft rounded-xl px-3 py-2.5 text-center text-lg outline-none focus:border-accent"
            />
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre de la categoría"
              className="flex-1 bg-surface-2 border border-border-soft rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as "gasto" | "ingreso")}
              className="flex-1 bg-surface-2 border border-border-soft rounded-xl px-3 py-2.5 text-sm outline-none focus:border-accent"
            >
              <option value="gasto">Gasto</option>
              <option value="ingreso">Ingreso</option>
            </select>
            <button
              type="submit"
              disabled={guardando || !nombre.trim()}
              className="pressable bg-accent text-black font-medium rounded-xl px-4 py-2.5 text-sm disabled:opacity-50 hover:brightness-110 transition-[filter]"
            >
              Agregar
            </button>
          </div>
        </form>

        {categorias.length > 0 && (
          <div className="flex flex-col gap-1 mt-1">
            {categorias.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm py-1">
                <span>
                  {c.emoji} {c.nombre} <span className="text-muted">({c.tipo})</span>
                </span>
                <button
                  onClick={() => borrar(c.id)}
                  className="text-muted hover:text-danger p-1 transition-colors"
                  aria-label="Borrar categoría"
                >
                  <IconTrash size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
