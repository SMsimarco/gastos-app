import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { urlAutorizacion } from "@/lib/gmail";

export async function GET(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const state = crypto.randomUUID();
  const redirectUri = `${request.nextUrl.origin}/api/gmail/callback`;

  let urlGoogle: string;
  try {
    urlGoogle = urlAutorizacion(redirectUri, state);
  } catch {
    const destino = new URL("/presupuestos", request.url);
    destino.searchParams.set("gmail", "error");
    return NextResponse.redirect(destino);
  }

  const res = NextResponse.redirect(urlGoogle);
  res.cookies.set("gmail_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });
  return res;
}
