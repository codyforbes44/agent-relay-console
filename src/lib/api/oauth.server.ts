import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptSecret, encryptSecret } from "./vault.server";

/**
 * Managed OAuth: workspace-scoped connections to third-party providers.
 *
 * An agent calls POST /oauth/{provider}/authorize to get an authorization URL,
 * a human completes the provider's consent screen, the provider redirects to
 * /oauth/callback, and the encrypted tokens land in oauth_connections. From
 * then on, connected tools (gmail_send, slack_post_message, github_create_issue)
 * act as that workspace's identity — the agent never sees a token.
 *
 * Token ciphertext is AES-256-GCM (see vault.server.ts); the vault key lives
 * in server secrets. Provider client ids/secrets come from
 * OAUTH_<PROVIDER>_CLIENT_ID / OAUTH_<PROVIDER>_CLIENT_SECRET.
 */

export class OAuthRequiredError extends Error {
  provider: string;
  constructor(provider: string, message?: string) {
    super(message ?? `No connected ${provider} account for this workspace.`);
    this.name = "OAuthRequiredError";
    this.provider = provider;
  }
}

export type OAuthProviderInfo = {
  slug: string;
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl: string | null;
  defaultScopes: string[];
  docsUrl: string | null;
};

export type OAuthConnectionView = {
  id: string;
  provider: string;
  providerName: string;
  accountLabel: string;
  scopes: string[];
  status: "active" | "revoked" | "expired";
  expiresAt: string | null;
  createdAt: string;
};

const STATE_TTL_MINUTES = 15;
const REFRESH_SKEW_SECONDS = 60;

/** Pure: env var names for a provider's OAuth app credentials. */
export function oauthClientEnvNames(slug: string): { id: string; secret: string } {
  const upper = slug.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return { id: `OAUTH_${upper}_CLIENT_ID`, secret: `OAUTH_${upper}_CLIENT_SECRET` };
}

/** Pure: the redirect URI agents' humans return to after provider consent. */
export function oauthRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/public/v1/oauth/callback`;
}

/** Pure: 32-hex-char CSRF state for the authorize dance. */
export function newOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Pure: builds the provider authorization URL (no I/O). */
export function buildProviderAuthorizeUrl(input: {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  providerSlug?: string;
}): string {
  const url = new URL(input.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scope);
  url.searchParams.set("state", input.state);
  if (input.providerSlug === "google") {
    // Without these Google only returns a refresh token on the very first
    // consent; repeat connects would silently lose offline access.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  return url.toString();
}

/** Pure: true when the token is expired or expires within the skew window. */
export function isTokenExpiring(
  expiresAt: string | null,
  skewSeconds = REFRESH_SKEW_SECONDS,
): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < skewSeconds * 1000;
}

function providerCredentials(slug: string): { clientId: string; clientSecret: string } {
  const names = oauthClientEnvNames(slug);
  const clientId = process.env[names.id] ?? "";
  const clientSecret = process.env[names.secret] ?? "";
  if (!clientId || !clientSecret) {
    throw new Error(
      `oauth_provider_not_configured: ${slug} needs ${names.id} and ${names.secret} in server secrets`,
    );
  }
  return { clientId, clientSecret };
}

function rowToProvider(row: Record<string, unknown>): OAuthProviderInfo {
  return {
    slug: String(row["slug"]),
    name: String(row["name"]),
    authorizeUrl: String(row["authorize_url"]),
    tokenUrl: String(row["token_url"]),
    revokeUrl: (row["revoke_url"] as string | null) ?? null,
    defaultScopes: (row["default_scopes"] as string[]) ?? [],
    docsUrl: (row["docs_url"] as string | null) ?? null,
  };
}

async function getProvider(admin: SupabaseClient, slug: string): Promise<OAuthProviderInfo | null> {
  const { data, error } = await admin
    .from("oauth_providers")
    .select("*")
    .eq("slug", slug)
    .eq("enabled", true)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToProvider(data as Record<string, unknown>) : null;
}

/**
 * Starts the OAuth dance for a workspace: stores a CSRF state and returns the
 * provider authorization URL for a human to open.
 */
export async function buildAuthorizeUrl(
  admin: SupabaseClient,
  input: { provider: string; orgId: string; keyId: string | null; origin: string },
): Promise<{ url: string; expiresAt: string }> {
  const provider = await getProvider(admin, input.provider);
  if (!provider) {
    throw new Error(`oauth_provider_unknown: no such provider '${input.provider}'`);
  }
  const { clientId } = providerCredentials(provider.slug);
  const redirectUri = oauthRedirectUri(input.origin);
  const state = newOAuthState();
  const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60_000).toISOString();

  const { error } = await admin.from("oauth_states").insert({
    state,
    org_id: input.orgId,
    key_id: input.keyId,
    provider_slug: provider.slug,
    expires_at: expiresAt,
  });
  if (error) throw error;

  return {
    url: buildProviderAuthorizeUrl({
      authorizeUrl: provider.authorizeUrl,
      clientId,
      redirectUri,
      scope: provider.defaultScopes.join(" "),
      state,
      providerSlug: provider.slug,
    }),
    expiresAt,
  };
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function exchangeCode(
  provider: OAuthProviderInfo,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const { clientId, clientSecret } = providerCredentials(provider.slug);
  const res = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // GitHub's token endpoint defaults to form-encoded unless asked.
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(
      `oauth_callback_failed: token exchange failed for ${provider.slug}: ${data.error_description ?? data.error ?? res.status}`,
    );
  }
  return data;
}

/** Resolves a human-readable account label from the fresh access token. */
async function fetchAccountLabel(
  provider: OAuthProviderInfo,
  accessToken: string,
): Promise<string> {
  // GitHub's API rejects requests without a User-Agent header (403); send one
  // on every provider call for good hygiene.
  const headers = {
    authorization: `Bearer ${accessToken}`,
    "user-agent": "RelayOAuth/1.0 (+https://3bi.ai)",
  };
  try {
    if (provider.slug === "google") {
      // The OAuth userinfo endpoint only returns the email claim when the
      // `email` scope is granted, which we deliberately do not request.
      // The Gmail profile endpoint works with the gmail.send scope alone.
      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers,
      });
      if (res.ok) {
        const data = (await res.json()) as { emailAddress?: string };
        if (data.emailAddress) return data.emailAddress;
      } else {
        console.warn(`[oauth] account label lookup failed for google: ${res.status}`);
      }
    } else if (provider.slug === "github") {
      const res = await fetch("https://api.github.com/user", {
        headers: { ...headers, accept: "application/vnd.github+json" },
      });
      if (res.ok) {
        const data = (await res.json()) as { login?: string };
        if (data.login) return data.login;
      } else {
        console.warn(`[oauth] account label lookup failed for github: ${res.status}`);
      }
    } else if (provider.slug === "slack") {
      const res = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
      });
      if (res.ok) {
        const data = (await res.json()) as { ok?: boolean; user?: string; team?: string };
        if (data.ok && data.user) return data.team ? `${data.user}@${data.team}` : data.user;
        console.warn(`[oauth] account label lookup failed for slack: ok=${data.ok}`);
      } else {
        console.warn(`[oauth] account label lookup failed for slack: ${res.status}`);
      }
    }
  } catch (err) {
    console.warn(`[oauth] account label lookup threw for ${provider.slug}:`, err);
  }
  return `${provider.slug}-account-${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Completes the OAuth dance: validates and consumes the CSRF state, exchanges
 * the code, and stores the encrypted tokens as a workspace connection.
 */
export async function handleOAuthCallback(
  admin: SupabaseClient,
  input: { code: string; state: string; origin: string },
): Promise<{ provider: string; accountLabel: string }> {
  // Atomic consume: exactly one callback wins the state.
  const { data: stateRow, error: stateError } = await admin
    .from("oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state", input.state)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("org_id, key_id, provider_slug")
    .maybeSingle();
  if (stateError) throw stateError;
  if (!stateRow) {
    throw new Error(
      "oauth_state_invalid: authorization state is unknown, expired, or already used",
    );
  }
  const s = stateRow as Record<string, unknown>;
  const orgId = String(s["org_id"]);
  const keyId = (s["key_id"] as string | null) ?? null;
  const slug = String(s["provider_slug"]);

  const provider = await getProvider(admin, slug);
  if (!provider) throw new Error(`oauth_provider_unknown: no such provider '${slug}'`);

  const tokens = await exchangeCode(provider, input.code, oauthRedirectUri(input.origin));
  const accountLabel = await fetchAccountLabel(provider, tokens.access_token as string);
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  const { error: upsertError } = await admin.from("oauth_connections").upsert(
    {
      org_id: orgId,
      provider_slug: provider.slug,
      account_label: accountLabel,
      access_token_enc: await encryptSecret(tokens.access_token as string),
      refresh_token_enc: tokens.refresh_token
        ? await encryptSecret(tokens.refresh_token)
        : undefined,
      expires_at: expiresAt,
      scopes: provider.defaultScopes,
      status: "active",
      created_by_key_id: keyId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,provider_slug,account_label" },
  );
  if (upsertError) throw upsertError;

  return { provider: provider.slug, accountLabel };
}

/** Best-effort refresh; marks the connection expired and throws when it fails. */
async function refreshConnectionToken(
  admin: SupabaseClient,
  connectionId: string,
  provider: OAuthProviderInfo,
  refreshTokenEnc: string,
): Promise<string> {
  const { clientId, clientSecret } = providerCredentials(provider.slug);
  try {
    const refreshToken = await decryptSecret(refreshTokenEnc);
    const res = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    const data = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok || data.error || !data.access_token)
      throw new Error(data.error ?? `token refresh failed (HTTP ${res.status})`);
    await admin
      .from("oauth_connections")
      .update({
        access_token_enc: await encryptSecret(data.access_token),
        ...(data.refresh_token
          ? { refresh_token_enc: await encryptSecret(data.refresh_token) }
          : {}),
        expires_at: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);
    return data.access_token;
  } catch {
    await admin.from("oauth_connections").update({ status: "expired" }).eq("id", connectionId);
    throw new OAuthRequiredError(
      provider.slug,
      `The ${provider.name} connection expired and could not be refreshed. Reconnect it: POST /api/public/v1/oauth/${provider.slug}/authorize`,
    );
  }
}

/**
 * Returns a live access token for the workspace's most recently connected
 * active account on a provider. Throws OAuthRequiredError when no usable
 * connection exists — connected tools let this propagate so the route can
 * answer 409 with reconnect instructions.
 */
export async function getConnectionToken(
  admin: SupabaseClient,
  orgId: string,
  providerSlug: string,
): Promise<string> {
  const provider = await getProvider(admin, providerSlug);
  if (!provider)
    throw new OAuthRequiredError(providerSlug, `Unknown OAuth provider '${providerSlug}'`);

  const { data, error } = await admin
    .from("oauth_connections")
    .select("id, access_token_enc, refresh_token_enc, expires_at")
    .eq("org_id", orgId)
    .eq("provider_slug", providerSlug)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new OAuthRequiredError(
      providerSlug,
      `No connected ${provider.name} account for this workspace. Connect one: POST /api/public/v1/oauth/${providerSlug}/authorize`,
    );
  }
  const row = data as Record<string, unknown>;
  const connectionId = String(row["id"]);
  const expiresAt = (row["expires_at"] as string | null) ?? null;

  if (isTokenExpiring(expiresAt)) {
    const refreshEnc = (row["refresh_token_enc"] as string | null) ?? null;
    if (!refreshEnc) {
      await admin.from("oauth_connections").update({ status: "expired" }).eq("id", connectionId);
      throw new OAuthRequiredError(
        providerSlug,
        `The ${provider.name} connection expired. Reconnect it: POST /api/public/v1/oauth/${providerSlug}/authorize`,
      );
    }
    return refreshConnectionToken(admin, connectionId, provider, refreshEnc);
  }

  return decryptSecret(String(row["access_token_enc"]));
}

/** Connection metadata for a workspace. Ciphertext never leaves this module. */
export async function listConnections(
  admin: SupabaseClient,
  orgId: string,
): Promise<OAuthConnectionView[]> {
  const [{ data: conns, error: connError }, { data: providers, error: provError }] =
    await Promise.all([
      admin
        .from("oauth_connections")
        .select("id, provider_slug, account_label, scopes, status, expires_at, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),
      admin.from("oauth_providers").select("slug, name").eq("enabled", true),
    ]);
  if (connError) throw connError;
  if (provError) throw provError;
  const names = new Map(
    ((providers ?? []) as Record<string, unknown>[]).map((p) => [
      String(p["slug"]),
      String(p["name"]),
    ]),
  );
  return ((conns ?? []) as Record<string, unknown>[]).map((c) => ({
    id: String(c["id"]),
    provider: String(c["provider_slug"]),
    providerName: names.get(String(c["provider_slug"])) ?? String(c["provider_slug"]),
    accountLabel: String(c["account_label"]),
    scopes: (c["scopes"] as string[]) ?? [],
    status: c["status"] as OAuthConnectionView["status"],
    expiresAt: (c["expires_at"] as string | null) ?? null,
    createdAt: String(c["created_at"]),
  }));
}

/** Revokes a workspace connection (local status flip; provider-side revocation is best-effort). */
export async function revokeConnection(
  admin: SupabaseClient,
  orgId: string,
  connectionId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("oauth_connections")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("id", connectionId)
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
