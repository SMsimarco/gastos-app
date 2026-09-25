import type { ReactNode } from "react";
import { NavTabs } from "@/components/NavTabs";
import { InstalarPWA } from "@/components/InstalarPWA";
import { ActivarNotificaciones } from "@/components/ActivarNotificaciones";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <InstalarPWA />
      <ActivarNotificaciones />
      <div style={{ paddingBottom: "calc(64px + env(safe-area-inset-bottom))" }}>{children}</div>
      <NavTabs />
    </>
  );
}
