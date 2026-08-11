"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { crearClienteBrowser } from "@/lib/supabase/client";
import { IconMic, IconCalendarWeek, IconChart, IconCalendarYear, IconList, IconLogout, IconTarget, IconFlag } from "@/components/icons";

const TABS = [
  { href: "/", label: "Hoy", Icon: IconMic },
  { href: "/semana", label: "Semana", Icon: IconCalendarWeek },
  { href: "/mes", label: "Mes", Icon: IconChart },
  { href: "/anio", label: "Año", Icon: IconCalendarYear },
  { href: "/presupuestos", label: "Presupuestos", Icon: IconTarget },
  { href: "/metas", label: "Metas", Icon: IconFlag },
  { href: "/todos", label: "Todos", Icon: IconList },
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
      className="flex items-center justify-between border-b border-border-soft px-2 backdrop-blur-md sticky top-0 z-10"
      style={{ paddingTop: "env(safe-area-inset-top)", backgroundColor: "rgba(8, 9, 10, 0.75)" }}
    >
      <div className="flex gap-1 overflow-x-auto">
        {TABS.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-1.5 px-3 py-3 text-sm border-b-2 -mb-px transition-colors shrink-0 ${
              pathname === href
                ? "border-accent text-foreground font-medium"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </div>
      <button
        onClick={salir}
        className="flex items-center gap-1.5 text-muted hover:text-foreground text-sm px-3 py-3 transition-colors"
      >
        <IconLogout size={16} />
        <span className="hidden sm:inline">Salir</span>
      </button>
    </nav>
  );
}
