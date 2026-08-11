import { crearClienteServidor } from "@/lib/supabase/server";
import { TablaTodos } from "@/components/TablaTodos";

export const dynamic = "force-dynamic";

export default async function TodosPage() {
  const supabase = await crearClienteServidor();

  const { data: categorias } = await supabase
    .from("categorias")
    .select("id, nombre, emoji, tipo")
    .order("orden");

  return (
    <main className="flex-1">
      <TablaTodos categorias={categorias ?? []} />
    </main>
  );
}
