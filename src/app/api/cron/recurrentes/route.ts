import { NextRequest, NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/server";
import { enviarPush } from "@/lib/push";

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const supabase = crearClienteServicio();

  const hoyAR = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const diaDelMes = Number(hoyAR.split("-")[2]);

  const { data: recurrentes, error: errorLectura } = await supabase
    .from("recurrentes")
    .select("id, usuario_id, descripcion, monto, categoria_id, metodo_pago, ultima_ejecucion")
    .eq("activo", true)
    .eq("dia_del_mes", diaDelMes);

  if (errorLectura) {
    return NextResponse.json({ error: errorLectura.message }, { status: 500 });
  }

  const pendientes = (recurrentes ?? []).filter((r) => r.ultima_ejecucion !== hoyAR);

  const { data: tcRows } = await supabase
    .from("tipo_cambio")
    .select("oficial_venta")
    .order("fecha", { ascending: false })
    .limit(1);
  const tcUsado = tcRows && tcRows.length > 0 ? tcRows[0].oficial_venta : null;

  const porUsuario = new Map<string, string[]>();

  for (const r of pendientes) {
    const montoUsd = tcUsado ? Number((r.monto / tcUsado).toFixed(2)) : null;

    const { error: errorInsert } = await supabase.from("movimientos").insert({
      usuario_id: r.usuario_id,
      tipo: "gasto",
      fecha: hoyAR,
      monto_ars: r.monto,
      monto_usd: montoUsd,
      tc_usado: tcUsado,
      moneda_origen: "ARS",
      categoria_id: r.categoria_id,
      descripcion: r.descripcion,
      metodo_pago: r.metodo_pago,
      cuotas_total: 1,
      cuota_nro: 1,
      fuente: "recurrente",
      confianza: "alta",
    });

    if (errorInsert) continue;

    await supabase.from("recurrentes").update({ ultima_ejecucion: hoyAR }).eq("id", r.id);

    const lista = porUsuario.get(r.usuario_id) ?? [];
    lista.push(`${r.descripcion} — $${Math.round(r.monto).toLocaleString("es-AR")}`);
    porUsuario.set(r.usuario_id, lista);
  }

  await Promise.all(
    [...porUsuario.entries()].map(([usuarioId, items]) =>
      enviarPush(supabase, usuarioId, {
        title: "Recurrentes cargados hoy",
        body: items.join("\n"),
      })
    )
  );

  return NextResponse.json({ ok: true, cargados: pendientes.length });
}
