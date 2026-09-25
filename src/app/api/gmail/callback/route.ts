import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor, crearClienteServicio } from "@/lib/supabase/server";
import { intercambiarCodigo } from "@/lib/gmail";

export async function GET(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const destino = new URL("/presupuestos", request.url);

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const stateCookie = request.cookies.get("gmail_oauth_state")?.value;

  if (!code || !state || !stateCookie || state !== stateCookie) {
    destino.searchParams.set("gmail", "error");
    return NextResponse.redirect(destino);
  }

  try {
    const redirectUri = `${request.nextUrl.origin}/api/gmail/callback`;
    const { refreshToken } = await intercambiarCodigo(code, redirectUri);

    const supabaseServicio = crearClienteServicio();
    await supabaseServicio.from("gmail_integracion").upsert({
      usuario_id: user.id,
      refresh_token: refreshToken,
      activo: true,
    });

    destino.searchParams.set("gmail", "ok");
  } catch {
    destino.searchParams.set("gmail", "error");
  }

  const res = NextResponse.redirect(destino);
  res.cookies.delete("gmail_oauth_state");
  return res;
}
