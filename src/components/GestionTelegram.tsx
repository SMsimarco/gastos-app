"use client";

import { useEffect, useState } from "react";

type EstadoTelegram = { vinculado: boolean; codigo: string | null; expiraAt: string | null };

export function GestionTelegram() {
  const [estado, setEstado] = useState<EstadoTelegram | null>(null);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/telegram/vinculo")
      .then((response) => response.ok ? response.json() : null)
      .then((data: EstadoTelegram | null) => { if (data) setEstado(data); })
      .finally(() => setCargando(false));
  }, []);

  async function generar() {
    setCargando(true);
    setMensaje(null);
    const response = await fetch("/api/telegram/vinculo", { method: "POST" });
    const data = await response.json();
    if (response.ok) setEstado({ vinculado: false, codigo: data.codigo, expiraAt: data.expiraAt });
    else setMensaje(data.error ?? "No pude generar el código");
    setCargando(false);
  }

  async function desvincular() {
    setCargando(true);
    const response = await fetch("/api/telegram/vinculo", { method: "DELETE" });
    if (response.ok) setEstado({ vinculado: false, codigo: null, expiraAt: null });
    setCargando(false);
  }

  if (!estado && cargando) return null;
  return (
    <div className="card p-4 flex flex-col gap-3">
      <div>
        <span className="font-medium">✈️ Telegram</span>
        <p className="text-muted text-sm mt-0.5">Registrá gastos por texto o audio y consultá tu plan desde @investfoco_bot.</p>
      </div>
      {estado?.vinculado ? (
        <>
          <p className="text-positive text-sm">● Cuenta vinculada</p>
          <button onClick={desvincular} disabled={cargando} className="pressable bg-surface-2 border border-border-soft rounded-xl px-4 py-2.5 text-sm hover:border-danger hover:text-danger transition-colors disabled:opacity-50">Desvincular</button>
        </>
      ) : estado?.codigo ? (
        <>
          <p className="text-sm">Abrí <a className="text-accent underline" href="https://t.me/investfoco_bot" target="_blank" rel="noreferrer">@investfoco_bot</a> y enviá:</p>
          <code className="bg-surface-2 rounded-xl p-3 text-center text-lg font-semibold tracking-wider">/vincular {estado.codigo}</code>
          <p className="text-muted text-xs">El código vence en 10 minutos.</p>
          <button onClick={generar} disabled={cargando} className="pressable bg-surface-2 border border-border-soft rounded-xl px-4 py-2.5 text-sm disabled:opacity-50">Generar otro código</button>
        </>
      ) : (
        <button onClick={generar} disabled={cargando} className="pressable bg-accent text-black font-medium rounded-xl px-4 py-2.5 text-sm disabled:opacity-50 hover:brightness-110 transition-[filter]">{cargando ? "Generando…" : "Vincular Telegram"}</button>
      )}
      {mensaje && <p className="text-danger text-sm">⚠️ {mensaje}</p>}
    </div>
  );
}

