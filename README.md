# SalesGo

Mobile-first company catalog, product cards and quotations. Login is mandatory;
business records are stored in company cloud, not LocalStorage. Visual layout
will be designed separately from this functional foundation.

## Local setup

Use Node 24.x and the committed lockfile. Next is pinned to 16.3.8 and React to
19.3.0. Read bundled Next docs before changing framework APIs.

```sh
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and set Supabase URL + publishable key. Set
the same two variables in Vercel. No secret/service-role key is used; never put
one in `NEXT_PUBLIC_*`. Keep email confirmation enabled. Set the Auth Site URL
to the production origin, with these exact callback Redirect URLs:

- `https://salesgo-tool.vercel.app/auth/callback`
- `http://localhost:3000/auth/callback`

Open PKCE email links in the registration browser; otherwise confirm then use
password login. Employees use their invited email and accept the invitation,
rather than creating another company.

## Pages

| Path | Purpose | Access |
| --- | --- | --- |
| `/` | Account or company workspace redirect | Verified server Auth |
| `/account` | Register/login, resend email, create company, membership, logout | Public login screen |
| `/auth/callback` | Finish email confirmation | Public callback |
| `/join` | Email-bound employee invitation | Public entry, authenticated acceptance |
| `/cloud` | Product catalog (CAT), detail sheet, share cards, product CRUD | Active company member |
| `/cloud/quote` | Current quotation editor (QTE); download/share autosave | Active company member |
| `/quotations` | Quote records, filters, status, recycle bin | Sales: own; admin: company-wide |
| `/me` | Profile summary, admin shortcuts, company switch, logout | Active company member |
| `/admin` | Company tools index | Company admin |
| `/brand` | Company name, contact, Logo | Company admin |
| `/team` | Invitations, disable/restore, grouped product permission | Company admin |

Member pages live in the `app/(member)` route group (the folder name is not part
of the URL). Its layout (`app/member-context.js`) verifies the company scope, holds
the current quotation in page memory and renders the bottom navigation, so the
draft survives switching pages and is lost only on a full reload. Visual rules:
`docs/design-system.md`; page specs: `docs/daily-flow-spec.md`, `docs/pages-spec.md`.

Server pages and proxy validate Auth using `getUser()`, never trusting a cookie's
embedded user. Cookie refresh is forwarded to SSR and browser, including redirects.
Protected responses are private/no-store. Supabase grants/RLS/scoped RPCs remain
the authoritative permissions. Login cookies and invitation sessionStorage are
authentication state, not business-data storage.

## Rollout for the current installation

The first FIVE migrations have already been applied. Do NOT rerun them.
For this quotation workflow update, before pushing/deploying:

1. Run `supabase/migrations/202610040005_quotation_lifecycle.sql` ONCE in Supabase
   SQL Editor as postgres. Existing quotes default to Pending; none are deleted.
2. Run `supabase/tests/quotation_lifecycle.sql`. All synthetic records roll back;
   no real quotation is purged, no email/physical Storage files are touched.
3. Run `supabase/operations/quotation_retention.sql` as postgres. It enables
   pg_cron and schedules ONLY trashed quotation rows at least 15 days old for
   permanent deletion, hourly. Verify the named job is active. Monitor its History
   in Supabase Cron. If installation fails, do not claim automatic cleanup works;
   expired trash cannot be restored but physical deletion awaits this job.
4. Push via GitHub Desktop, verify Vercel Production Ready matches the commit,
   then test on real phones. No new environment variable/service key is needed.

Retention excludes live quotes, company records, products, images and brand files.
Downloaded/shared PDFs cannot be recalled. Purged quotations cannot be restored
from the app. For a NEW installation run all SIX migrations in order, then install
the retention job. No local or mocked test activates production Cron.

## Products, images and permissions

All active members can read/search/share. Admins manage products; sales can manage
only with the admin-controlled grouped **新增、编辑、删除** flag. It never grants
admin/team/brand access. Stopping membership overrides every permission without
deleting company records. Sales without this flag do not see product CRUD buttons.
The UI rechecks membership on refresh/focus and every
two minutes; RLS checks every request even before the UI updates.

Products have immutable ownership/import metadata, optimistic revisions and soft
deletion. Private product images allow 5MB processed uploads; unique paths never
overwrite files. Live referenced images cannot be cleaned up. Other devices see
changes on refresh, not realtime.

Photos accept JPG/PNG/WebP and browser-decodable HEIC/HEIF, at most 12MB/40MP.
They resize to 1600px maximum side, prefer WebP and fall back to JPEG/PNG on
incompatible mobile encoders. PNG fallback preserves transparency. Logo inputs
use the same conversion with a 1MB limit. Five-minute signed image/Logo links
renew on focus and at two-minute intervals. A stopped employee cannot obtain
new links; already issued URLs work until expiry. Downloads/shares cannot be recalled.

## Cloud quotations and company brand

Normal entry/reload starts a blank **新报价**, never the last saved quote. Adding
products and editing quantity/price/customer/date/notes/discount use page memory
only, until generation/sharing automatically confirms the cloud save. No manual
save button exists. Dirty/failure messages and navigation warnings protect drafts;
failed saves retain all current contents and never fall back to LocalStorage.

**生成报价 PDF** autosaves, generates and starts the download, then returns to an
empty catalog cart. The last generated file remains downloadable/shareable from
the catalog. A failed PDF render retains the saved quote in the editor for retry.
**准备分享 PDF（自动保存）** saves/prepares first; tap **分享 PDF** afterwards to
retain mobile user activation. Successful native share resets to a new catalog
quote; cancellation/failure leaves the current quote/PDF intact. Unsupported
browsers can download and attach the file manually. A browser download start or
share completion is not proof of customer receipt or acceptance.

In **已保存报价**, search by number/customer/employee email, filter Pending/Success,
then **选择报价** returns straight to the catalog with its cart loaded and
**正在编辑：编号** displayed. Generation/sharing updates the SAME saved id.
Selection is a one-time URL handoff; reload starts new again. **新建报价单** resets
the catalog cart after confirmation if dirty; it never deletes saved records.
Sales manage only their own quotes; admins manage all company quotes and see the
server-stamped creator email. Admin edits preserve ownership, email and status.

**Pending** means awaiting customer acceptance, **Success** means customer
accepted (NOT payment received). Change status manually in history; exports never
auto-mark Success. **删除报价** moves it to the recycle bin after confirmation.
Restore within 15 days keeps the original number, snapshots, status and owner.
Expired rows are unreadable/unrecoverable; the hourly job physically purges them.
Status/trash/restore use a locked, revision-checked, company/owner-scoped RPC;
browser callers cannot write lifecycle/creator fields or permanently delete rows.
Customer data remains part of a quote, not a standalone CRM. No orders/billing yet.

The first cloud save captures product name/code/quantity/price snapshots and
server-stamped company name/contact/Logo-path. Later product removal or branding
changes never rewrite historical quotes. Logos referenced by a company or history
cannot be deleted by app cleanup. Only an admin changes current company branding.

Integer-cent calculations and limits are checked in client and DB. Invalid input
cannot save/export. Customer name is required for PDF export.
**生成报价 PDF** confirms a cloud save first, then generates A4 pages with brand,
customer, rows, totals, notes and page numbers. Edits invalidate the prepared PDF.
PDFs use browser-font canvases (Chinese supported, text not selectable). Product
JPG cards include photo, full text, price and the current company brand. Native
file sharing to WhatsApp remains supported; download the JPG/PDF and attach it
manually if unavailable. Actual delivery and device compatibility need real phones.

## Cloud-only data source

The legacy browser-import page, navigation and readers have been removed. Old
`/migration` bookmarks redirect authenticated users to their company cloud
workspace (anonymous users must log in); they cannot preview/import browser data.
Application code does not read/write/clear LocalStorage business records.
Previously uploaded products, quotations and original import metadata stay intact
in Supabase; removing the legacy import feature itself deletes no cloud records
or physical files. The separate quotation retention policy above applies to trash.
Any old browser originals are left untouched, unused by SalesGo. A person with
access to that browser profile could still inspect them outside the app.

## Tests

```sh
npm test
npm run build
npm run check:supabase
```

Unit/service tests cover upload fallback, pagination, lost responses, stale saves
and absence of local business-data readers/writers. PGlite runs the actual migrations and verification SQL
with Auth/Storage schema stubs, including company isolation, own/admin quotations,
disabled/anonymous access, lifecycle RPC revisions, 15-day expiry/purge and
historical Logo retention. Physical purge is tested ONLY in the isolated DB.

Optional browser regression: install Playwright separately or set
`SALESGO_PLAYWRIGHT_MODULE` to an existing module, then run:

```sh
node scripts/test-workspace-browser.cjs
npm run build
```

It starts a local API double on 54329, builds with test-only env values and runs
an isolated production server on 54330. BOTH SSR/proxy and browser Auth call the
double; no live Supabase writes occur. It covers login guards, cross-device quotes,
JPG/PDF autosave/reset, selected-quote edits, failed/stale/PDF save retention,
share cancellation/success, employee identity, lifecycle controls, company/role
access, retired-route redirects, ignored browser data and hidden CRUD controls.
Afterwards `.next` still holds
test env values: rerun normal `npm run build` before local production use. The
old `test-cloud-browser.cjs` and `test-team-browser.cjs` harnesses are historical
pre-SSR tests, superseded by this harness. Live migration, Vercel and physical
phone acceptance are separate from mocks.

Out of scope: inventory/POS, orders, payments, subscription quotas, password
recovery, full offline support, accounting and ERP integrations.
