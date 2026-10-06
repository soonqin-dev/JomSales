# Project Launchpad — batch 3

Internal handoff, not a user-visible tutorial or UI redesign.

## Deploy

1. Verify database backup/restore path. Apply
   `supabase/migrations/202610060003_launchpad_quotations.sql` once after batch 2.
   No old quotation number, customer text, items, status or brand snapshots are
   rewritten. Added old validity/confirmation/payment dates remain unknown/null.
   A stored generated total is computed from existing item/discount values.
2. Run `supabase/tests/launchpad_quotations.sql`, read-only/rollback.
3. Deploy app AFTER SQL. No new secrets, buckets or redirect URLs required.
4. Refresh open application tabs to get new number/Paid/customer UI together.
5. In a TEST company: company brand -> new quotation defaults; create an employee
   private customer; choose that customer; add a temporary labour/material line;
   generate PDF and confirm cloud number/customer/terms/unit/amount snapshots.
6. Copy saved quote -> catalog -> adjust/generate: new UUID/number/owner/Pending,
   original unchanged. Read-only sales may add temporary quote lines, not products.
7. Mark Success/Paid, inspect audit, correct Paid with confirmation, trash/restore.
   Administrator team page shows basic date-filtered ranking and per-unit goods.

## Rules

- Open app/reload defaults to NEW draft. Number is empty until save, displayed as
  'allocated on save'. Database assigns prefix-year-sequence, year from quote date.
  Counter/reservations serialize company writes and retry by stable quote UUID.
  Reservation metadata contains only number/UUID; retained after trash purge to
  prevent number reuse. Legacy duplicate numbers are grandfathered, not renamed.
- New create RPC ignores supplied ownership/status/company snapshot and uses
  caller identity/live company. Request hash + UUID prevent duplicate creation.
  Updates preserve saved number/creator/brand; stale revision cannot overwrite.
- Defaults apply once to a new draft. Existing quote reload preserves null/blank
  old terms. Focus refresh reads new defaults for NEXT drafts, not current fields.
- Duplication preserves item prices/specifications/customer/terms/discount, resets
  date/ID/number/status and clears customer registry association. This allows a
  snapshot to be copied even when an original contact is inactive/private to
  another employee. Access to the ORIGINAL quote is still enforced by RLS.
- Customers: sales CRUD own; admin READ company-wide, CRUD own only. No transfer
  feature. Deactivation, employee removal, email/name changes do not rewrite
  stored quote customer/creator snapshots. No hard-delete API or CRM timeline.
- Selection is an autofill, not editing the customer registry. A selected customer
  becoming inactive before first save requires choosing an active contact or
  cancelling the association while retaining manual snapshot fields. Existing
  linked quotes remain editable without revalidating old inactive association.
- Temporary inputs live in quotation memory, survive back-to-catalog, are protected
  by the existing unsaved warning, and must be added/cleared before generating.
  Temporary items only persist as quote snapshots, never directory/inventory rows.
- Paid means manual full-payment confirmation, not payment processing. A direct
  Pending->Paid confirms both at marker time. Repeated status is a no-op. Paid
  corrections clear the relevant current marker but keep event history. Unknown
  historic Success confirmation date stays unknown even when later marked Paid.
- Audit keeps operation time, actor-name/email snapshot, state/amount/revision.
  Recent 100 events per quote visible only to owner/admin of live/recoverable quote.
  Events purge with the quote after 15 days; NOT a permanent accounting ledger.

## Reports

Business time zone Asia/Kuala_Lumpur. Saved quote count uses first save time.
Success+Paid count and amount use confirmation MARKER time, Paid amount uses Paid
MARKER time. Date end inclusive via exclusive next-midnight cutoff. These are
recording dates, not verified transaction dates. Unknown old confirmation dates
are excluded from dated confirmed metrics and flagged; never backfilled from
quote_date/updated_at. Pending/trashed/corrected states are excluded appropriately.

Amounts are CURRENT quote totals (discount included), not immutable settlement
cash flow. Editing a Success/Paid quote updates this business summary while audit
retains prior event totals; no claim of revenue recognition or bank reconciliation.
Goods quantity uses explicit is_service=false snapshots and groups by entered
unit; services/unknown legacy type excluded, meters/kg/pieces NEVER summed as one
volume. Report belongs to original creator, including removed/disabled members.
Roster uses current name; quote creator/event actor snapshots remain historical.

## Remaining Launchpad work

Public customer catalog with 7-day links, bulk price update, real feature/storage
paywalls, full translations and billing remain later batches. No inventory/order/
invoice/receipt/payment integration or visual redesign was added here.

## Verification

Local PostgreSQL tests execute all migrations with real RLS, customer isolation,
number retry, immutable snapshots, state actor/dates, private audit and period
reports. Browser acceptance uses LOCAL fake Auth/Data only, not production writes.
Retained first-batch account and second-batch catalog/CSV/PDF/share regressions.
