"use client";

import { useEffect, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { crearClienteBrowser } from "@/lib/supabase/client";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

async function generarNonce() {
  const nonceCrudo = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const bytes = new TextEncoder().encode(nonceCrudo);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const nonceHasheado = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { nonceCrudo, nonceHasheado };
}

export function BotonGoogle({ onError }: { onError: (mensaje: string) => void }) {
  const router = useRouter();
  const contenedorRef = useRef<HTMLDivElement>(null);
  const idContenedor = useId();

  useEffect(() => {
    let cancelado = false;

    async function iniciar() {
      if (!window.google || cancelado || !contenedorRef.current) return;

      const { nonceCrudo, nonceHasheado } = await generarNonce();
      if (cancelado) return;

      async function manejarRespuesta(response: { credential: string }) {
        const supabase = crearClienteBrowser();
        const { error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: response.credential,
          nonce: nonceCrudo,
        });
        if (error) {
          onError(error.message);
          return;
        }
        router.push("/");
        router.refresh();
      }

      window.google.accounts.id.initialize({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
        callback: manejarRespuesta,
        nonce: nonceHasheado,
        use_fedcm_for_prompt: true,
      });

      window.google.accounts.id.renderButton(contenedorRef.current, {
        type: "standard",
        theme: "filled_black",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width: 320,
      });
    }

    const script = document.getElementById("google-identity-script");
    if (window.google?.accounts?.id) {
      iniciar();
    } else {
      script?.addEventListener("load", iniciar, { once: true });
    }

    return () => {
      cancelado = true;
      script?.removeEventListener("load", iniciar);
    };
  }, [router, onError]);

  return <div ref={contenedorRef} id={idContenedor} className="flex justify-center" />;
}
