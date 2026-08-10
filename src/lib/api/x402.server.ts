/**
 * x402 machine payments: an agent that runs out of credits pays for more
 * over HTTP with a stablecoin, no human and no browser involved.
 *
 * Protocol: https://x402.org — the server answers 402 with `accepts[]`
 * payment requirements, the agent retries the same request with an
 * `X-PAYMENT` header, and a facilitator verifies + settles on chain.
 *
 * Every value here is read at call time (never at module scope) because the
 * Worker runtime injects env per request.
 */

export const X402_VERSION = 1;

export type X402Network = "base" | "base-sepolia";

export type X402Config = {
  payTo: string;
  network: X402Network;
  facilitatorUrl: string;
  asset: string;
  assetName: string;
  assetVersion: string;
  decimals: number;
};

/** USDC contract per supported network. */
const USDC: Record<X402Network, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

const DEFAULT_FACILITATOR: Record<X402Network, string> = {
  base: "https://api.cdp.coinbase.com/platform/v2/x402",
  "base-sepolia": "https://x402.org/facilitator",
};

/**
 * Returns null when the rail is not configured yet, which keeps 402 responses
 * working exactly as before instead of advertising an address we cannot settle.
 */
export function x402Config(): X402Config | null {
  const payTo = process.env["X402_PAY_TO_ADDRESS"]?.trim();
  if (!payTo || !/^0x[a-fA-F0-9]{40}$/.test(payTo)) return null;

  const network = (process.env["X402_NETWORK"]?.trim() as X402Network) || "base";
  if (network !== "base" && network !== "base-sepolia") return null;

  return {
    payTo,
    network,
    facilitatorUrl: (
      process.env["X402_FACILITATOR_URL"]?.trim() || DEFAULT_FACILITATOR[network]
    ).replace(/\/$/, ""),
    asset: USDC[network],
    assetName: "USDC",
    assetVersion: "2",
    decimals: 6,
  };
}

export type PaymentRequirements = {
  scheme: "exact";
  network: X402Network;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
};

/** Converts a USD amount to the asset's atomic units (USDC has 6 decimals). */
/** USD -> atomic units. Cents are exact in integer math; scaling is BigInt. */
export function toAtomic(usd: number, decimals: number): string {
  const cents = BigInt(Math.ceil(Number((usd * 100).toFixed(6))));
  if (decimals >= 2) return (cents * 10n ** BigInt(decimals - 2)).toString();
  return (cents / 10n ** BigInt(2 - decimals)).toString();
}

export function paymentRequirements(input: {
  config: X402Config;
  resource: string;
  description: string;
  usd: number;
}): PaymentRequirements {
  return {
    scheme: "exact",
    network: input.config.network,
    maxAmountRequired: toAtomic(input.usd, input.config.decimals),
    resource: input.resource,
    description: input.description,
    mimeType: "application/json",
    payTo: input.config.payTo,
    maxTimeoutSeconds: 120,
    asset: input.config.asset,
    extra: { name: input.config.assetName, version: input.config.assetVersion },
  };
}

export function readPaymentHeader(request: Request): unknown | null {
  const header = request.headers.get("x-payment");
  if (!header) return null;
  try {
    return JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(header.trim()), (c) => c.charCodeAt(0))),
    );
  } catch {
    try {
      return JSON.parse(header);
    } catch {
      return null;
    }
  }
}

export function encodePaymentResponse(value: unknown): string {
  return btoa(JSON.stringify(value));
}

async function facilitatorCall(config: X402Config, path: string, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const url = new URL(`${config.facilitatorUrl}${path}`);

  // Coinbase CDP requires a per-request signed JWT; other facilitators accept
  // a static bearer token (or none at all).
  const { cdpCredentials, cdpJwt } = await import("./cdp-jwt.server");
  const cdp = cdpCredentials();
  const apiKey = process.env["X402_FACILITATOR_API_KEY"]?.trim();
  if (cdp && url.hostname.endsWith("coinbase.com")) {
    headers["authorization"] = `Bearer ${await cdpJwt(cdp, "POST", url.host, url.pathname)}`;
  } else if (apiKey) {
    headers["authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`facilitator ${path} failed [${res.status}]: ${text.slice(0, 400)}`);
  }
  return parsed;
}

export type SettlementResult = {
  payer: string | null;
  txHash: string | null;
  network: string;
};

/**
 * Verifies the signed payment against the requirements and, when valid,
 * settles it on chain. Throws with a caller-safe message when either fails.
 */
export async function verifyAndSettle(
  config: X402Config,
  paymentPayload: unknown,
  requirements: PaymentRequirements,
): Promise<SettlementResult> {
  const envelope = { x402Version: X402_VERSION, paymentPayload, paymentRequirements: requirements };

  const verify = await facilitatorCall(config, "/verify", envelope);
  if (verify["isValid"] !== true) {
    throw new Error(String(verify["invalidReason"] ?? "payment verification failed"));
  }

  const settle = await facilitatorCall(config, "/settle", envelope);
  if (settle["success"] !== true) {
    throw new Error(String(settle["errorReason"] ?? "payment settlement failed"));
  }

  return {
    payer: (settle["payer"] as string) ?? (verify["payer"] as string) ?? null,
    txHash: (settle["transaction"] as string) ?? null,
    network: (settle["network"] as string) ?? config.network,
  };
}
