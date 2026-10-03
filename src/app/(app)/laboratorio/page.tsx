import { PanelLaboratorio } from "@/components/PanelLaboratorio";
import { obtenerPanelEnVivo } from "@/lib/laboratorio/panelData";
import { crearClienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LaboratorioPage() {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const panel = await obtenerPanelEnVivo(supabase, user.id);
  return <main className="flex-1"><PanelLaboratorio panelInicial={panel} /></main>;
}
