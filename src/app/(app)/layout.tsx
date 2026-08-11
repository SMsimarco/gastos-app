import type { ReactNode } from "react";
import { NavTabs } from "@/components/NavTabs";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <NavTabs />
      {children}
    </>
  );
}
