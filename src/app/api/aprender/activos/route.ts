import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { mensajeFueraDeLaboratorio, tipoDeTicker, validarActivoAprender } from "@/lib/inversiones/aprenderActivos";

// Suma un activo a la lista de aprender. Exige tesis escrita y que el laboratorio tenga datos del ticker.
export async function POST(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  const validado = validarActivoAprender(body);
  if (!validado.ok) return NextResponse.json({ error: validado.error }, { status: 400 });
  const { ticker, tesis, nombre, toma_ganancia_pct, stop_revision_pct } = validado.datos;

  // El laboratorio solo sigue su universo: si no tiene datos del ticker no hay con qué evaluarlo.
  const { data: indicador } = await supabase.from("lab_indicadores").select("ticker").eq("ticker", ticker).limit(1).maybeSingle();
  if (!indicador) return NextResponse.json({ error: mensajeFueraDeLaboratorio(ticker), fueraDelLaboratorio: true }, { status: 422 });

  const { data: existente } = await supabase.from("activos").select("id, bolsillo_clave").eq("usuario_id", user.id).eq("ticker", ticker).maybeSingle();
  if (existente && existente.bolsillo_clave !== "aprender") {
    return NextResponse.json({ error: `${ticker} ya está en tu plan en otro bolsillo; no se puede mover a aprender desde acá.` }, { status: 409 });
  }
  const campos = { tesis, toma_ganancia_pct, stop_revision_pct, en_politica: true };
  const consulta = existente
    ? supabase.from("activos").update(campos).eq("id", existente.id).eq("usuario_id", user.id)
    : supabase.from("activos").insert({ usuario_id: user.id, ticker, nombre, tipo: tipoDeTicker(ticker), moneda: "USD", bolsillo_clave: "aprender", ...campos });
  const { data, error } = await consulta.select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ activo: data }, { status: existente ? 200 : 201 });
}
