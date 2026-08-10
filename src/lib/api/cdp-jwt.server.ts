/**
 * Coinbase Developer Platform (CDP) request auth.
 *
 * CDP does not accept a static bearer token: every call carries a short-lived
 * JWT signed with the API key secret and scoped to the exact method + host +
 * path being called. Both key formats CDP issues are supported:
 *   - Ed25519 ("EdDSA"): base64 64-byte secret (32-byte seed || 32-byte pub)
 *   - EC P-256 ("ES256"): PEM-encoded PKCS#8 private key
 *
 * Env is read at call time because the Worker runtime injects it per request.
 */

const b64uEncode = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64Decode = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const jsonSegment = (value: unknown) => b64uEncode(new TextEncoder().encode(JSON.stringify(value)));

/** Wraps a raw Ed25519 seed in the minimal PKCS#8 DER envelope WebCrypto expects. */
function ed25519Pkcs8(seed: Uint8Array): Uint8Array {
  const prefix = Uint8Array.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  const out = new Uint8Array(prefix.length + 32);
  out.set(prefix, 0);
  out.set(seed.subarray(0, 32), prefix.length);
  return out;
}

function pemToDer(pem: string): Uint8Array {
  return b64Decode(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
}

export type CdpCredentials = { keyId: string; secret: string };

export function cdpCredentials(): CdpCredentials | null {
  const keyId = process.env["CDP_API_KEY_ID"]?.trim();
  const secret = process.env["CDP_API_KEY_SECRET"]?.trim();
  if (!keyId || !secret) return null;
  return { keyId, secret };
}

/**
 * Mints a 2-minute JWT bound to one request (`POST host/path`), as CDP requires.
 */
export async function cdpJwt(
  credentials: CdpCredentials,
  method: string,
  host: string,
  path: string,
): Promise<string> {
  const isPem = credentials.secret.includes("BEGIN");
  const alg = isPem ? "ES256" : "EdDSA";

  const key = isPem
    ? await crypto.subtle.importKey(
        "pkcs8",
        pemToDer(credentials.secret) as unknown as ArrayBuffer,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
      )
    : await crypto.subtle.importKey(
        "pkcs8",
        ed25519Pkcs8(b64Decode(credentials.secret)) as unknown as ArrayBuffer,
        { name: "Ed25519" },
        false,
        ["sign"],
      );

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg,
    kid: credentials.keyId,
    typ: "JWT",
    nonce: crypto.randomUUID().replace(/-/g, ""),
  };
  const payload = {
    iss: "cdp",
    sub: credentials.keyId,
    nbf: now,
    exp: now + 120,
    uris: [`${method.toUpperCase()} ${host}${path}`],
  };

  const signingInput = `${jsonSegment(header)}.${jsonSegment(payload)}`;
  const signature = await crypto.subtle.sign(
    isPem ? { name: "ECDSA", hash: "SHA-256" } : { name: "Ed25519" },
    key,
    new TextEncoder().encode(signingInput) as unknown as ArrayBuffer,
  );

  return `${signingInput}.${b64uEncode(new Uint8Array(signature))}`;
}
