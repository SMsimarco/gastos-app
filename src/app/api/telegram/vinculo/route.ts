import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

async function sesion() {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const { supabase, user } = await sesion();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const [{ data: vinculo }, { data: codigo }] = await Promise.all([
    supabase.from("telegram_vinculos").select("created_at").eq("usuario_id", user.id).maybeSingle(),
    supabase.from("telegram_codigos_vinculacion").select("codigo, expira_at").eq("usuario_id", user.id).eq("usado", false).gt("expira_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return NextResponse.json({ vinculado: Boolean(vinculo), codigo: codigo?.codigo ?? null, expiraAt: codigo?.expira_at ?? null });
}

export async function POST() {
  const { supabase, user } = await sesion();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  await supabase.from("telegram_codigos_vinculacion").delete().eq("usuario_id", user.id).eq("usado", false);
  for (let intento = 0; intento < 5; intento++) {
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiraAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const { error } = await supabase.from("telegram_codigos_vinculacion").insert({ codigo, usuario_id: user.id, expira_at: expiraAt });
    if (!error) return NextResponse.json({ codigo, expiraAt });
    if (error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ error: "No pude generar el código" }, { status: 503 });
}

export async function DELETE() {
  const { supabase, user } = await sesion();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { error } = await supabase.from("telegram_vinculos").delete().eq("usuario_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

