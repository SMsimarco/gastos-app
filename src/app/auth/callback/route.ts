import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const errorDescription = request.nextUrl.searchParams.get("error_description");

  if (errorDescription) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", errorDescription);
    return NextResponse.redirect(url);
  }

  if (code) {
    const supabase = await crearClienteServidor();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const url = new URL("/login", request.url);
      url.searchParams.set("error", error.message);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.redirect(new URL("/", request.url));
}
