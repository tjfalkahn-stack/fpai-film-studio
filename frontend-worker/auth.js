import { createRemoteJWKSet, jwtVerify } from "jose";
const sets = new Map();
export async function authorizeStudio(request, env) {
  const url = new URL(request.url);
  // Explicit local mode can never authorize a public hostname.
  if (
    env.LOCAL_DEV === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return true;
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN))
    return false;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return false;
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  if (!sets.has(issuer))
    sets.set(
      issuer,
      createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
    );
  try {
    await jwtVerify(token, sets.get(issuer), {
      issuer,
      audience: env.ACCESS_AUD,
    });
    return true;
  } catch {
    return false;
  }
}
