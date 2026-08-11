import type { ReactNode } from "react";
import { NavTabs } from "@/components/NavTabs";
import { InstalarPWA } from "@/components/InstalarPWA";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <NavTabs />
      <InstalarPWA />
      {children}
    </>
  );
}
