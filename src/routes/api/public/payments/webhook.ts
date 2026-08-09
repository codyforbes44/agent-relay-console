import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { CREDITS_BY_PRICE_ID } from "@/lib/billing/packs";
import { EventName, verifyWebhook, type PaddleEnv } from "@/lib/paddle.server";

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!);
  }
  return _supabase;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function handleTransactionCompleted(data: any, env: PaddleEnv) {
  const orgId: string | undefined = data.customData?.orgId;
  const userId: string | undefined = data.customData?.userId;
  if (!orgId) {
    console.warn("payments: transaction.completed without orgId in customData", { id: data.id });
    return;
  }

  const supabase = getSupabase();

  for (const item of data.items ?? []) {
    const priceId: string | undefined = item.price?.importMeta?.externalId;
    const quantity: number = item.quantity ?? 1;
    if (!priceId) {
      console.warn("payments: skipping item, missing importMeta.externalId", {
        rawPriceId: item.price?.id,
      });
      continue;
    }
    const perPack = CREDITS_BY_PRICE_ID[priceId];
    if (!perPack) {
      console.warn("payments: unknown credit pack price", { priceId });
      continue;
    }

    const credits = perPack * quantity;

    // (transaction_id, environment) is unique — this is the idempotency guard
    // against Paddle's retries and replays.
    const { data: purchase, error } = await supabase
      .from("credit_purchases")
      .insert({
        org_id: orgId,
        user_id: userId ?? null,
        transaction_id: data.id,
        environment: env,
        price_id: priceId,
        quantity,
        credits,
        amount_cents: Number(data.details?.totals?.total ?? 0) || null,
        currency: data.currencyCode ?? null,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        console.log("payments: transaction already credited", { id: data.id });
        return;
      }
      throw new Error(error.message);
    }

    const { error: ledgerError } = await supabase.from("credit_ledger").insert({
      org_id: orgId,
      delta: credits,
      kind: "purchase",
      description: `Credit pack purchase (${priceId} x${quantity})`,
    });
    if (ledgerError) {
      // Roll back the purchase row so a retry can credit the workspace.
      await supabase.from("credit_purchases").delete().eq("id", purchase.id);
      throw new Error(ledgerError.message);
    }

    console.log("payments: credited workspace", { orgId, credits, transactionId: data.id });
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = ((new URL(request.url).searchParams.get("env") as PaddleEnv) ||
          "sandbox") as PaddleEnv;
        try {
          const event = await verifyWebhook(request, env);
          if (event.eventType === EventName.TransactionCompleted) {
            await handleTransactionCompleted(event.data as any, env);
          } else {
            console.log("payments: unhandled event", event.eventType);
          }
          return Response.json({ received: true });
        } catch (e) {
          console.error("payments: webhook error", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
