"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Estado = {
  activo: boolean;
  remitentes: string[];
  ultimoCheck: string | null;
};

function GestionGmailInner() {
  const searchParams = useSearchParams();
  const resultadoCallback = searchParams.get("gmail"); // "ok" | "error" | null

  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [remitentesTexto, setRemitentesTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/gmail/config")
      .then((r) => r.json())
      .then((data: Estado) => {
        setEstado(data);
        setRemitentesTexto(data.remitentes.join(", "));
      })
      .finally(() => setCargando(false));
  }, []);

  async function desconectar() {
    if (!confirm("¿Desconectar tu Gmail? Dejamos de leer mails nuevos.")) return;
    const res = await fetch("/api/gmail/desconectar", { method: "POST" });
    if (res.ok) setEstado((prev) => (prev ? { ...prev, activo: false } : prev));
  }

  async function guardarRemitentes() {
    const remitentes = remitentesTexto
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    if (remitentes.length === 0) return;
    setGuardando(true);
    try {
      const res = await fetch("/api/gmail/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remitentes }),
      });
      if (res.ok) setEstado((prev) => (prev ? { ...prev, remitentes } : prev));
    } finally {
      setGuardando(false);
    }
  }

  async function revisarAhora() {
    setRevisando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/gmail/revisar-ahora", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMensaje(`⚠️ ${data.error ?? "Error revisando el mail"}`);
        return;
      }
      if (data.desconectado) {
        setMensaje("⚠️ Se desconectó tu Gmail, reconectalo.");
        setEstado((prev) => (prev ? { ...prev, activo: false } : prev));
        return;
      }
      setMensaje(
        data.registrados > 0
          ? `✅ Registré ${data.registrados} gasto${data.registrados > 1 ? "s" : ""} nuevo${data.registrados > 1 ? "s" : ""}.`
          : "No encontré gastos nuevos en tu mail."
      );
      setEstado((prev) => (prev ? { ...prev, ultimoCheck: new Date().toISOString() } : prev));
    } finally {
      setRevisando(false);
    }
  }

  if (cargando) return null;

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div>
        <span className="font-medium">📧 Auto-registro por email</span>
        <p className="text-muted text-sm mt-0.5">
          Cada gasto que hagas con Mercado Pago (u otra billetera) se registra solo, leyendo el mail de
          confirmación.
        </p>
      </div>

      {resultadoCallback === "ok" && (
        <p className="text-positive text-sm">✅ Gmail conectado.</p>
      )}
      {resultadoCallback === "error" && (
        <p className="text-danger text-sm">⚠️ No pude conectar tu Gmail, probá de nuevo.</p>
      )}

      {estado?.activo ? (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="text-positive">● Conectado</span>
            {estado.ultimoCheck && (
              <span className="text-muted text-xs">
                último chequeo: {new Date(estado.ultimoCheck).toLocaleString("es-AR")}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Remitentes a buscar (separados por coma)</label>
            <input
              value={remitentesTexto}
              onChange={(e) => setRemitentesTexto(e.target.value)}
              onBlur={guardarRemitentes}
              placeholder="mercadopago.com.ar, mercadopago.com"
              className="bg-surface-2 border border-border-soft rounded-xl px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {guardando && <span className="text-xs text-muted">Guardando…</span>}
          </div>

          {mensaje && <p className="text-sm">{mensaje}</p>}

          <div className="flex gap-2">
            <button
              onClick={revisarAhora}
              disabled={revisando}
              className="pressable flex-1 bg-accent text-black font-medium rounded-xl px-4 py-2.5 text-sm disabled:opacity-50 hover:brightness-110 transition-[filter]"
            >
              {revisando ? "Revisando…" : "Revisar ahora"}
            </button>
            <button
              onClick={desconectar}
              className="pressable bg-surface-2 border border-border-soft rounded-xl px-4 py-2.5 text-sm hover:border-danger hover:text-danger transition-colors"
            >
              Desconectar
            </button>
          </div>
        </>
      ) : (
        <a
          href="/api/gmail/conectar"
          className="pressable bg-accent text-black font-medium rounded-xl px-4 py-2.5 text-sm text-center hover:brightness-110 transition-[filter]"
        >
          Conectar con Gmail
        </a>
      )}
    </div>
  );
}

export function GestionGmail() {
  return (
    <Suspense fallback={null}>
      <GestionGmailInner />
    </Suspense>
  );
}
