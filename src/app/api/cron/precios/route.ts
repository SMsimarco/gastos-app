import { NextRequest, NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/server";
import { obtenerPreciosTwelveData } from "@/lib/inversiones/precios";

export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!process.env.TWELVE_DATA_API_KEY) {
    return NextResponse.json({ error: "Falta TWELVE_DATA_API_KEY" }, { status: 503 });
  }

  const supabase = crearClienteServicio();
  const { data: activos, error } = await supabase
    .from("activos")
    .select("ticker")
    .neq("tipo", "cuenta_remunerada")
    .eq("en_politica", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tickers = [...new Set((activos ?? []).map((activo) => activo.ticker))];
  const resultados = await Promise.all(tickers.map(async (ticker) => {
    try {
      const precios = await obtenerPreciosTwelveData(ticker, process.env.TWELVE_DATA_API_KEY!);
      const { error: errorUpsert } = await supabase.from("precios").upsert(precios, { onConflict: "ticker,fecha" });
      if (errorUpsert) throw new Error(errorUpsert.message);
      return { ticker, ok: true, fecha: precios.at(-1)?.fecha, registros: precios.length };
    } catch (errorTicker) {
      const { data: ultimo } = await supabase
        .from("precios")
        .select("fecha")
        .eq("ticker", ticker)
        .order("fecha", { ascending: false })
        .limit(1)
        .maybeSingle();
      return {
        ticker,
        ok: false,
        ultimoPrecioGuardado: ultimo?.fecha ?? null,
        error: errorTicker instanceof Error ? errorTicker.message : "Error desconocido",
      };
    }
  }));

  return NextResponse.json({ ok: resultados.every((resultado) => resultado.ok), resultados });
}
