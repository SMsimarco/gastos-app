import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { validarActivoAprender } from "@/lib/inversiones/aprenderActivos";

async function activoDelUsuario(supabase: Awaited<ReturnType<typeof crearClienteServidor>>, usuarioId: string, id: string) {
  const { data } = await supabase.from("activos").select("id, ticker").eq("id", id).eq("usuario_id", usuarioId).eq("bolsillo_clave", "aprender").maybeSingle();
  return data;
}

// Edita tesis, toma de ganancia y umbral de revisión (el ticker no se cambia: se quita y se vuelve a agregar).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  if (!(await activoDelUsuario(supabase, user.id, id))) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const validado = validarActivoAprender(body, false);
  if (!validado.ok) return NextResponse.json({ error: validado.error }, { status: 400 });
  const { tesis, toma_ganancia_pct, stop_revision_pct } = validado.datos;
  const { data, error } = await supabase.from("activos").update({ tesis, toma_ganancia_pct, stop_revision_pct }).eq("id", id).eq("usuario_id", user.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ activo: data });
}

// Quita el activo de la lista. Si ya tiene operaciones se saca de la política (queda el historial); si no, se borra.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  if (!(await activoDelUsuario(supabase, user.id, id))) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const { count } = await supabase.from("operaciones").select("id", { count: "exact", head: true }).eq("usuario_id", user.id).eq("activo_id", id);
  if ((count ?? 0) > 0) {
    const { error } = await supabase.from("activos").update({ en_politica: false }).eq("id", id).eq("usuario_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, accion: "sacado_de_la_lista", aviso: "Tiene operaciones: lo saqué de tu lista pero se conserva su historial." });
  }
  const { error } = await supabase.from("activos").delete().eq("id", id).eq("usuario_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, accion: "borrado" });
}
