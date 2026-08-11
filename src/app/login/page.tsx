"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { crearClienteBrowser } from "@/lib/supabase/client";

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
        <div className="flex justify-center mb-2">
          <div
            className="rounded-2xl overflow-hidden bg-[#faf9f5] p-4"
            style={{ boxShadow: "0 12px 32px -12px rgba(52,211,153,0.35)" }}
          >
            <Image src="/logo-full.png" alt="gastos-voz" width={220} height={121} priority />
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
