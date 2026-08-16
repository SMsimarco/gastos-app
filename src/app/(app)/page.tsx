import { crearClienteServidor } from "@/lib/supabase/server";
import { CapturaMovimientos } from "@/components/CapturaMovimientos";
import { PagosPendientes } from "@/components/PagosPendientes";
import { proximaFechaRecurrente } from "@/lib/pendientes";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await crearClienteServidor();

  const hoyAR = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });

  const inicioMes = `${hoyAR.slice(0, 7)}-01`;

  const [{ data: movimientos }, { data: kpis }, { data: cuotasPendientes }, { data: recurrentes }] =
    await Promise.all([
      supabase
        .from("movimientos")
        .select("id, tipo, monto_ars, descripcion, fecha, cuotas_total, cuota_nro, categorias(emoji, nombre)")
        .eq("fecha", hoyAR)
        .order("created_at", { ascending: false }),
      supabase.rpc("kpis_mes", { mes_inicio: inicioMes }).single(),
      supabase
        .from("movimientos")
        .select("id, descripcion, fecha, monto_ars, cuota_nro, cuotas_total, categorias(emoji, nombre)")
        .eq("tipo", "gasto")
        .gt("fecha", hoyAR)
        .gt("cuotas_total", 1)
        .order("fecha", { ascending: true }),
      supabase
        .from("recurrentes")
        .select("id, descripcion, monto, dia_del_mes, ultima_ejecucion")
        .eq("activo", true),
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

  const cuotasMapeadas = (cuotasPendientes ?? []).map((c) => {
    const categoria = c.categorias as unknown as { emoji: string; nombre: string } | null;
    return {
      id: c.id,
      descripcion: c.descripcion,
      fecha: c.fecha,
      monto_ars: c.monto_ars,
      cuota_nro: c.cuota_nro,
      cuotas_total: c.cuotas_total,
      categoriaEmoji: categoria?.emoji,
    };
  });

  const en7Dias = new Date();
  en7Dias.setDate(en7Dias.getDate() + 7);
  const limite7Dias = en7Dias.toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });

  const suscripcionesAVencer = (recurrentes ?? [])
    .map((r) => ({
      id: r.id,
      descripcion: r.descripcion,
      monto: r.monto,
      proximaFecha: proximaFechaRecurrente(r.dia_del_mes, r.ultima_ejecucion, hoyAR),
    }))
    .filter((r) => r.proximaFecha <= limite7Dias)
    .sort((a, b) => a.proximaFecha.localeCompare(b.proximaFecha));

  return (
    <main className="flex-1">
      <CapturaMovimientos
        movimientosIniciales={movimientosMapeados}
        totalHoy={totalHoy}
        promedioDiario={promedioDiario}
      />
      <PagosPendientes cuotas={cuotasMapeadas} suscripciones={suscripcionesAVencer} />
    </main>
  );
}
