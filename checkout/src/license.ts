// License keys: PRODUCTCODE-XXXX-XXXX-XXXX-XXXX
// The last 16 characters are an HMAC over (product, invoice) so a key cannot be forged without LICENSE_SECRET.
// Verification also checks the D1 `licenses` table for revocation and expiry.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function toAlphabet(bytes: Uint8Array, len: number): string {
  let out = "";
  for (let i = 0; out.length < len; i++) out += ALPHABET[bytes[i % bytes.length] % ALPHABET.length];
  return out;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

export function productCode(productId: string): string {
  return productId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase().padEnd(3, "X");
}

export async function makeLicenseKey(secret: string, productId: string, invoiceId: string): Promise<string> {
  const mac = await hmac(secret, `${productId}|${invoiceId}`);
  const body = toAlphabet(mac, 16);
  return `${productCode(productId)}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
}

export function randomId(len = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return toAlphabet(bytes, len).toLowerCase();
}
