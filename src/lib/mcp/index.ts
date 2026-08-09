import { auth, defineMcp } from "@lovable.dev/mcp-js";

import createPayment from "./tools/create-payment";
import deleteRecord from "./tools/delete-record";
import listRecords from "./tools/list-records";
import lookupCrmContact from "./tools/lookup-crm-contact";
import searchKnowledgeBase from "./tools/search-knowledge-base";
import sendEmail from "./tools/send-email";
import updateCrmRecord from "./tools/update-crm-record";

// The OAuth issuer must be the direct Supabase host; the project ref is the
// only value that survives publish unchanged.
const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "agent-hub",
  title: "Agent Hub",
  version: "0.1.0",
  instructions:
    "Metered Relay tools for autonomous agents: knowledge search, CRM lookups, record listing, email, CRM writes, payments and deletions. Each call debits credits from the signed-in user's workspace. Side-effecting tools (send_email, update_crm_record, create_payment, delete_record) change state — confirm with the user before calling them.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    searchKnowledgeBase,
    lookupCrmContact,
    listRecords,
    sendEmail,
    updateCrmRecord,
    createPayment,
    deleteRecord,
  ],
});
