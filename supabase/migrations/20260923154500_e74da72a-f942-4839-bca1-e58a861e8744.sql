-- RELAY: bind confirmation tokens to their approval intent (deny-bypass fix).
--
-- Previously the tool endpoint minted a live tool_confirmations row for a
-- still-pending approval intent and returned the raw token in the 428 body.
-- Denying the intent never touched that row, and redeemConfirmation() never
-- consulted approval_intents, so the token still executed the side effect.
--
-- Going forward no token is minted until the intent is approved, and every
-- token minted for an approval flow carries intent_id so redemption can
-- verify the human decision. Deny/expire revokes the linked rows.

ALTER TABLE public.tool_confirmations
  ADD COLUMN intent_id uuid REFERENCES public.approval_intents(id) ON DELETE SET NULL;

CREATE INDEX idx_tool_confirmations_intent ON public.tool_confirmations(intent_id);
