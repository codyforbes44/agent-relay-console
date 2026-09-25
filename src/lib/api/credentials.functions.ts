import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CREDENTIAL_SERVICES } from "@/lib/api/credential-services";

const serviceIds = CREDENTIAL_SERVICES.map((s) => s.id) as [string, ...string[]];

type AuthedContext = {
  supabase: {
    rpc: (fn: "org_role_of", args: { _org_id: string }) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
};

async function requireManager(context: AuthedContext, orgId: string) {
  const { data, error } = await context.supabase.rpc("org_role_of", { _org_id: orgId });
  if (error) throw new Error(error.message);
  if (data !== "owner" && data !== "admin") {
    throw new Error("Only workspace owners and admins can manage API keys");
  }
}

export const listCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("org_api_credentials")
      .select("id, service, label, config, secret_last4, last_verified_at, created_at")
      .eq("org_id", data.orgId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({ ...r, config: (r.config ?? {}) as Record<string, string> }));
  });

export const saveCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      orgId: string;
      service: string;
      label: string;
      secret: string;
      config: Record<string, string>;
    }) =>
      z
        .object({
          orgId: z.string().uuid(),
          service: z.enum(serviceIds),
          label: z.string().trim().min(1).max(80),
          secret: z.string().trim().min(8).max(4096),
          config: z.record(z.string().max(40), z.string().trim().max(200)),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireManager(context as unknown as AuthedContext, data.orgId);
    const def = CREDENTIAL_SERVICES.find((s) => s.id === data.service)!;
    const config: Record<string, string> = {};
    for (const field of def.configFields) {
      const value = data.config[field.key] ?? "";
      if (field.options && !field.options.some((o) => o.value === value)) {
        throw new Error(`Choose a valid ${field.label}`);
      }
      config[field.key] = value;
    }

    const { encryptSecret } = await import("@/lib/api/vault.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("org_api_credentials").upsert(
      {
        org_id: data.orgId,
        service: data.service,
        label: data.label,
        config,
        secret_ciphertext: await encryptSecret(data.secret),
        secret_last4: data.secret.slice(-4),
        created_by: context.userId,
        last_verified_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,service,label" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; id: string }) =>
    z.object({ orgId: z.string().uuid(), id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireManager(context as unknown as AuthedContext, data.orgId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("org_api_credentials")
      .delete()
      .eq("id", data.id)
      .eq("org_id", data.orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Calls the service with the stored key to confirm it works. */
export const testCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; id: string }) =>
    z.object({ orgId: z.string().uuid(), id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireManager(context as unknown as AuthedContext, data.orgId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("org_api_credentials")
      .select("service, config, secret_ciphertext")
      .eq("id", data.id)
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (error || !row) throw new Error("Key not found");

    const { decryptSecret } = await import("@/lib/api/vault.server");
    const secret = await decryptSecret(row.secret_ciphertext);
    const config = (row.config ?? {}) as Record<string, string>;

    let ok = false;
    let detail = "";
    if (row.service === "make") {
      const zone = config["zone"] || "us1";
      const res = await fetch(`https://${zone}.make.com/api/v2/users/me`, {
        headers: { Authorization: `Token ${secret}` },
      });
      ok = res.ok;
      if (ok) {
        const body = (await res.json()) as { authUser?: { email?: string; name?: string } };
        detail = body.authUser?.email ?? body.authUser?.name ?? "";
      } else {
        const text = await res.text();
        console.error(`make.com verify failed [${res.status}]: ${text}`);
        detail =
          res.status === 401 || res.status === 403
            ? "make.com rejected this key — check the key and the region"
            : `make.com returned ${res.status}`;
      }
    } else {
      ok = true;
      detail = "Saved (no automatic check for this service)";
    }

    if (ok) {
      await supabaseAdmin
        .from("org_api_credentials")
        .update({ last_verified_at: new Date().toISOString() })
        .eq("id", data.id);
    }
    return { ok, detail };
  });
