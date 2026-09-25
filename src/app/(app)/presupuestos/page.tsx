import { crearClienteServidor } from "@/lib/supabase/server";
import { GestionPresupuestos, type Presupuesto } from "@/components/GestionPresupuestos";
import { MisCategorias } from "@/components/MisCategorias";
import { GestionGmail } from "@/components/GestionGmail";
import { PresupuestoGeneral } from "@/components/PresupuestoGeneral";

export const dynamic = "force-dynamic";

export default async function PresupuestosPage() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const hoyAR = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const inicioMes = `${hoyAR.slice(0, 7)}-01`;

  const [
    { data: categoriasGasto },
    { data: presupuestos },
    { data: totales },
    { data: todasCategorias },
    { data: presupuestoGeneral },
  ] = await Promise.all([
    supabase.from("categorias").select("id, nombre, emoji").eq("tipo", "gasto").order("orden"),
    supabase
      .from("presupuestos")
      .select("id, categoria_id, monto_mensual, categorias(nombre, emoji)")
      .eq("mes", inicioMes),
    supabase.rpc("totales_por_categoria", { desde: inicioMes, hasta: hoyAR, tipo_filtro: "gasto" }),
    supabase
      .from("categorias")
      .select("id, nombre, emoji, tipo, usuario_id")
      .eq("usuario_id", user?.id ?? "")
      .order("nombre"),
    supabase.from("presupuesto_general").select("monto").maybeSingle(),
  ]);

  return (
    <main className="flex-1">
      <div className="w-full max-w-md mx-auto px-5 pt-5">
        <PresupuestoGeneral montoInicial={presupuestoGeneral?.monto ?? null} />
      </div>
      <div className="w-full max-w-md mx-auto px-5 pt-4">
        <p className="text-muted text-xs uppercase tracking-wide">Avanzado (opcional)</p>
        <p className="text-muted text-sm mt-0.5 mb-1">
          Además podés ponerle un tope a categorías puntuales y te avisamos cuando te pasás de esa una.
        </p>
      </div>
      <GestionPresupuestos
        categorias={categoriasGasto ?? []}
        presupuestosIniciales={(presupuestos ?? []) as unknown as Presupuesto[]}
        gastadoPorCategoria={totales ?? []}
        mes={inicioMes}
      />
      <div className="w-full max-w-md mx-auto px-5 pb-4">
        <GestionGmail />
      </div>
      <MisCategorias categoriasPropias={todasCategorias ?? []} />
    </main>
  );
}
