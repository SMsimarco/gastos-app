import { crearClienteServidor } from "@/lib/supabase/server";
import { ResumenSwitcher } from "@/components/ResumenSwitcher";
import type { Gasto, Kpis } from "@/components/GraficosMes";

export const dynamic = "force-dynamic";

function aFecha(str: string) {
  return new Date(`${str}T00:00:00Z`);
}

function toISO(fecha: Date) {
  return fecha.toISOString().slice(0, 10);
}

// Lunes como inicio de semana.
function lunesDeEstaSemana(hoy: Date) {
  const diaSemana = hoy.getUTCDay(); // 0=domingo..6=sabado
  const offset = diaSemana === 0 ? -6 : 1 - diaSemana;
  const lunes = new Date(hoy);
  lunes.setUTCDate(hoy.getUTCDate() + offset);
  return lunes;
}

function primerDiaMes(fecha: Date) {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function ultimoDiaMes(fecha: Date) {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

export default async function ResumenPage() {
  const supabase = await crearClienteServidor();

  const hoyStr = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const hoy = aFecha(hoyStr);
  const anio = Number(hoyStr.slice(0, 4));

  // --- Semana ---
  const lunesEsta = lunesDeEstaSemana(hoy);
  const domingoEsta = new Date(lunesEsta);
  domingoEsta.setUTCDate(lunesEsta.getUTCDate() + 6);
  const lunesAnterior = new Date(lunesEsta);
  lunesAnterior.setUTCDate(lunesEsta.getUTCDate() - 7);
  const domingoAnterior = new Date(lunesAnterior);
  domingoAnterior.setUTCDate(lunesAnterior.getUTCDate() + 6);

  // --- Mes ---
  const mesAnterior = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));
  const inicioMes = primerDiaMes(hoy);
  const finMes = ultimoDiaMes(hoy);
  const inicioMesAnterior = primerDiaMes(mesAnterior);
  const finMesAnterior = ultimoDiaMes(mesAnterior);

  const [
    estaSemana,
    semanaAnterior,
    gastosSemana,
    kpisMes,
    categoriasMes,
    acumuladoEsteMes,
    acumuladoMesAnterior,
    comerciosMes,
    gastosMes,
    resumenAnual,
    categoriaMensualAnio,
    diarioAnio,
    gastosAnio,
  ] = await Promise.all([
    supabase.rpc("gasto_acumulado_diario", { desde: toISO(lunesEsta), hasta: toISO(domingoEsta) }),
    supabase.rpc("gasto_acumulado_diario", { desde: toISO(lunesAnterior), hasta: toISO(domingoAnterior) }),
    supabase
      .from("movimientos")
      .select("id, descripcion, fecha, monto_ars, comercio, categorias(nombre, emoji)")
      .eq("tipo", "gasto")
      .gte("fecha", toISO(lunesEsta))
      .lte("fecha", toISO(domingoEsta))
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false }),
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
      .order("created_at", { ascending: false }),
    supabase.rpc("resumen_anual", { anio }),
    supabase.rpc("totales_categoria_mensual", { anio }),
    supabase.rpc("gasto_acumulado_diario", { desde: `${anio}-01-01`, hasta: `${anio}-12-31` }),
    supabase
      .from("movimientos")
      .select("id, descripcion, fecha, monto_ars, comercio, categorias(nombre, emoji)")
      .eq("tipo", "gasto")
      .gte("fecha", `${anio}-01-01`)
      .lte("fecha", `${anio}-12-31`)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <main className="flex-1">
      <ResumenSwitcher
        semana={{
          estaSemana: estaSemana.data ?? [],
          semanaAnterior: semanaAnterior.data ?? [],
          ultimosGastos: (gastosSemana.data ?? []) as unknown as Gasto[],
        }}
        mes={{
          kpis: kpisMes.data as Kpis,
          categorias: categoriasMes.data ?? [],
          acumuladoEsteMes: acumuladoEsteMes.data ?? [],
          acumuladoMesAnterior: acumuladoMesAnterior.data ?? [],
          comercios: comerciosMes.data ?? [],
          ultimosGastos: (gastosMes.data ?? []) as unknown as Gasto[],
          desde: inicioMes,
          hasta: finMes,
        }}
        anio={{
          anio,
          resumen: resumenAnual.data ?? [],
          categoriaMensual: categoriaMensualAnio.data ?? [],
          diario: diarioAnio.data ?? [],
          ultimosGastos: (gastosAnio.data ?? []) as unknown as Gasto[],
        }}
      />
    </main>
  );
}
