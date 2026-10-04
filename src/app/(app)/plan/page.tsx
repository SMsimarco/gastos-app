import { crearClienteServidor } from "@/lib/supabase/server";
import { obtenerConfigPlan, obtenerGastoMensualConFuente, obtenerUltimoMep } from "@/lib/planData";
import { GestionPlan } from "@/components/GestionPlan";
import { GestionMetas } from "@/components/GestionMetas";
import { ProyeccionDepto } from "@/components/ProyeccionDepto";
import { SeccionAprender } from "@/components/SeccionAprender";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: bolsillos }, config, gastoMensual, mepReferencia, { data: repartoPendiente }, { data: metas }] =
    await Promise.all([
      supabase.from("bolsillos").select("id, clave, nombre, moneda, saldo, meta, orden").order("orden"),
      user ? obtenerConfigPlan(supabase, user.id) : Promise.resolve(null),
      user ? obtenerGastoMensualConFuente(supabase, user.id) : Promise.resolve({ valor: null, fuente: "manual" as const }),
      obtenerUltimoMep(supabase),
      supabase
        .from("repartos")
        .select("id, monto_ars, tc_referencia, detalle, estado, created_at")
        .eq("estado", "pendiente")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("metas_ahorro").select("id, nombre, monto_objetivo, monto_actual").order("created_at", { ascending: false }),
    ]);

  return (
    <main className="flex-1">
      <GestionPlan
        bolsillosIniciales={bolsillos ?? []}
        configInicial={config}
        gastoMensualArsInicial={gastoMensual.valor}
        gastoMensualFuenteInicial={gastoMensual.fuente}
        mepReferenciaInicial={mepReferencia}
        repartoPendienteInicial={repartoPendiente ?? null}
      />
      <div className="w-full max-w-md mx-auto px-5 pb-6 flex flex-col gap-4">
        <SeccionAprender />
        <ProyeccionDepto />
      </div>
      <GestionMetas metasIniciales={metas ?? []} />
    </main>
  );
}
