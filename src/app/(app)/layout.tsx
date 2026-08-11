import type { ReactNode } from "react";
import { NavTabs } from "@/components/NavTabs";
import { InstalarPWA } from "@/components/InstalarPWA";
import { ActivarNotificaciones } from "@/components/ActivarNotificaciones";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <NavTabs />
      <InstalarPWA />
      <ActivarNotificaciones />
      {children}
    </>
  );
}
