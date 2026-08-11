import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const esApi = request.nextUrl.pathname.startsWith("/api/");
  const esAuthCallback = request.nextUrl.pathname.startsWith("/auth/");
  const esAuthPage =
    request.nextUrl.pathname.startsWith("/login") || request.nextUrl.pathname.startsWith("/signup");

  // Las API routes validan su propia auth (sesion de usuario o CRON_SECRET) — el proxy no interviene.
  // /auth/callback corre justo cuando todavia no hay sesion (se esta creando ahi mismo).
  if (esApi || esAuthCallback) return response;

  if (!user && !esAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && esAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:ico|png|jpg|jpeg|svg|webp|json|js|txt)$).*)",
  ],
};
