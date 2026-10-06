# Project Launchpad — batch 1 deployment

Internal handoff only; this file is not rendered in the application.

## This batch

- JomSales visible brand; account-only public registration.
- Personal name/WhatsApp profile, password/email changes, password recovery.
- Primary/deputy admins, disable/remove/reinvite members.
- Platform-only provisioning, company suspension/expiry, plan settings and audit.
- New quotation creator-name snapshots; old quotes fall back to recorded email.

No service-role key is required. Platform operations use narrowly scoped SQL
functions checking an explicit allowlist. Neither signup metadata nor a company
admin role grants platform access. Platform users do not implicitly read tenant
products, quotations or customers.

## Order

1. Back up the database and verify the restore process before production changes.
2. Run `supabase/migrations/202610060001_launchpad_accounts.sql` AFTER the six
   existing migrations. Its final query lists companies without a primary;
   designate them explicitly in the platform roster, not by guessing.
3. Run `supabase/tests/launchpad_accounts.sql` (read-only/rollback).
4. Sign up/verify your OWN account if needed. In
   `supabase/operations/launchpad_bootstrap.sql`, substitute only your verified
   email, then run as postgres. Never make customer accounts platform admins.
5. Keep Auth email confirmation and Secure Email Change enabled. Enable secure
   password change / password reauthentication in Auth. Set password minimum to
   at least 12. Configure reliable SMTP before customer invitation/recovery tests.
6. Add the actual production origin's callback URLs to Supabase Auth redirects:
   `/auth/callback`, `/auth/callback?next=settings`, and `/auth/reset`.
   With the current domain these are
   `https://jomsales.vercel.app/auth/callback`,
   `https://jomsales.vercel.app/auth/callback?next=settings`, and
   `https://jomsales.vercel.app/auth/reset`.
   Keep Site URL on the actual deployed domain; the product rename does NOT
   change GitHub or Supabase addresses/buckets. The owner has separately changed
   the production app address to `https://jomsales.vercel.app`; configure Vercel
   and Auth for that address. Retain old redirects only while intentionally
   supporting old links, then remove them once that transition is complete.
7. Deploy application AFTER SQL. New application expects new RPCs/columns.
8. Open `/settings`, complete name/phone; enroll TOTP, verify it, THEN use the
   commented enforcement statement in bootstrap to require AAL2 for your platform
   account. On subsequent login verify TOTP in settings before opening `/platform`.
9. `/platform`: create company -> manually send 7-day admin invitation -> customer
   registers/logs in using invited email -> explicitly accepts -> primary access.

Platform invitations are copied/manual delivery in this batch, not automatically
emailed. Retrying a lost create response with the same request does not create a
second company. Invite retry requests are memory-only; refresh the roster before
retrying after leaving the page. Unaccepted primary invites can be reissued.

## Limits and known boundaries

- A blank service deadline means no automatic expiry; explicit expired/suspended
  state or an elapsed deadline rejects tenant access without deleting business
  data. Renewal requires changing state/deadline; no billing integration exists.
- Employee cap counts all non-removed members (including primary/deputies and
  disabled members) and is enforced when accepting invitations. A downgrade
  never deletes members; if already over quota, further joins are blocked.
- Product/storage caps and feature JSON are RESERVED CONFIGURATION ONLY in this
  batch, labelled accordingly. They are not yet product/upload paywalls.
- Signed internal image URLs already issued may remain usable until their
  existing five-minute expiry. Suspension rejects NEW signed URLs immediately;
  previously downloaded content cannot be recalled.
- Public catalog links do not exist yet. Later batch must revoke them permanently
  on suspension/removal; do not equate the membership gate with link revocation.
- Email/password-change links must be opened in the originating browser for the
  default PKCE flow. Invalid/expired links must be tested against production SMTP.
- Language preference is structurally reserved; translation/switcher not shipped.
- Large catalog/CSV, customer book, Paid/statistics, public catalog and quote
  conveniences remain subsequent Launchpad batches. Do not describe all of
  Launchpad as complete.

## Acceptance

Use separate real test accounts in a test company. Confirm ordinary users cannot
create companies or read platform roster, deputies cannot manage primary or
other deputies, removed members need NEW invitations, another company's access
survives removal, and suspension denies products/quotations/Storage and RPCs.
Confirm old quotes stay unchanged after name/email changes. Test Auth email
verification, secure email change, password reset, TOTP login and invite expiry
with real messages (local automated fixtures do not prove mail delivery).

Local tests use isolated PostgreSQL fixtures; they never create/delete real
accounts/files. Build output can be isolated with `JOMSALES_BUILD_DIR` so it
doesn't delete a running dev server's `.next` cache.
