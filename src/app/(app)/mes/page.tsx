import { crearClienteServidor } from "@/lib/supabase/server";
import { GraficosMes, type Kpis, type Gasto } from "@/components/GraficosMes";

export const dynamic = "force-dynamic";

function primerDiaMes(fecha: Date) {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function ultimoDiaMes(fecha: Date) {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

export default async function MesPage() {
  const supabase = await crearClienteServidor();

  const hoyStr = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const hoy = new Date(`${hoyStr}T00:00:00Z`);
  const mesAnterior = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));

  const inicioMes = primerDiaMes(hoy);
  const finMes = ultimoDiaMes(hoy);
  const inicioMesAnterior = primerDiaMes(mesAnterior);
  const finMesAnterior = ultimoDiaMes(mesAnterior);

  const [kpis, categorias, acumuladoEsteMes, acumuladoMesAnterior, comercios, ultimosGastos] = await Promise.all([
    supabase.rpc("kpis_mes", { mes_inicio: inicioMes }).single(),
    supabase.rpc("totales_por_categoria", { desde: inicioMes, hasta: finMes, tipo_filtro: "gasto" }),
    supabase.rpc("gasto_acumulado_diario", { desde: inicioMes, hasta: finMes }),
    supabase.rpc("gasto_acumulado_diario", { desde: inicioMesAnterior, hasta: finMesAnterior }),
    supabase.rpc("top_comercios", { desde: inicioMes, hasta: finMes, limite: 10 }),
    supabase
      .from("movimientos")
      .select("id, descripcion, fecha, monto_ars, comercio, categorias(nombre, emoji)")
      .eq("tipo", "gasto")
      .gte("fecha", inicioMes)
      .lte("fecha", finMes)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  return (
    <main className="flex-1">
      <GraficosMes
        kpis={kpis.data as Kpis}
        categorias={categorias.data ?? []}
        acumuladoEsteMes={acumuladoEsteMes.data ?? []}
        acumuladoMesAnterior={acumuladoMesAnterior.data ?? []}
        comercios={comercios.data ?? []}
        ultimosGastos={(ultimosGastos.data ?? []) as unknown as Gasto[]}
        desde={inicioMes}
        hasta={finMes}
      />
    </main>
  );
}
