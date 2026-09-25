import { crearClienteServidor } from "@/lib/supabase/server";
import { obtenerConfigPlan, obtenerGastoMensualArs, obtenerUltimoMep } from "@/lib/planData";
import { GestionPlan } from "@/components/GestionPlan";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: bolsillos }, config, gastoMensualArs, mepReferencia, { data: repartoPendiente }] = await Promise.all([
    supabase.from("bolsillos").select("id, clave, nombre, moneda, saldo, meta, orden").order("orden"),
    user ? obtenerConfigPlan(supabase, user.id) : Promise.resolve(null),
    user ? obtenerGastoMensualArs(supabase, user.id) : Promise.resolve(null),
    obtenerUltimoMep(supabase),
    supabase
      .from("repartos")
      .select("id, monto_ars, tc_referencia, detalle, estado, created_at")
      .eq("estado", "pendiente")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return (
    <main className="flex-1">
      <GestionPlan
        bolsillosIniciales={bolsillos ?? []}
        configInicial={config}
        gastoMensualArsInicial={gastoMensualArs}
        mepReferenciaInicial={mepReferencia}
        repartoPendienteInicial={repartoPendiente ?? null}
      />
    </main>
  );
}
