"use client";

import { useRef, useState } from "react";

type MovimientoFila = {
  id: string;
  tipo: string;
  monto_ars: number;
  descripcion: string;
  fecha: string;
  categoriaEmoji?: string;
  categoriaNombre?: string;
};

const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");

export function CapturaMovimientos({
  movimientosIniciales,
  totalHoy,
  promedioDiario,
}: {
  movimientosIniciales: MovimientoFila[];
  totalHoy: number;
  promedioDiario: number | null;
}) {
  const [movimientos, setMovimientos] = useState(movimientosIniciales);
  const [grabando, setGrabando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [texto, setTexto] = useState("");
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: "ok" | "warn" } | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const totalHoyActual = movimientos
    .filter((m) => m.tipo === "gasto")
    .reduce((acc, m) => acc + m.monto_ars, 0);

  async function enviarCaptura(formData: FormData) {
    setProcesando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/capturar", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setMensaje({ texto: `⚠️ ${data.error ?? "Error desconocido"}`, tipo: "warn" });
        return;
      }

      const nuevos: MovimientoFila[] = [];
      let huboBaja = false;
      for (const r of data.resultados) {
        if (r.confianza === "baja" && !r.guardado) {
          huboBaja = true;
        } else {
          nuevos.push(r);
        }
      }

      if (nuevos.length > 0) {
        setMovimientos((prev) => [...nuevos, ...prev]);
      }
      if (huboBaja) {
        setMensaje({
          texto: "🤔 No entendí bien el monto, no se registró. Probá de nuevo siendo más específico.",
          tipo: "warn",
        });
      } else if (nuevos.length > 0) {
        setMensaje({ texto: `✅ Registrado${nuevos.length > 1 ? ` (${nuevos.length})` : ""}`, tipo: "ok" });
      } else {
        setMensaje({ texto: "No encontré ningún movimiento en eso.", tipo: "warn" });
      }
    } catch {
      setMensaje({ texto: "⚠️ Error de conexión", tipo: "warn" });
    } finally {
      setProcesando(false);
    }
  }

  async function iniciarGrabacion() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    chunksRef.current = [];

    mediaRecorder.ondataavailable = (e) => chunksRef.current.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const formData = new FormData();
      formData.append("audio", blob, "audio.webm");
      await enviarCaptura(formData);
    };

    mediaRecorder.start();
    mediaRecorderRef.current = mediaRecorder;
    setGrabando(true);
  }

  function detenerGrabacion() {
    mediaRecorderRef.current?.stop();
    setGrabando(false);
  }

  async function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("foto", file);
    await enviarCaptura(formData);
    e.target.value = "";
  }

  async function handleTexto(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    const formData = new FormData();
    formData.append("texto", texto);
    setTexto("");
    await enviarCaptura(formData);
  }

  async function borrarMovimiento(id: string) {
    setMovimientos((prev) => prev.filter((m) => m.id !== id));
    await fetch(`/api/movimientos/${id}`, { method: "DELETE" });
  }

  const diferenciaPromedio =
    promedioDiario !== null && promedioDiario > 0
      ? Math.round(((totalHoyActual - promedioDiario) / promedioDiario) * 100)
      : null;

  return (
    <div className="flex flex-col gap-6 w-full max-w-md mx-auto p-4 pb-10">
      <div className="flex flex-col gap-1 pt-2">
        <span className="text-muted text-xs uppercase tracking-wide">Gastado hoy</span>
        <span className="text-4xl font-semibold tabular-nums">${fmt(totalHoyActual)}</span>
        {diferenciaPromedio !== null && (
          <span className="text-sm text-muted">
            {diferenciaPromedio > 0 ? "↑" : diferenciaPromedio < 0 ? "↓" : "="}{" "}
            {Math.abs(diferenciaPromedio)}% vs. tu promedio diario del mes (${fmt(promedioDiario!)})
          </span>
        )}
      </div>

      <div className="flex flex-col items-center gap-3 py-4">
        <button
          onClick={grabando ? detenerGrabacion : iniciarGrabacion}
          disabled={procesando}
          aria-label={grabando ? "Parar grabación" : "Grabar audio"}
          className={`relative w-24 h-24 rounded-full flex items-center justify-center text-4xl transition-colors disabled:opacity-50 ${
            grabando ? "bg-danger" : "bg-accent"
          }`}
        >
          {grabando && (
            <span className="absolute inset-0 rounded-full bg-danger opacity-40 animate-ping" />
          )}
          <span className="relative">{grabando ? "⏹️" : "🎙️"}</span>
        </button>
        <p className="text-muted text-sm h-5">
          {procesando ? "Procesando..." : grabando ? "Grabando, tocá para parar" : "Tocá para grabar"}
        </p>
      </div>

      <form onSubmit={handleTexto} className="flex gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="o escribí el gasto..."
          className="flex-1 bg-surface border border-border rounded-lg px-4 py-3 text-base outline-none focus:border-accent transition-colors"
        />
        <button
          type="submit"
          disabled={procesando}
          className="bg-surface border border-border rounded-lg px-4 py-3 disabled:opacity-50 hover:border-accent transition-colors"
        >
          Enviar
        </button>
        <label className="bg-surface border border-border rounded-lg px-4 py-3 cursor-pointer hover:border-accent transition-colors">
          📷
          <input type="file" accept="image/*" capture="environment" onChange={handleFoto} className="hidden" />
        </label>
      </form>

      {mensaje && (
        <p className={`text-sm text-center ${mensaje.tipo === "ok" ? "text-accent" : "text-danger"}`}>
          {mensaje.texto}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-muted text-sm uppercase tracking-wide">Movimientos de hoy</h2>
        {movimientos.length === 0 && (
          <p className="text-muted text-sm">Todavía no registraste nada hoy.</p>
        )}
        {movimientos.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between bg-surface border border-border rounded-lg px-4 py-3"
          >
            <div className="min-w-0">
              <p className="font-medium truncate">
                {m.categoriaEmoji ?? "📦"} {m.categoriaNombre ?? ""} — {m.descripcion}
              </p>
              <p className="text-muted text-sm">{m.fecha}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span
                className="text-lg font-semibold tabular-nums"
                style={{ color: m.tipo === "gasto" ? "#e66767" : "#22c55e" }}
              >
                {m.tipo === "gasto" ? "-" : "+"}${fmt(m.monto_ars)}
              </span>
              <button
                onClick={() => borrarMovimiento(m.id)}
                className="text-muted hover:text-danger text-sm p-1"
                aria-label="Borrar"
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
