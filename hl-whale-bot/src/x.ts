// Optional cross-posting of channel alerts to X (Twitter) with OAuth 1.0a user context.
// Needs X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET (free tier allows 1,500 posts/month).

export interface XEnv {
  X_API_KEY?: string;
  X_API_SECRET?: string;
  X_ACCESS_TOKEN?: string;
  X_ACCESS_SECRET?: string;
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

async function hmacSha1(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** Builds the OAuth 1.0a Authorization header. `params` are query/form params that take part in signing. */
export async function oauthHeader(
  creds: { key: string; secret: string; token: string; tokenSecret: string },
  method: string,
  url: string,
  params: Record<string, string>,
  nonce = crypto.randomUUID().replace(/-/g, ""),
  timestamp = String(Math.floor(Date.now() / 1000)),
): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.key,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.token,
    oauth_version: "1.0",
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all)
    .map((k) => [enc(k), enc(all[k])] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = `${method.toUpperCase()}&${enc(url)}&${enc(paramString)}`;
  const signingKey = `${enc(creds.secret)}&${enc(creds.tokenSecret)}`;
  const signature = await hmacSha1(signingKey, base);
  const header: Record<string, string> = { ...oauth, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(header)
      .sort()
      .map((k) => `${enc(k)}="${enc(header[k])}"`)
      .join(", ")
  );
}

export function xEnabled(env: XEnv): boolean {
  return Boolean(env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET);
}

/** Posts a tweet via API v2. Returns the tweet id or null; never throws. */
export async function postToX(env: XEnv, text: string): Promise<string | null> {
  if (!xEnabled(env)) return null;
  try {
    const url = "https://api.x.com/2/tweets";
    const auth = await oauthHeader({ key: env.X_API_KEY!, secret: env.X_API_SECRET!, token: env.X_ACCESS_TOKEN!, tokenSecret: env.X_ACCESS_SECRET! }, "POST", url, {});
    const res = await fetch(url, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ text: text.slice(0, 280) }) });
    if (!res.ok) {
      console.log(`x post failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const j = (await res.json()) as { data?: { id: string } };
    return j.data?.id ?? null;
  } catch (e) {
    console.log(`x post error: ${(e as Error).message}`);
    return null;
  }
}
