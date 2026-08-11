import { crearClienteServidor } from "@/lib/supabase/server";
import { GraficoAnio } from "@/components/GraficoAnio";

export const dynamic = "force-dynamic";

export default async function AnioPage() {
  const supabase = await crearClienteServidor();

  const hoyAR = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const anio = Number(hoyAR.slice(0, 4));

  const [resumen, categoriaMensual, diario] = await Promise.all([
    supabase.rpc("resumen_anual", { anio }),
    supabase.rpc("totales_categoria_mensual", { anio }),
    supabase.rpc("gasto_acumulado_diario", { desde: `${anio}-01-01`, hasta: `${anio}-12-31` }),
  ]);

  return (
    <main className="flex-1">
      <GraficoAnio
        anio={anio}
        resumen={resumen.data ?? []}
        categoriaMensual={categoriaMensual.data ?? []}
        diario={diario.data ?? []}
      />
    </main>
  );
}
