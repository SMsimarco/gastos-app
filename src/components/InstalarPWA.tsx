"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function esStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function esIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstalarPWA() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [mostrarPasosIOS, setMostrarPasosIOS] = useState(false);

  useEffect(() => {
    if (esStandalone()) return;
    if (localStorage.getItem("gastos-voz-instalar-dismissed") === "1") return;

    if (esIOS()) {
      setVisible(true);
      return;
    }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
      setVisible(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  function descartar() {
    setVisible(false);
    setMostrarPasosIOS(false);
    localStorage.setItem("gastos-voz-instalar-dismissed", "1");
  }

  async function instalar() {
    if (esIOS()) {
      setMostrarPasosIOS(true);
      return;
    }
    if (!promptEvent) return;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === "accepted") descartar();
  }

  if (!visible) return null;

  return (
    <div className="card mx-4 mt-3 px-4 py-3 flex items-center justify-between gap-3">
      {mostrarPasosIOS ? (
        <p className="text-sm">
          Tocá <strong>Compartir</strong> (el ícono ⬆️ de abajo) y después <strong>&quot;Agregar a inicio&quot;</strong>.
        </p>
      ) : (
        <>
          <p className="text-sm">Instalá Gastos como app en tu celular.</p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={instalar}
              className="pressable bg-accent text-black text-sm font-medium rounded-lg px-3 py-1.5 hover:brightness-110 transition-[filter]"
            >
              Instalar
            </button>
            <button onClick={descartar} className="text-muted text-sm px-2">
              Ahora no
            </button>
          </div>
        </>
      )}
    </div>
  );
}
