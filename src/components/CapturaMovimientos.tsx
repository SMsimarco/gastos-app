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

export function CapturaMovimientos({
  movimientosIniciales,
}: {
  movimientosIniciales: MovimientoFila[];
}) {
  const [movimientos, setMovimientos] = useState(movimientosIniciales);
  const [grabando, setGrabando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [texto, setTexto] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function enviarCaptura(formData: FormData) {
    setProcesando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/capturar", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setMensaje(`⚠️ ${data.error ?? "Error desconocido"}`);
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
        setMensaje("🤔 No entendí bien el monto, no se registró. Probá de nuevo siendo más específico.");
      } else if (nuevos.length > 0) {
        setMensaje(`✅ Registrado (${nuevos.length})`);
      } else {
        setMensaje("No encontré ningún movimiento en eso.");
      }
    } catch {
      setMensaje("⚠️ Error de conexión");
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

  return (
    <div className="flex flex-col gap-6 w-full max-w-md mx-auto p-4">
      <div className="flex flex-col items-center gap-3 py-6">
        <button
          onClick={grabando ? detenerGrabacion : iniciarGrabacion}
          disabled={procesando}
          className={`w-24 h-24 rounded-full flex items-center justify-center text-4xl transition-colors ${
            grabando ? "bg-danger animate-pulse" : "bg-accent"
          } disabled:opacity-50`}
        >
          🎙️
        </button>
        <p className="text-muted text-sm">
          {procesando ? "Procesando..." : grabando ? "Grabando, tocá para parar" : "Tocá para grabar"}
        </p>
      </div>

      <form onSubmit={handleTexto} className="flex gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="o escribí el gasto..."
          className="flex-1 bg-surface border border-border rounded-lg px-4 py-3 text-base outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={procesando}
          className="bg-surface border border-border rounded-lg px-4 py-3 disabled:opacity-50"
        >
          Enviar
        </button>
        <label className="bg-surface border border-border rounded-lg px-4 py-3 cursor-pointer">
          📷
          <input type="file" accept="image/*" capture="environment" onChange={handleFoto} className="hidden" />
        </label>
      </form>

      {mensaje && <p className="text-sm text-center">{mensaje}</p>}

      <div className="flex flex-col gap-2">
        <h2 className="text-muted text-sm uppercase tracking-wide">Hoy</h2>
        {movimientos.length === 0 && (
          <p className="text-muted text-sm">Todavía no registraste nada hoy.</p>
        )}
        {movimientos.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between bg-surface border border-border rounded-lg px-4 py-3"
          >
            <div>
              <p className="font-medium">
                {m.categoriaEmoji ?? "📦"} {m.categoriaNombre ?? ""} — {m.descripcion}
              </p>
              <p className="text-muted text-sm">{m.fecha}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold tabular-nums">
                {m.tipo === "gasto" ? "-" : "+"}${m.monto_ars}
              </span>
              <button
                onClick={() => borrarMovimiento(m.id)}
                className="text-muted hover:text-danger text-sm"
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
