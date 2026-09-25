import { NextRequest, NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/server";
import { sincronizarGmailUsuario } from "@/lib/gmailSync";

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const supabase = crearClienteServicio();

  const { data: usuarios, error } = await supabase
    .from("gmail_integracion")
    .select("usuario_id")
    .eq("activo", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const resultados = await Promise.all(
    (usuarios ?? []).map(async (u) => {
      try {
        const r = await sincronizarGmailUsuario(supabase, u.usuario_id);
        return { usuario_id: u.usuario_id, ...r };
      } catch (e) {
        return { usuario_id: u.usuario_id, error: e instanceof Error ? e.message : "error" };
      }
    })
  );

  return NextResponse.json({ ok: true, usuarios: resultados.length, resultados });
}
