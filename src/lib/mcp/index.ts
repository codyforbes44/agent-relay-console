import { auth, defineMcp } from "@lovable.dev/mcp-js";

import crawlSite from "./tools/crawl-site";
import extractStructured from "./tools/extract-structured";
import fetchUrl from "./tools/fetch-url";
import sandboxCreatePayment from "./tools/sandbox-create-payment";
import sandboxDeleteRecord from "./tools/sandbox-delete-record";
import sandboxListRecords from "./tools/sandbox-list-records";
import sandboxLookupCrmContact from "./tools/sandbox-lookup-crm-contact";
import sandboxSearchKnowledgeBase from "./tools/sandbox-search-knowledge-base";
import sandboxSendEmail from "./tools/sandbox-send-email";
import sandboxUpdateCrmRecord from "./tools/sandbox-update-crm-record";

// The OAuth issuer must be the direct Supabase host; the project ref is the
// only value that survives publish unchanged.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "agent-hub",
  title: "Agent Hub",
  version: "0.1.0",
  instructions:
    "Metered Relay tools for autonomous agents. fetch_url, crawl_site and extract_structured perform real network and model work and debit credits from the signed-in user's workspace. Every sandbox_* tool is free and returns simulated fixture data — nothing is sent, written, charged or deleted — and exists so agents can rehearse the API, including the confirmation flow on side-effecting calls (sandbox_send_email, sandbox_update_crm_record, sandbox_create_payment, sandbox_delete_record).",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    fetchUrl,
    crawlSite,
    extractStructured,
    sandboxSearchKnowledgeBase,
    sandboxLookupCrmContact,
    sandboxListRecords,
    sandboxSendEmail,
    sandboxUpdateCrmRecord,
    sandboxCreatePayment,
    sandboxDeleteRecord,
  ],
});
