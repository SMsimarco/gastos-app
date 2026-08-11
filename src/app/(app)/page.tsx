import { crearClienteServidor } from "@/lib/supabase/server";
import { CapturaMovimientos } from "@/components/CapturaMovimientos";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await crearClienteServidor();

  const hoyAR = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });

  const { data: movimientos } = await supabase
    .from("movimientos")
    .select("id, tipo, monto_ars, descripcion, fecha, categorias(emoji, nombre)")
    .eq("fecha", hoyAR)
    .order("created_at", { ascending: false });

  const movimientosMapeados = (movimientos ?? []).map((m) => {
    const categoria = m.categorias as unknown as { emoji: string; nombre: string } | null;
    return {
      id: m.id,
      tipo: m.tipo,
      monto_ars: m.monto_ars,
      descripcion: m.descripcion,
      fecha: m.fecha,
      categoriaEmoji: categoria?.emoji,
      categoriaNombre: categoria?.nombre,
    };
  });

  return (
    <main className="flex-1">
      <CapturaMovimientos movimientosIniciales={movimientosMapeados} />
    </main>
  );
}
