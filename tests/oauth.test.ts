import { describe, expect, it } from "vitest";

import {
  OAuthRequiredError,
  buildProviderAuthorizeUrl,
  isTokenExpiring,
  newOAuthState,
  oauthClientEnvNames,
  oauthRedirectUri,
} from "@/lib/api/oauth.server";

describe("oauth state generation", () => {
  it("produces 32 hex chars", () => {
    expect(newOAuthState()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is unique per call", () => {
    expect(newOAuthState()).not.toBe(newOAuthState());
  });
});

describe("oauth env names", () => {
  it("maps provider slugs to credential env vars", () => {
    expect(oauthClientEnvNames("google")).toEqual({
      id: "OAUTH_GOOGLE_CLIENT_ID",
      secret: "OAUTH_GOOGLE_CLIENT_SECRET",
    });
    expect(oauthClientEnvNames("github").id).toBe("OAUTH_GITHUB_CLIENT_ID");
    expect(oauthClientEnvNames("slack").secret).toBe("OAUTH_SLACK_CLIENT_SECRET");
  });
});

describe("oauth redirect uri", () => {
  it("points at the public callback route", () => {
    expect(oauthRedirectUri("https://3bi.ai")).toBe("https://3bi.ai/api/public/v1/oauth/callback");
  });

  it("strips a trailing slash from the origin", () => {
    expect(oauthRedirectUri("https://3bi.ai/")).toBe("https://3bi.ai/api/public/v1/oauth/callback");
  });
});

describe("provider authorize url", () => {
  const url = buildProviderAuthorizeUrl({
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    clientId: "cid_123",
    redirectUri: "https://3bi.ai/api/public/v1/oauth/callback",
    scope: "https://www.googleapis.com/auth/gmail.send",
    state: "abc123state",
  });
  const parsed = new URL(url);

  it("targets the provider authorize endpoint", () => {
    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
  });

  it("carries the OAuth code flow parameters", () => {
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("cid_123");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://3bi.ai/api/public/v1/oauth/callback",
    );
    expect(parsed.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.send");
    expect(parsed.searchParams.get("state")).toBe("abc123state");
  });

  it("requests offline access for Google so refresh tokens are issued", () => {
    const googleUrl = new URL(
      buildProviderAuthorizeUrl({
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        clientId: "cid_123",
        redirectUri: "https://3bi.ai/api/public/v1/oauth/callback",
        scope: "https://www.googleapis.com/auth/gmail.send",
        state: "abc123state",
        providerSlug: "google",
      }),
    );
    expect(googleUrl.searchParams.get("access_type")).toBe("offline");
    expect(googleUrl.searchParams.get("prompt")).toBe("consent");
  });

  it("does not add Google-only params for other providers", () => {
    expect(parsed.searchParams.get("access_type")).toBeNull();
    expect(parsed.searchParams.get("prompt")).toBeNull();
  });
});

describe("token expiry", () => {
  it("treats a missing expiry as non-expiring", () => {
    expect(isTokenExpiring(null)).toBe(false);
  });

  it("treats a past expiry as expiring", () => {
    expect(isTokenExpiring(new Date(Date.now() - 1000).toISOString())).toBe(true);
  });

  it("treats an expiry inside the skew window as expiring", () => {
    expect(isTokenExpiring(new Date(Date.now() + 30_000).toISOString(), 60)).toBe(true);
  });

  it("treats a distant expiry as live", () => {
    expect(isTokenExpiring(new Date(Date.now() + 3_600_000).toISOString(), 60)).toBe(false);
  });
});

describe("OAuthRequiredError", () => {
  it("carries the provider and behaves like an Error", () => {
    const err = new OAuthRequiredError("google");
    expect(err).toBeInstanceOf(Error);
    expect(err.provider).toBe("google");
    expect(err.name).toBe("OAuthRequiredError");
  });

  it("accepts a custom message", () => {
    const err = new OAuthRequiredError("slack", "reconnect slack");
    expect(err.message).toBe("reconnect slack");
    expect(err.provider).toBe("slack");
  });
});
