import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { registrarOperacion } from "@/lib/inversiones/carteraData";

export async function POST(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  try {
    const operacion = await registrarOperacion(supabase, user.id, {
      activoId: body.activo_id,
      ticker: body.ticker,
      tipo: body.tipo ?? "compra",
      fecha: body.fecha,
      cantidad: body.cantidad === undefined ? undefined : Number(body.cantidad),
      precioUsd: Number(body.precio_usd),
      montoUsd: Number(body.monto_usd),
      comisionUsd: Number(body.comision_usd ?? 0),
      nota: body.nota,
    });
    return NextResponse.json({ operacion }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No pude registrar la operación" }, { status: 400 });
  }
}
