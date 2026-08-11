"use client";

import { useEffect, useState } from "react";
import { IconCheck } from "@/components/icons";

function base64UrlToUint8Array(base64Url: string) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function ActivarNotificaciones() {
  const [visible, setVisible] = useState(false);
  const [activando, setActivando] = useState(false);

  useEffect(() => {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    if (Notification.permission === "denied") return;
    if (localStorage.getItem("gastos-voz-push-dismissed") === "1") return;

    navigator.serviceWorker.ready.then(async (registration) => {
      const existing = await registration.pushManager.getSubscription();
      if (!existing) setVisible(true);
    });
  }, []);

  async function activar() {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) return;
    setActivando(true);
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setVisible(false);
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(vapidKey),
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      setVisible(false);
    } finally {
      setActivando(false);
    }
  }

  function descartar() {
    setVisible(false);
    localStorage.setItem("gastos-voz-push-dismissed", "1");
  }

  if (!visible) return null;

  return (
    <div className="card mx-4 mt-3 px-4 py-3 flex items-center justify-between gap-3">
      <p className="text-sm">Activá avisos: te confirmamos cada gasto y alertamos si te pasás de presupuesto.</p>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={activar}
          disabled={activando}
          className="pressable bg-accent text-black text-sm font-medium rounded-lg px-3 py-1.5 hover:brightness-110 transition-[filter] disabled:opacity-50 flex items-center gap-1"
        >
          <IconCheck size={14} />
          {activando ? "..." : "Activar"}
        </button>
        <button onClick={descartar} className="text-muted text-sm px-2">
          Ahora no
        </button>
      </div>
    </div>
  );
}
