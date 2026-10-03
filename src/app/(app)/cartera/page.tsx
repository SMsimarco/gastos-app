import { GestionCartera } from "@/components/GestionCartera";
import { obtenerCartera } from "@/lib/inversiones/carteraData";
import { crearClienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CarteraPage() {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const cartera = await obtenerCartera(supabase, user.id);
  return <main className="flex-1"><GestionCartera carteraInicial={cartera} /></main>;
}
