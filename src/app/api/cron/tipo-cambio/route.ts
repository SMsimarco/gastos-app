import { NextRequest, NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let blueVenta: number;
  let oficialVenta: number;
  try {
    const res = await fetch("https://dolarapi.com/v1/dolares", { cache: "no-store" });
    const data: Array<{ casa: string; venta: number }> = await res.json();
    const blue = data.find((d) => d.casa === "blue");
    const oficial = data.find((d) => d.casa === "oficial");
    if (!blue || !oficial) throw new Error("dolarapi no devolvió blue/oficial");
    blueVenta = blue.venta;
    oficialVenta = oficial.venta;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error consultando dolarapi" },
      { status: 502 }
    );
  }

  const hoyAR = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });

  const supabase = crearClienteServicio();
  const { error } = await supabase
    .from("tipo_cambio")
    .upsert({ fecha: hoyAR, blue_venta: blueVenta, oficial_venta: oficialVenta }, { onConflict: "fecha" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, fecha: hoyAR, blueVenta, oficialVenta });
}
