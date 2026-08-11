"use client";

import { useCallback, useEffect, useState } from "react";
import { IconEdit, IconTrash } from "@/components/icons";

type Categoria = { id: string; nombre: string; emoji: string; tipo: string };

type MovimientoFila = {
  id: string;
  tipo: string;
  fecha: string;
  monto_ars: number;
  monto_usd: number | null;
  comercio: string | null;
  descripcion: string;
  metodo_pago: string | null;
  fuente: string;
  categoria_id: string | null;
  cuotas_total: number;
  cuota_nro: number;
  categorias: { nombre: string; emoji: string } | null;
};

const METODOS_PAGO = ["efectivo", "debito", "credito", "transferencia", "mercadopago"];
const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");

function aCSV(filas: MovimientoFila[]) {
  const header = ["fecha", "tipo", "categoria", "descripcion", "comercio", "metodo_pago", "monto_ars", "monto_usd", "fuente"];
  const lineas = filas.map((f) =>
    [
      f.fecha,
      f.tipo,
      f.categorias?.nombre ?? "",
      `"${(f.descripcion ?? "").replace(/"/g, '""')}"`,
      f.comercio ?? "",
      f.metodo_pago ?? "",
      f.monto_ars,
      f.monto_usd ?? "",
      f.fuente,
    ].join(",")
  );
  return [header.join(","), ...lineas].join("\n");
}

export function TablaTodos({ categorias }: { categorias: Categoria[] }) {
  const [movimientos, setMovimientos] = useState<MovimientoFila[]>([]);
  const [cargando, setCargando] = useState(true);

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [metodoPago, setMetodoPago] = useState("");
  const [comercio, setComercio] = useState("");
  const [montoMin, setMontoMin] = useState("");
  const [montoMax, setMontoMax] = useState("");

  const buscar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    if (categoriaId) params.set("categoria_id", categoriaId);
    if (metodoPago) params.set("metodo_pago", metodoPago);
    if (comercio) params.set("comercio", comercio);
    if (montoMin) params.set("monto_min", montoMin);
    if (montoMax) params.set("monto_max", montoMax);

    try {
      const res = await fetch(`/api/movimientos?${params.toString()}`);
      const data = await res.json();
      setMovimientos(data.movimientos ?? []);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, categoriaId, metodoPago, comercio, montoMin, montoMax]);

  useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function limpiarFiltros() {
    setDesde("");
    setHasta("");
    setCategoriaId("");
    setMetodoPago("");
    setComercio("");
    setMontoMin("");
    setMontoMax("");
  }

  async function borrar(id: string) {
    setMovimientos((prev) => prev.filter((m) => m.id !== id));
    await fetch(`/api/movimientos/${id}`, { method: "DELETE" });
  }

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editMonto, setEditMonto] = useState("");
  const [editCategoriaId, setEditCategoriaId] = useState("");
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  function empezarEdicion(m: MovimientoFila) {
    setEditandoId(m.id);
    setEditMonto(String(m.monto_ars));
    setEditCategoriaId(m.categoria_id ?? "");
  }

  async function guardarEdicion(id: string) {
    setGuardandoEdicion(true);
    try {
      const res = await fetch(`/api/movimientos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto_ars: Number(editMonto), categoria_id: editCategoriaId || null }),
      });
      const data = await res.json();
      if (res.ok) {
        setMovimientos((prev) =>
          prev.map((m) => (m.id === id ? { ...m, ...data.movimiento } : m))
        );
        setEditandoId(null);
      }
    } finally {
      setGuardandoEdicion(false);
    }
  }

  function exportarCSV() {
    const csv = aCSV(movimientos);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gastos-voz-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const inputCls =
    "card px-3 py-2 text-sm outline-none focus:border-accent transition-colors";

  const total = movimientos
    .filter((m) => m.tipo === "gasto")
    .reduce((acc, m) => acc + m.monto_ars, 0);

  return (
    <div className="flex flex-col gap-4 w-full max-w-2xl mx-auto p-4 pb-10">
      <h1 className="text-2xl font-semibold pt-2">Todos los movimientos</h1>

      <div className="card p-4 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} />
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className={inputCls}>
            <option value="">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.nombre}
              </option>
            ))}
          </select>
          <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)} className={inputCls}>
            <option value="">Todos los métodos</option>
            {METODOS_PAGO.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <input
          value={comercio}
          onChange={(e) => setComercio(e.target.value)}
          placeholder="Buscar comercio..."
          className={inputCls}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            value={montoMin}
            onChange={(e) => setMontoMin(e.target.value)}
            placeholder="Monto mín."
            className={inputCls}
          />
          <input
            type="number"
            value={montoMax}
            onChange={(e) => setMontoMax(e.target.value)}
            placeholder="Monto máx."
            className={inputCls}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={buscar}
            className="flex-1 bg-accent text-black font-medium pressable rounded-xl px-4 py-2.5 text-sm hover:brightness-110 transition-[filter]"
          >
            Buscar
          </button>
          <button
            onClick={limpiarFiltros}
            className="pressable bg-surface-2 border border-border-soft rounded-xl px-4 py-2.5 text-sm text-muted hover:text-foreground transition-colors"
          >
            Limpiar
          </button>
          <button
            onClick={exportarCSV}
            disabled={movimientos.length === 0}
            className="pressable bg-surface-2 border border-border-soft rounded-xl px-4 py-2.5 text-sm disabled:opacity-40 hover:border-accent transition-colors"
          >
            CSV
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-muted px-1">
        <span>{movimientos.length} movimientos</span>
        <span className="tabular-nums">Total gastos: ${fmt(total)}</span>
      </div>

      <div className="flex flex-col gap-2">
        {cargando ? (
          <p className="text-muted text-sm">Cargando...</p>
        ) : movimientos.length === 0 ? (
          <p className="text-muted text-sm">No hay movimientos con esos filtros.</p>
        ) : (
          movimientos.map((m) =>
            editandoId === m.id ? (
              <div key={m.id} className="card border-accent px-4 py-3 flex flex-col gap-2">
                <p className="text-sm text-muted truncate">{m.descripcion}</p>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    value={editMonto}
                    onChange={(e) => setEditMonto(e.target.value)}
                    className={inputCls}
                  />
                  <select
                    value={editCategoriaId}
                    onChange={(e) => setEditCategoriaId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Sin categoría</option>
                    {categorias
                      .filter((c) => c.tipo === m.tipo)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.emoji} {c.nombre}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => guardarEdicion(m.id)}
                    disabled={guardandoEdicion}
                    className="flex-1 bg-accent text-black font-medium pressable rounded-xl px-3 py-2 text-sm disabled:opacity-50"
                  >
                    {guardandoEdicion ? "Guardando..." : "Guardar"}
                  </button>
                  <button
                    onClick={() => setEditandoId(null)}
                    className="pressable bg-surface-2 border border-border-soft rounded-xl px-3 py-2 text-sm text-muted"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={m.id}
                className="flex items-center justify-between card px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {m.categorias?.emoji ?? "📦"} {m.descripcion}
                  </p>
                  <p className="text-muted text-sm">
                    {m.fecha}
                    {m.comercio ? ` · ${m.comercio}` : ""}
                    {m.metodo_pago ? ` · ${m.metodo_pago}` : ""}
                    {m.cuotas_total > 1 ? ` · cuota ${m.cuota_nro}/${m.cuotas_total}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className="text-lg font-semibold tabular-nums"
                    style={{ color: m.tipo === "gasto" ? "#f87171" : "#34d399" }}
                  >
                    {m.tipo === "gasto" ? "-" : "+"}${fmt(m.monto_ars)}
                  </span>
                  <button
                    onClick={() => empezarEdicion(m)}
                    className="text-muted hover:text-foreground p-1 transition-colors"
                    aria-label="Editar"
                  >
                    <IconEdit size={16} />
                  </button>
                  <button
                    onClick={() => borrar(m.id)}
                    className="text-muted hover:text-danger p-1 transition-colors"
                    aria-label="Borrar"
                  >
                    <IconTrash size={16} />
                  </button>
                </div>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}
