"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { crearClienteBrowser } from "@/lib/supabase/client";
import { IconMic, IconChart, IconList, IconLogout, IconWallet } from "@/components/icons";

const TABS = [
  { href: "/", label: "Hoy", Icon: IconMic },
  { href: "/resumen", label: "Resumen", Icon: IconChart },
  { href: "/plan", label: "Plan", Icon: IconWallet },
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
      className="fixed inset-x-0 bottom-0 z-20 flex items-stretch overflow-x-auto border-t border-border-soft backdrop-blur-md"
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
        backgroundColor: "rgba(255, 255, 255, 0.85)",
      }}
    >
      {TABS.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          className={`pressable flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] transition-colors shrink-0 min-w-[58px] ${
            pathname === href ? "text-accent font-medium" : "text-muted hover:text-foreground"
          }`}
        >
          <Icon size={20} />
          {label}
        </Link>
      ))}
      <button
        onClick={salir}
        className="pressable flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] text-muted hover:text-foreground transition-colors shrink-0 min-w-[58px]"
      >
        <IconLogout size={20} />
        Salir
      </button>
    </nav>
  );
}
