"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { crearClienteBrowser } from "@/lib/supabase/client";
import { IconMic } from "@/components/icons";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);

    const supabase = crearClienteBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setCargando(false);
    if (error) {
      setError("Email o contraseña incorrectos");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-4">
        <div className="flex flex-col items-center gap-4 mb-2">
          <div
            className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center text-black"
            style={{ boxShadow: "0 8px 24px -8px rgba(52,211,153,0.5)" }}
          >
            <IconMic size={28} />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">gastos-voz</h1>
            <p className="text-muted text-sm mt-0.5">Registrá tus gastos hablando</p>
          </div>
        </div>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="card px-4 py-3 text-base outline-none focus:border-accent transition-colors"
          required
        />
        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="card px-4 py-3 text-base outline-none focus:border-accent transition-colors"
          required
        />

        {error && <p className="text-danger text-sm">{error}</p>}

        <button
          type="submit"
          disabled={cargando}
          className="pressable bg-accent text-black font-medium rounded-xl px-4 py-3 disabled:opacity-50 hover:brightness-110 transition-[filter]"
        >
          {cargando ? "Entrando..." : "Entrar"}
        </button>

        <Link href="/signup" className="text-muted text-sm text-center hover:text-foreground transition-colors">
          Crear cuenta nueva
        </Link>
      </form>
    </main>
  );
}
