import { crearClienteServidor } from "@/lib/supabase/server";
import { GestionMetas } from "@/components/GestionMetas";

export const dynamic = "force-dynamic";

export default async function MetasPage() {
  const supabase = await crearClienteServidor();
  const { data: metas } = await supabase
    .from("metas_ahorro")
    .select("id, nombre, monto_objetivo, monto_actual")
    .order("created_at", { ascending: false });

  return (
    <main className="flex-1">
      <GestionMetas metasIniciales={metas ?? []} />
    </main>
  );
}
