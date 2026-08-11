"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { crearClienteBrowser } from "@/lib/supabase/client";

const TABS = [
  { href: "/", label: "Hoy", icon: "🎙️" },
  { href: "/mes", label: "Mes", icon: "📊" },
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
    <nav
      className="flex items-center justify-between border-b border-border px-2 bg-background sticky top-0 z-10"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex gap-1">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-1.5 px-3 py-3 text-sm border-b-2 -mb-px transition-colors ${
              pathname === tab.href
                ? "border-accent text-foreground font-medium"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            <span aria-hidden>{tab.icon}</span>
            {tab.label}
          </Link>
        ))}
      </div>
      <button onClick={salir} className="text-muted hover:text-foreground text-sm px-3 py-3 transition-colors">
        Salir
      </button>
    </nav>
  );
}
