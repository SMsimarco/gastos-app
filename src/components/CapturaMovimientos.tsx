"use client";

import { useEffect, useRef, useState } from "react";
import { IconMic, IconStop, IconSend, IconCamera, IconTrash } from "@/components/icons";
import { encolarCaptura, obtenerCola, borrarDeCola, itemAFormData } from "@/lib/colaOffline";

type MovimientoFila = {
  id: string;
  tipo: string;
  monto_ars: number;
  descripcion: string;
  fecha: string;
  cuotas_total?: number;
  cuota_nro?: number;
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
  const [pendientesOffline, setPendientesOffline] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const totalHoyActual = movimientos
    .filter((m) => m.tipo === "gasto")
    .reduce((acc, m) => acc + m.monto_ars, 0);

  function procesarRespuesta(data: {
    tipo?: string;
    respuesta?: string;
    resultados?: Array<Record<string, unknown>>;
  }) {
    if (data.tipo === "consulta") {
      setMensaje({ texto: data.respuesta ?? "", tipo: "ok" });
      return;
    }

    const nuevos: MovimientoFila[] = [];
    let huboBaja = false;
    let huboDuplicado = false;
    for (const r of data.resultados ?? []) {
      if (r.confianza === "baja" && !r.guardado) {
        huboBaja = true;
      } else {
        nuevos.push(r as unknown as MovimientoFila);
        if (r.posibleDuplicado) huboDuplicado = true;
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
    } else if (huboDuplicado) {
      setMensaje({ texto: "⚠️ Registrado, pero parece un duplicado de otro gasto de hoy.", tipo: "warn" });
    } else if (nuevos.length > 0) {
      setMensaje({ texto: `Registrado${nuevos.length > 1 ? ` (${nuevos.length})` : ""}`, tipo: "ok" });
    } else {
      setMensaje({ texto: "No encontré ningún movimiento en eso.", tipo: "warn" });
    }
  }

  async function procesarColaPendiente() {
    let cola;
    try {
      cola = await obtenerCola();
    } catch {
      return;
    }
    if (cola.length === 0) {
      setPendientesOffline(0);
      return;
    }

    for (const item of cola) {
      try {
        const res = await fetch("/api/capturar", { method: "POST", body: itemAFormData(item) });
        if (res.ok) {
          const data = await res.json();
          procesarRespuesta(data);
          if (item.id !== undefined) await borrarDeCola(item.id);
        } else {
          break; // error del servidor, no seguir intentando ahora
        }
      } catch {
        break; // seguimos sin conexión, reintentar después
      }
    }

    const restante = await obtenerCola();
    setPendientesOffline(restante.length);
  }

  useEffect(() => {
    procesarColaPendiente();
    window.addEventListener("online", procesarColaPendiente);
    return () => window.removeEventListener("online", procesarColaPendiente);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enviarCaptura(
    formData: FormData,
    itemOffline: { tipo: "audio" | "texto" | "foto"; texto?: string; blob?: Blob; nombreArchivo?: string }
  ) {
    setProcesando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/capturar", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setMensaje({ texto: `⚠️ ${data.error ?? "Error desconocido"}`, tipo: "warn" });
        return;
      }

      procesarRespuesta(data);
    } catch {
      await encolarCaptura(itemOffline);
      const cola = await obtenerCola();
      setPendientesOffline(cola.length);
      setMensaje({
        texto: "📴 Sin conexión. Lo guardé y lo subo solo cuando vuelva la señal.",
        tipo: "warn",
      });
    } finally {
      setProcesando(false);
    }
  }

  async function tieneSenalDeAudio(blob: Blob) {
    try {
      const ctx = new AudioContext();
      const audioBuffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      let pico = 0;
      for (let canal = 0; canal < audioBuffer.numberOfChannels; canal++) {
        const datos = audioBuffer.getChannelData(canal);
        for (let i = 0; i < datos.length; i++) {
          const abs = Math.abs(datos[i]);
          if (abs > pico) pico = abs;
        }
      }
      await ctx.close();
      return pico > 0.02;
    } catch {
      return true;
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

      if (!(await tieneSenalDeAudio(blob))) {
        setMensaje({
          texto: "🎙️ No se detectó sonido en la grabación. Revisá permisos/dispositivo de micrófono.",
          tipo: "warn",
        });
        return;
      }

      const formData = new FormData();
      formData.append("audio", blob, "audio.webm");
      await enviarCaptura(formData, { tipo: "audio", blob, nombreArchivo: "audio.webm" });
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
    await enviarCaptura(formData, { tipo: "foto", blob: file, nombreArchivo: file.name });
    e.target.value = "";
  }

  async function handleTexto(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    const formData = new FormData();
    formData.append("texto", texto);
    const textoEnviado = texto;
    setTexto("");
    await enviarCaptura(formData, { tipo: "texto", texto: textoEnviado });
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
    <div className="flex flex-col gap-7 w-full max-w-md mx-auto p-5 pb-12">
      <div className="flex flex-col gap-1.5 pt-3">
        <span className="text-muted text-xs font-medium uppercase tracking-widest">Gastado hoy</span>
        <span className="text-5xl font-semibold tabular-nums tracking-tight">${fmt(totalHoyActual)}</span>
        {diferenciaPromedio !== null && (
          <span className="text-sm text-muted">
            {diferenciaPromedio > 0 ? "↑" : diferenciaPromedio < 0 ? "↓" : "="}{" "}
            {Math.abs(diferenciaPromedio)}% vs. promedio diario del mes (${fmt(promedioDiario!)})
          </span>
        )}
        {pendientesOffline > 0 && (
          <span className="text-xs text-muted">
            📴 {pendientesOffline} capturas esperando conexión para subir
          </span>
        )}
      </div>

      <div className="flex flex-col items-center gap-4 py-6">
        <button
          onClick={grabando ? detenerGrabacion : iniciarGrabacion}
          disabled={procesando}
          aria-label={grabando ? "Parar grabación" : "Grabar audio"}
          className={`pressable relative w-28 h-28 rounded-full flex items-center justify-center text-black transition-[background,box-shadow] disabled:opacity-50 ${
            grabando ? "bg-danger" : "bg-accent"
          }`}
          style={{
            boxShadow: grabando
              ? "0 0 0 1px rgba(248,113,113,0.3), 0 12px 32px -8px rgba(248,113,113,0.45)"
              : "0 0 0 1px rgba(52,211,153,0.3), 0 12px 32px -8px rgba(52,211,153,0.45)",
          }}
        >
          {grabando && (
            <span className="absolute inset-0 rounded-full bg-danger opacity-30 animate-ping" />
          )}
          <span className="relative">
            {grabando ? <IconStop size={34} /> : <IconMic size={34} />}
          </span>
        </button>
        <p className="text-muted text-sm h-5">
          {procesando ? "Procesando..." : grabando ? "Grabando, tocá para parar" : "Tocá para grabar"}
        </p>
      </div>

      <form onSubmit={handleTexto} className="flex gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="o escribí el gasto, o preguntá algo..."
          className="flex-1 bg-surface border border-border-soft rounded-xl px-4 py-3 text-base outline-none focus:border-accent transition-colors"
        />
        <button
          type="submit"
          disabled={procesando}
          aria-label="Enviar"
          className="pressable bg-surface border border-border-soft rounded-xl px-4 py-3 disabled:opacity-50 hover:border-accent transition-colors text-muted hover:text-foreground"
        >
          <IconSend size={20} />
        </button>
        <label className="pressable bg-surface border border-border-soft rounded-xl px-4 py-3 cursor-pointer hover:border-accent transition-colors text-muted hover:text-foreground">
          <IconCamera size={20} />
          <input type="file" accept="image/*" capture="environment" onChange={handleFoto} className="hidden" />
        </label>
      </form>

      {mensaje && (
        <p
          className={`text-sm text-center whitespace-pre-line ${mensaje.tipo === "ok" ? "text-accent" : "text-danger"}`}
        >
          {mensaje.texto}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-muted text-xs font-medium uppercase tracking-widest">Movimientos de hoy</h2>
        {movimientos.length === 0 && (
          <p className="text-muted text-sm py-2">Todavía no registraste nada hoy.</p>
        )}
        {movimientos.map((m) => (
          <div
            key={m.id}
            className="card flex items-center justify-between px-4 py-3.5"
          >
            <div className="min-w-0">
              <p className="font-medium truncate">
                {m.categoriaEmoji ?? "📦"} {m.descripcion}
              </p>
              <p className="text-muted text-sm">
                {m.fecha}
                {m.cuotas_total && m.cuotas_total > 1 ? ` · cuota ${m.cuota_nro}/${m.cuotas_total}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span
                className="text-lg font-semibold tabular-nums"
                style={{ color: m.tipo === "gasto" ? "#f87171" : "#34d399" }}
              >
                {m.tipo === "gasto" ? "-" : "+"}${fmt(m.monto_ars)}
              </span>
              <button
                onClick={() => borrarMovimiento(m.id)}
                className="text-muted hover:text-danger p-1 transition-colors"
                aria-label="Borrar"
              >
                <IconTrash size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
