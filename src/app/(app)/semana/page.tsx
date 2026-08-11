import { crearClienteServidor } from "@/lib/supabase/server";
import { GraficoSemana } from "@/components/GraficoSemana";

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

export default async function SemanaPage() {
  const supabase = await crearClienteServidor();

  const hoyStr = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const hoy = aFecha(hoyStr);

  const lunesEsta = lunesDeEstaSemana(hoy);
  const domingoEsta = new Date(lunesEsta);
  domingoEsta.setUTCDate(lunesEsta.getUTCDate() + 6);

  const lunesAnterior = new Date(lunesEsta);
  lunesAnterior.setUTCDate(lunesEsta.getUTCDate() - 7);
  const domingoAnterior = new Date(lunesAnterior);
  domingoAnterior.setUTCDate(lunesAnterior.getUTCDate() + 6);

  const [estaSemana, semanaAnterior] = await Promise.all([
    supabase.rpc("gasto_acumulado_diario", {
      desde: toISO(lunesEsta),
      hasta: toISO(domingoEsta),
    }),
    supabase.rpc("gasto_acumulado_diario", {
      desde: toISO(lunesAnterior),
      hasta: toISO(domingoAnterior),
    }),
  ]);

  return (
    <main className="flex-1">
      <GraficoSemana
        estaSemana={estaSemana.data ?? []}
        semanaAnterior={semanaAnterior.data ?? []}
      />
    </main>
  );
}
