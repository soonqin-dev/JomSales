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
| `/cloud` | Products, share cards, product CRUD, quotation editor | Active company member |
| `/quotations` | Reopen saved quotes, start new quote | Sales: own; admin: company-wide |
| `/brand` | Company name, contact, Logo | Company admin |
| `/team` | Invitations, disable/restore, grouped product permission | Company admin |
| `/migration` | Explicit legacy preview, backup and import | Company admin |

Server pages and proxy validate Auth using `getUser()`, never trusting a cookie's
embedded user. Cookie refresh is forwarded to SSR and browser, including redirects.
Protected responses are private/no-store. Supabase grants/RLS/scoped RPCs remain
the authoritative permissions. Login cookies and invitation sessionStorage are
authentication state, not business-data storage.

## Rollout for the current installation

The earlier four migrations are already applied. Do NOT rerun them.

1. Run ONLY `supabase/migrations/202610040004_cloud_only_workspace.sql` once as
   postgres in SQL Editor, before deploying this client.
2. Require `quotations.row_security_enabled=true`; `salesgo-branding` must show
   `public=false`, `file_size_limit=1048576`.
3. Separately run `supabase/tests/cloud_only_workspace.sql` and require `PASS`.
   Stop on an SQL error and inspect it before continuing.
4. Push the tested commit via GitHub Desktop; verify Vercel Production Ready
   matches that commit, then test login and cross-device workflows on real phones.
5. If needed, use `/migration` on the old browser/domain. Download its backup,
   verify the target company, then explicitly confirm import.

The new migration preserves users/products/memberships/permissions, adding quotes,
company branding and a private 1MB Logo bucket. It does not delete physical files
or browser originals. Verification SQL creates synthetic Auth/company records,
rolls them ALL back, sends no email and does not touch physical Storage files.
For a NEW installation only, run all migration files in chronological order once.

## Products, images and permissions

All active members can read/search/share. Admins manage products; sales can manage
only with the admin-controlled grouped **新增、编辑、删除** flag. It never grants
admin/team/brand access. Stopping membership overrides every permission without
deleting company records. The UI rechecks membership on refresh/focus and every
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

Adding a product saves the quotation immediately. Quantity, price, customer
name/phone, date, notes and fixed-amount discount edits require **保存到云端**.
Dirty/failure messages and navigation warnings distinguish confirmed cloud saves
from unsaved page memory. Closing/leaving without saving discards edits; network
failure never silently falls back to LocalStorage. Sales read/edit their own quotes;
admin reads/edits all company quotes. Admin edits retain the original creator.

The latest own saved quote opens by default. **新建报价** clears the editor after
confirmation but keeps old cloud records. **已保存报价** reopens a quote on another
device. Customer data is stored with a quote, not in a standalone CRM. There are
no quotation delete/archive/status controls, orders or billing in this release.

The first cloud save captures product name/code/quantity/price snapshots and
server-stamped company name/contact/Logo-path. Later product removal or branding
changes never rewrite historical quotes. Logos referenced by a company or history
cannot be deleted by app cleanup. Only an admin changes current company branding.

Integer-cent calculations and limits are checked in client and DB. Invalid input
cannot save/export. Customer name is required for PDF export, optional in a draft.
**生成报价 PDF** confirms a cloud save first, then generates A4 pages with brand,
customer, rows, totals, notes and page numbers. Edits invalidate the prepared PDF.
PDFs use browser-font canvases (Chinese supported, text not selectable). Product
JPG cards include photo, full text, price and the current company brand. Native
file sharing to WhatsApp remains supported; download the JPG/PDF and attach it
manually if unavailable. Actual delivery and device compatibility need real phones.

## Legacy preservation

ONLY `/migration`, after explicit admin preview, reads the following keys:

| Preferred key | Old fallback |
| --- | --- |
| `salesgo_catalog_v1` | `autoparts_catalog_vercel_demo_v1` |
| `salesgo_quotation_v1` | `autoparts_quotation_v1` |
| `salesgo_quotation_details_v1` | `autoparts_quotation_details_v1` |

Reads never write/copy/delete browser keys. Preferred keys, including empty arrays,
take precedence. Corrupt data errors instead of overwriting originals. Backup to
JSON first. Same-source products/quotes deduplicate on retries; conflicting codes
do not overwrite cloud products. Old quote belongs to the importing admin. Missing
old quote metadata gets the documented date `2000-01-01` and a legacy number,
editable afterwards. Brand replacement is opt-in and confirmed; otherwise current
cloud brand is retained and stamped into the imported quote. Originals remain in
the browser profile and may still be inspected outside the app by someone with
profile access. Another domain/protocol/port cannot read these keys.

## Tests

```sh
npm test
npm run build
npm run check:supabase
```

Unit/service tests cover upload fallback, pagination, lost responses, stale saves
and migration identity. PGlite runs the actual migrations and verification SQL
with Auth/Storage schema stubs, including company isolation, own/admin quotations,
disabled/anonymous access and historical Logo retention.

Optional browser regression: install Playwright separately or set
`SALESGO_PLAYWRIGHT_MODULE` to an existing module, then run:

```sh
node scripts/test-workspace-browser.cjs
npm run build
```

It starts a local API double on 54329, builds with test-only env values and runs
an isolated production server on 54330. BOTH SSR/proxy and browser Auth call the
double; no live Supabase writes occur. It covers login guards, cross-device quotes,
JPG/PDF exports with private Logo, failed/stale save retention, company/role access,
legacy backup/deduplication and permission removal. Afterwards `.next` still holds
test env values: rerun normal `npm run build` before local production use. The
old `test-cloud-browser.cjs` and `test-team-browser.cjs` harnesses are historical
pre-SSR tests, superseded by this harness. Live migration, Vercel and physical
phone acceptance are separate from mocks.

Out of scope: inventory/POS, orders, payments, subscription quotas, password
recovery, full offline support, accounting and ERP integrations.
