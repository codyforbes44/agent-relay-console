/**
 * Server-side secret vault for OAuth tokens.
 *
 * Tokens are encrypted with AES-256-GCM before they touch Postgres. The data
 * key comes from the OAUTH_VAULT_KEY environment variable (64 hex chars).
 * Ciphertext format: `v1:<base64url iv>:<base64url payload>`.
 *
 * The vault key lives in Lovable Cloud secrets (Cloud -> Secrets -> Add) and
 * is never exposed to the browser or the agent API.
 */

const PREFIX = "v1";

function vaultKeyBytes(): Uint8Array<ArrayBuffer> {
  const hex = process.env["OAUTH_VAULT_KEY"] ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "OAUTH_VAULT_KEY is not configured: set a 64-char hex (32-byte) key in server secrets.",
    );
  }
  const bytes = new Uint8Array(new ArrayBuffer(32));
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

let cachedKey: CryptoKey | null = null;

async function vaultKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = await crypto.subtle.importKey(
      "raw",
      vaultKeyBytes(),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  return cachedKey;
}

function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Encrypts a plaintext secret for storage. */
export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await vaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${PREFIX}:${toB64Url(iv)}:${toB64Url(new Uint8Array(ct))}`;
}

/** Decrypts a value produced by encryptSecret. Throws on tamper/format errors. */
export async function decryptSecret(ciphertext: string): Promise<string> {
  const [prefix, ivB64, ctB64] = ciphertext.split(":");
  if (prefix !== PREFIX || !ivB64 || !ctB64) {
    throw new Error("Unrecognized vault payload format");
  }
  const key = await vaultKey();
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64Url(ivB64) },
    key,
    fromB64Url(ctB64),
  );
  return new TextDecoder().decode(pt);
}
