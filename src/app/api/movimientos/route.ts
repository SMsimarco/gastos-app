import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const desde = params.get("desde");
  const hasta = params.get("hasta");
  const categoriaId = params.get("categoria_id");
  const metodoPago = params.get("metodo_pago");
  const comercio = params.get("comercio");
  const montoMin = params.get("monto_min");
  const montoMax = params.get("monto_max");

  let query = supabase
    .from("movimientos")
    .select("id, tipo, fecha, monto_ars, monto_usd, comercio, descripcion, metodo_pago, fuente, categoria_id, cuotas_total, cuota_nro, foto_path, categorias(nombre, emoji)")
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (desde) query = query.gte("fecha", desde);
  if (hasta) query = query.lte("fecha", hasta);
  if (categoriaId) query = query.eq("categoria_id", categoriaId);
  if (metodoPago) query = query.eq("metodo_pago", metodoPago);
  if (comercio) query = query.ilike("comercio", `%${comercio}%`);
  if (montoMin) query = query.gte("monto_ars", Number(montoMin));
  if (montoMax) query = query.lte("monto_ars", Number(montoMax));

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ movimientos: data });
}
