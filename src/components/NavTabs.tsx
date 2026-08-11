"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { crearClienteBrowser } from "@/lib/supabase/client";

const TABS = [
  { href: "/", label: "Hoy" },
  { href: "/mes", label: "Mes" },
];

export function NavTabs() {
  const pathname = usePathname();
  const router = useRouter();

  async function salir() {
    const supabase = crearClienteBrowser();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="flex items-center justify-between border-b border-border px-4">
      <div className="flex gap-1">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-3 text-sm border-b-2 -mb-px ${
              pathname === tab.href
                ? "border-accent text-foreground font-medium"
                : "border-transparent text-muted"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <button onClick={salir} className="text-muted text-sm px-2">
        Salir
      </button>
    </nav>
  );
}
