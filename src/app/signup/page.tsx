"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { crearClienteBrowser } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [revisarEmail, setRevisarEmail] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);

    const supabase = crearClienteBrowser();
    const { data, error } = await supabase.auth.signUp({ email, password });

    setCargando(false);
    if (error) {
      setError(error.message);
      return;
    }

    if (data.session) {
      router.push("/");
      router.refresh();
    } else {
      setRevisarEmail(true);
    }
  }

  if (revisarEmail) {
    return (
      <main className="flex-1 flex items-center justify-center p-6">
        <p className="text-center max-w-sm">
          📩 Te mandamos un email para confirmar la cuenta. Confirmalo y después entrá desde{" "}
          <Link href="/login" className="text-accent hover:underline">
            /login
          </Link>
          .
        </p>
      </main>
    );
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 mb-2">
          <Image src="/icon-512.png" alt="gastos-voz" width={88} height={88} priority />
          <h1 className="text-xl font-semibold tracking-tight">Crear cuenta</h1>
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
          placeholder="Contraseña (mínimo 6 caracteres)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          className="card px-4 py-3 text-base outline-none focus:border-accent transition-colors"
          required
        />

        {error && <p className="text-danger text-sm">{error}</p>}

        <button
          type="submit"
          disabled={cargando}
          className="pressable bg-accent text-black font-medium rounded-xl px-4 py-3 disabled:opacity-50 hover:brightness-110 transition-[filter]"
        >
          {cargando ? "Creando..." : "Crear cuenta"}
        </button>

        <Link href="/login" className="text-muted text-sm text-center hover:text-foreground transition-colors">
          Ya tengo cuenta
        </Link>
      </form>
    </main>
  );
}
