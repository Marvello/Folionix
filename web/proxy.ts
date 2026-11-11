import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";

// Per-request nonce CSP (Next applies the nonce to its own scripts; the root
// layout reads x-nonce for the window.__ENV script). Styles stay
// 'unsafe-inline': React style={} attributes can't carry a nonce, and style
// injection is far lower risk than script. Images allow any https host for
// news thumbnails (rendered with referrerPolicy="no-referrer").
function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";
  // SSO sign-in is a form POST that redirects to the IdP — form-action must allow it.
  const issuer = process.env.AUTH_AUTHENTIK_ISSUER;
  const idp = issuer ? ` ${new URL(issuer).origin}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self'${idp}`,
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const session = await auth();
  const path = request.nextUrl.pathname;
  // /api/weekly-reviews is token-guarded in the route itself (bearer), not by
  // the session gate — the local /aireview loop calls it headlessly.
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/api/auth") ||
    path.startsWith("/api/weekly-reviews") ||
    path === "/api/health";

  if (!session && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Everything goes through the gate except Next's build assets and the public
  // brand files the login page needs. (A generic image-suffix exclusion would
  // let any route ending in .png skip auth.)
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico$|icon\\.svg$|logo/).*)"],
};
