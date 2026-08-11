import { crearClienteServidor } from "@/lib/supabase/server";
import { GestionPresupuestos, type Presupuesto } from "@/components/GestionPresupuestos";

export const dynamic = "force-dynamic";

export default async function PresupuestosPage() {
  const supabase = await crearClienteServidor();

  const hoyAR = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const inicioMes = `${hoyAR.slice(0, 7)}-01`;

  const [{ data: categorias }, { data: presupuestos }, { data: totales }] = await Promise.all([
    supabase.from("categorias").select("id, nombre, emoji").eq("tipo", "gasto").order("orden"),
    supabase
      .from("presupuestos")
      .select("id, categoria_id, monto_mensual, categorias(nombre, emoji)")
      .eq("mes", inicioMes),
    supabase.rpc("totales_por_categoria", { desde: inicioMes, hasta: hoyAR, tipo_filtro: "gasto" }),
  ]);

  return (
    <main className="flex-1">
      <GestionPresupuestos
        categorias={categorias ?? []}
        presupuestosIniciales={(presupuestos ?? []) as unknown as Presupuesto[]}
        gastadoPorCategoria={totales ?? []}
        mes={inicioMes}
      />
    </main>
  );
}
