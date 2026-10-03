# Conversation-led shopping brief

The brief turns a conversation into editable shopping requirements. It keeps explicit requirements separate from tentative interpretations and preserves what the shopper has already selected.

## One turn, one revision

The client captures the mission, message ID and current brief revision. The server interprets the latest shopper message, validates the proposed operations, and independently verifies their meaning. Clear changes apply before the concierge receives the turn. Fact meaning and permission to remove an older fact are checked separately: a clear new preference can be added without deleting an unrelated existing one. An ambiguous consequential change produces a clarification without calling the catalogue concierge.

Only the latest shopper message supplies evidence for a new spoken fact. Previous assistant text and completed product-group introductions can resolve references, but cannot establish consent. The model proposes typed values and operations, never executable search expressions. A single format regeneration is allowed for malformed complete JSON; schema and meaning checks still apply. A second failure stops that turn with retry.

The reducer applies targeted additions, corrections and removals atomically. No-change turns retain replay protection without consuming Undo history. Removed facts remain tombstoned. A manual edit during a pending response invalidates older output. Retrying an unprocessed message cannot overwrite a newer manual edit: the shopper must send a new message using the updated brief.

## What becomes a filter

Only active requirements with supported, exact catalogue semantics become query-time filters. The allowlist in `shared/catalogueFacetValues.json` records observed values; it is not an exhaustive live catalogue. Refresh it through read-only queries when necessary. Unsupported values remain context instead of becoming guessed filters.

Requested product types are alternatives: necklace and earrings form an OR. Independent materials, numeric limits and exclusions retain their intended conjunction. Item-scoped constraints are not blindly applied across every item in a combination. Recipient, occasion and subjective tastes remain conversational context. A total budget bounds individual candidates, but only exact combination arithmetic establishes affordability of the selection.

No configuration or record in the production index is modified. The native concierge receives validated per-request search parameters. Returned records and live traces still need checking; successful compilation alone does not prove provider execution or overall answer quality.

## Two columns with separate purposes

The conversation column owns guidance and the editable brief. Chips expose focused editors, removal and Undo. The product column appears when there are products to review, or when the shopper explicitly opens retained selections. Discover, Compare, Saved and Combination remain separate views.

Changing a requirement never silently deletes saved pieces. Product checks distinguish conflicts from missing evidence. Occasion and recipient notes do not create product-compliance warnings. A new mission clears its brief and retains selections for deliberate review; it does not delete provider-held conversation history.

## Observability and release

The client and server correlate request IDs. Timings cover interpretation, verification, compilation, upstream headers, stream events, browser completion, workspace commit, observed paint and image load/error. Browser frame observations are not renderer-internal measurements. Tool intervals are stream observations; provider execution time and token usage may be unavailable.

Timing records are bounded metadata. They exclude shopper text, credentials, product URLs and private reasoning. Synthetic evaluation captures are separate private evidence, outside the published source tree.

Use `BRIEF_V2_ENABLED` and the server-only interpreter ID to control rollout. Run reducer/compiler/transport tests, live multi-turn scenarios, manual-edit and failure recovery checks, and responsive browser checks before promotion. A layout comparison switch is not a frozen model baseline. See the deployment guide for rollback and authentication requirements.
