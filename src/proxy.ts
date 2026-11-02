import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { pageForPath, allowed, type PageAccess } from "@/lib/page-access";

const PUBLIC = ["/login", "/forgot-password", "/auth/confirm", "/api/whatsapp/webhook", "/api/whatsapp/gateway", "/api/facebook/webhook", "/api/jobs/run", "/api/jobs/email", "/signup", "/f", "/s", "/api/billing/razorpay/webhook", "/api/billing/razorpay/callback", "/sw.js", "/q", "/api/pay/razorpay", "/paid", "/o", "/p", "/b", "/r", "/ref", "/api/hooks", "/api/widget", "/api/v1", "/api/ivr", "/developers"];

// Refreshes the Supabase session cookie and redirects anonymous users.
// Authorization itself is enforced by RLS and server checks, not here.
export async function proxy(request: NextRequest) {
  // The app layout reads the path to apply page-wise role access (Admin → Roles & permissions).
  request.headers.set("x-lb-path", request.nextUrl.pathname);
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + "/"));
  if (!data?.claims && !isPublic) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  // Page-wise role access (Admin → Roles & permissions → Page access). The RPC returns {} for admins and for
  // companies that never restricted anything, so nothing changes for them.
  const page = data?.claims && !isPublic ? pageForPath(path) : null;
  if (page) {
    const { data: access, error } = await supabase.rpc("lb_my_page_access");
    if (!error && access && typeof access === "object" && !allowed(access as PageAccess, page)) {
      if (path.startsWith("/api/")) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
      const url = request.nextUrl.clone();
      url.pathname = "/no-access";
      url.search = "";
      const denied = NextResponse.redirect(url);
      response.cookies.getAll().forEach((c) => denied.cookies.set(c));
      return denied;
    }
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
