import { crearClienteServidor } from "@/lib/supabase/server";
import { CapturaMovimientos } from "@/components/CapturaMovimientos";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await crearClienteServidor();

  const hoyAR = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });

  const inicioMes = `${hoyAR.slice(0, 7)}-01`;

  const [{ data: movimientos }, { data: kpis }] = await Promise.all([
    supabase
      .from("movimientos")
      .select("id, tipo, monto_ars, descripcion, fecha, cuotas_total, cuota_nro, categorias(emoji, nombre)")
      .eq("fecha", hoyAR)
      .order("created_at", { ascending: false }),
    supabase.rpc("kpis_mes", { mes_inicio: inicioMes }).single(),
  ]);

  const movimientosMapeados = (movimientos ?? []).map((m) => {
    const categoria = m.categorias as unknown as { emoji: string; nombre: string } | null;
    return {
      id: m.id,
      tipo: m.tipo,
      monto_ars: m.monto_ars,
      descripcion: m.descripcion,
      fecha: m.fecha,
      cuotas_total: m.cuotas_total,
      cuota_nro: m.cuota_nro,
      categoriaEmoji: categoria?.emoji,
      categoriaNombre: categoria?.nombre,
    };
  });

  const totalHoy = movimientosMapeados
    .filter((m) => m.tipo === "gasto")
    .reduce((acc, m) => acc + m.monto_ars, 0);

  const promedioDiario = (kpis as { promedio_diario: number } | null)?.promedio_diario ?? null;

  return (
    <main className="flex-1">
      <CapturaMovimientos
        movimientosIniciales={movimientosMapeados}
        totalHoy={totalHoy}
        promedioDiario={promedioDiario}
      />
    </main>
  );
}
