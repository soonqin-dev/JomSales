# SalesGo

**Mobile Sales Catalog & Quotation Tool · 移动产品目录与报价工具**

A lightweight, mobile-first sales tool for businesses in any industry. Search
products, show details, share a complete product card, and generate quotations.

## Run locally

Use Node.js 24.x. Framework versions are pinned to Next.js 16.3.8 and
React/React DOM 19.3.0; commit `package-lock.json` with dependency updates.
The default development and production compiler is Turbopack. Supported browser
minimums are Safari 16.4+, Chrome/Edge 111+, and Firefox 111+.

```bash
npm install
npm run dev
```

Open http://localhost:3000. Use `npm run build` for a production build.

Run `npm test` for image-upload compatibility regression checks. Before release,
verify photo and transparent-logo uploads on Android Chrome and iPhone Safari,
including saving, refreshing, product-card download, and quotation PDF generation.
Browser simulations cover WebP fallback, but do not replace physical-device checks.

`npm test` also runs the SalesGo SQL migrations in an in-memory PostgreSQL engine
(PGlite) with platform Auth/Storage schema stubs and exercises two-company RLS,
admin/sales access, disabled/anonymous accounts, optimistic revisions, import
deduplication and image cleanup. These tests do not connect to the live project.

## Deploy to Vercel

Import the GitHub repository as a Next.js project and deploy. Push the tested
commit to GitHub; a connected Vercel project will deploy the update. Verify the
deployment commit matches your latest commit. The `engines.node` field pins the
Vercel runtime to Node.js 24.x. Keep build/install defaults and the committed
lockfile; do not overwrite newer files with an older release ZIP.

The tool uses Next.js 14, React, and LocalStorage. The repository name does not
determine the displayed brand. All image processing and PDF generation run on
the device; no server upload, WhatsApp API, or Supabase connection is required.

## Product catalog and editing

- Search by product code, name, or tags. Tap a card or focus its name and press
  Enter to view its photo, name, code, tags, and price.
- Add, edit, or delete a product. Editing retains its ID and photo unless the
  salesperson replaces/removes the photo. Cancelling discards form changes.
- Prices must be nonnegative amounts with up to two decimal places.
- Close details with ×, Escape, or the backdrop. The selected company's name
  and logo appear when configured. Fresh installs have generic sample products;
  existing products are never renamed or replaced with samples.

## Mobile image uploads

- Product uploads accept JPG/JPEG, PNG, WebP, and HEIC/HEIF, up to 12MB /
  40 megapixels. HEIC/HEIF requires browser decoding support; otherwise a clear
  message asks the user to export JPG or upload a screenshot.
- The browser decodes image orientation, fits the longest side within 1600px
  without upscaling, and prefers WebP at quality 0.82. If WebP encoding fails,
  photos fall back to JPEG (then PNG if necessary); PNG/WebP sources fall back
  to PNG to preserve transparency. The Data URL records the actual output format.
- Only the processed image Data URL is saved. A progress state prevents saving
  before conversion completes. Closing/reopening a form discards pending results.
- Invalid, oversized, or unsupported images show an error; the previous photo
  stays intact. Browsers without WebP encoding use compatible formats automatically;
  failed encodes are distinguished from unreadable files in the error messages.
- Existing photos remain in their original format until replaced. Company logo
  uploads (up to 1MB) use the same conversion and compatibility handling.
- LocalStorage has a browser-dependent capacity. Failed saves show a warning;
  keep the page open until the data can be saved. Clearing browser data removes
  local products and quotations.

## WhatsApp product cards

- Opening product details prepares one JPG card containing the product photo,
  full name, product code, price, tags, and the company's name/logo if configured.
  Products without photos use a clean placeholder. Long text wraps.
- Tap **分享卡片到 WhatsApp** and choose WhatsApp in the system share sheet.
  The file is prepared before the tap, preserving mobile user activation.
- The share payload contains only the JPG. Product information is drawn into
  that image, so WhatsApp cannot drop a separate caption or text payload.
- **下载产品卡片** is always available when the card is ready. If native sharing
  is unsupported or fails, download the JPG and send it as a photo in WhatsApp.
  Cancelling the share sheet does not navigate to another app.
- Use HTTPS and a current Safari/Chrome browser for native file sharing.
  Automated browser checks verify the actual JPG/PDF file payloads; sending to
  a real WhatsApp contact still needs a phone with WhatsApp installed.

## Quotation workflow

- Add products from details, then open **查看 / 生成报价** above search or
  **查看报价清单** in details. Repeat additions increase the existing row's quantity.
- Edit quantities/unit prices, remove rows, and enter customer name/phone, date,
  notes, and a fixed amount discount. Customer name is required; phone is optional.
- Calculations use integer cents. Discounts cannot exceed the subtotal. Invalid
  in-progress item edits disable export and retain the last valid saved values.
- Company name starts empty and must be entered before PDF generation. Expand
  **公司资料（用于报价与产品卡片）** to configure the company's name, contact, and logo.
  SalesGo is the tool's brand; customer PDFs use the salesperson's company.
- Tap **生成报价 PDF**, then **下载 PDF** or **分享 PDF**. If native PDF sharing is
  unavailable, download and attach it as a document in WhatsApp. Edits invalidate
  the generated file; regenerate before downloading/sharing.
- A4 PDFs include company branding/contact, quotation number/date, customer,
  product rows and amounts, subtotal/discount/total, notes, and page numbers.
  Rows and notes paginate. Browser fonts support Chinese and other installed
  fonts. Pages are rasterized at 2× resolution; text is not selectable. jsPDF
  loads only when generating a PDF.
- **新建报价** clears the current customer/items after confirmation and generates
  a new number/date while retaining company settings. Editing/deleting a catalog
  product does not rewrite a quotation's saved product snapshot or unit price.

## LocalStorage migration

| Previous key | SalesGo key |
| --- | --- |
| `autoparts_catalog_vercel_demo_v1` | `salesgo_catalog_v1` |
| `autoparts_quotation_v1` | `salesgo_quotation_v1` |
| `autoparts_quotation_details_v1` | `salesgo_quotation_details_v1` |

On first use at the **same website origin**, valid legacy data is copied into
the corresponding new key. An existing SalesGo key always takes precedence,
including an empty catalog/draft. Legacy keys stay untouched as backups.
IDs, photos, quotation rows/prices, customer details, and company settings are
retained. Only the old unused default company name (with no contact or logo)
becomes empty; entered branding is preserved.

Corrupt data or a failed migration is shown on screen and is never overwritten
with samples or an empty draft. Storage capacity must accommodate the new copy
and the retained backup. A different domain, protocol, or port has separate
LocalStorage; automatic migration cannot read another origin's data.

## Supabase connection setup

Copy `.env.example` to `.env.local` and fill in the Project URL and publishable
key. `.env.local` is ignored by Git. Set the same two variables in the Vercel
project's environment variables and redeploy when they change. Never put a secret
or service-role key in a `NEXT_PUBLIC_` variable.

Run `npm run check:supabase` to verify the Auth endpoint accepts the connection
details. This read-only check does not create users or modify database data.
The browser client utility is in `lib/supabase/client.js`. `/account` supports
email/password registration, login, verification email resend, company creation,
membership display, and device-local sign-out. Apply
`supabase/migrations/202610030001_company_accounts.sql` once in SQL Editor before
using company creation. Do not rerun the migration after successful application.
Set Auth Site URL to the production origin and allow these exact Redirect URLs:
`https://salesgo-tool.vercel.app/auth/callback` and
`http://localhost:3000/auth/callback` for local testing. Keep email confirmation
enabled. PKCE verification links should be opened in the registration browser;
if opened elsewhere, try password login after confirming the email.

The current Auth implementation is browser-only; it does not authorize server
routes with cookies. Company reads and creation are authorized by Supabase Auth,
table grants, RLS, and the limited `create_company` RPC, not UI state. No secret
key is used. Each account can create one company; repeated requests return the
existing company without reactivating a disabled membership. Members can read
their own active membership and its company only. Company editing, password
recovery, quotas, and billing are not implemented yet.

The home route remains the local catalog. `/cloud` is the separate company
catalog, also linked from the account page. Apply the NEW migration
`supabase/migrations/202610040001_cloud_products.sql` once in SQL Editor as
postgres, after the company-accounts migration. Do not rerun the earlier migration.
The new migration creates `products`, its explicit grants/RLS, and the private
`salesgo-products` Storage bucket (5MB per processed image, WebP/JPEG/PNG only).
It does not edit existing users, companies, memberships, or local product data.
Run `supabase/tests/company_isolation.sql` separately afterwards to verify the
live database rules. Its synthetic test records are rolled back, it sends no
emails, and it does not create or delete physical Storage files. If it fails,
stop and inspect the error before enabling the cloud workflow.

Cloud product reads require active company membership. Admins and explicitly
authorized sales members can insert, update and soft-delete; bulk import remains
admin-only. All active sales members can read/search/share and add local quotation
lines. Ownership, import keys and revision metadata are not writable by API
clients. A revision check prevents overwriting a newer device's edit. Other
devices see changes on refresh (not realtime). Cloud failures never silently
switch to the local catalog, and cloud product rows are not saved to LocalStorage.
Supabase still enforces permissions if the browser UI is bypassed.

Images have company/product/unique-file paths and are uploaded without overwrite.
The app requests five-minute signed links and periodically rechecks membership
and renews links. Private does NOT mean previously issued URLs can be revoked:
an existing link remains usable until expiry, and downloaded/shared images cannot
be recalled. Canvas loading uses anonymous CORS so cloud photos can be included
in JPG share cards. Replacements and deletion clean up unreferenced images through
Storage API; RLS blocks deletion of files referenced by live products. Cleanup
failures are shown as warnings and may require later storage housekeeping.

Import is explicit: preview local records, optionally download a JSON backup,
then confirm the named target company. Source IDs and deterministic company-scoped
UUIDs make retries skip already imported records (including tombstones). Existing
product numbers conflict rather than overwriting data. Failed rows are reported
and can be retried. Local originals are never erased; editing local records after
import does not update their cloud copies. A deleted cloud record retains its
import key for deduplication; no restore/permanent-purge workflow exists yet.

Local products, quotation drafts and quotation branding remain in LocalStorage
and are not partitioned by signed-in user. Sign-out does not erase these records;
do not treat shared-device local data as private company data. Cloud product cards
use the active company's name, while quotations still use manually entered local
branding. Cloud quotations, cloud branding/logo, offline editing,
quotas, and realtime updates are separate future work.

Optional browser acceptance: start the production server, then run
`node scripts/test-cloud-browser.cjs` with Playwright available. Set
`SALESGO_PLAYWRIGHT_MODULE` to an existing Playwright package path if needed;
`SALESGO_BROWSER_CHANNEL` defaults to `msedge` and `SALESGO_TEST_URL` defaults to
`http://localhost:3000`. All Supabase requests are mocked. It covers cloud CRUD,
private-image cards, save failure/retry, backup/import/deduplication, second-device
reads, isolated UI, sales/disabled accounts, stale writes, and local preservation.
Finish rollout with real phone upload/card/PDF checks, two real test companies,
and confirmation that an unauthenticated public bucket URL cannot display images.

Any future server-protected pages will also need server session validation and
session refresh middleware before deployment.

## Employee invitations and access management

Apply ONLY `supabase/migrations/202610040002_employee_invitations.sql` once as
postgres, after the two earlier migrations. It adds an RLS-enabled invitation
table and limited RPCs without changing existing companies, members or products.
Run `supabase/tests/employee_invitations.sql` separately: it uses synthetic users,
rolls back all test records, sends no email, and touches no physical Storage files.
Do not push/deploy the new pages until the migration and verification succeed.

Admin account/company-cloud pages link to `/team`. Admins can list their company's
member emails, generate a link for a specified employee email, revoke pending
invites, and stop/restore sales-member access. They cannot disable themselves or
other admins, promote sales to admin, or invite an existing (even disabled) member
to bypass the access-management workflow. Disabled users remain registered but
have no new company product/image requests authorized. Cached content/downloads
cannot be recalled; signed image URLs remain usable until their five-minute expiry.

Links are sent **manually** by the admin through WhatsApp/email; automatic email
sending is not configured. Links contain 256-bit cryptographically random tokens
in the URL fragment (`/join#token=...`), expire after seven days, and are bound to
the verified email in `auth.users`, never user-editable metadata/JWT email claims.
Only a SHA-256 token hash is saved in the database; roster/invite RPCs never return
tokens/hashes. Generating a new invite for an email revokes its earlier pending
links. A link is displayed once and cannot be recovered after leaving the page.
Create/accept retries are idempotent; accepting an old link cannot reactivate a
disabled membership. The API denies anonymous preview and acceptance, preventing
company/email information from being exposed by a link alone.

The employee opens the link, registers/logs in with the invited email, verifies
their email, returns to the invite and explicitly accepts it. `/account` shows
employee-registration wording and hides company creation while an invite is
pending. The pending token stays in sessionStorage for that tab only, not in
LocalStorage or server query strings. Use the original tab or reopen the original
invite after verification in another browser/tab. Auth redirects remain exactly
`/auth/callback`; no additional Supabase redirect URL or secret key is required.
Joining does not upload/delete local products or quotation drafts. A user can be
invited to multiple companies; links to cloud/team explicitly select the company.

`npm test` runs the SQL Editor verification script unmodified in local PostgreSQL
(PGlite), with Auth/Storage platform schemas stubbed, as well as token/URL tests.
This is not a substitute for running the script in the real Supabase project.

Run `node scripts/test-team-browser.cjs` against the local production server for
isolated mobile invitation/team acceptance (same Playwright environment variables
as the cloud browser test). It mocks all Supabase requests and tests manual-link
generation/retry, employee registration and explicit join, multi-company routing,
wrong-email denial, stop/restore, old-link protection, revoke and logout.

## Grouped sales product-management permission

Apply ONLY `supabase/migrations/202610040003_product_management_permission.sql`
once as postgres after the three earlier migrations. Run the new verification
`supabase/tests/product_management_permission.sql` separately before pushing the
UI. It rolls back every synthetic record and does not create/remove Storage files.
The migration adds `company_members.can_manage_products boolean not null default
false`: existing and newly invited sales members remain read-only unless an admin
explicitly grants permission. Admins retain full product access by role.

On `/team`, each sales member has ONE **产品管理（新增、编辑、删除）** checkbox.
Only a current company's active admin can change it via a restricted RPC. The
flag is company/member scoped, never promotes the sales member to admin and never
grants team, invitations, permission settings or billing access. Members still
cannot directly update their membership, role or this flag through the Data API.
The previous roster RPC is retained for old-client compatibility; the new UI uses
`get_company_team_permissions` to include the permission flag.

Product INSERT/UPDATE (including soft deletion) and image upload/unused-image
cleanup RLS all require an active admin or authorized sales member. Read policies,
immutable metadata, revision conflict checks, private bucket and no-overwrite/live
image protection are retained. Bulk import stays admin-only both in the UI and
the database (sales inserts require `source_key is null`).

Revoking this flag removes write access on subsequent database/storage requests,
not read/search/share access. Stopping company access overrides the flag entirely;
admins can configure the stored flag while a member is stopped, but it does not
reactivate them. Restoring company access applies their currently saved flag.
The cloud UI rechecks membership/permission on refresh, focus and every two minutes;
a changed capability closes any open editor. Even before UI refresh, RLS denies
new unauthorized writes. Local browser product editing is unrelated to company
permissions, and completed downloads/shares cannot be revoked.

This is a catalog and quotation tool;
inventory, POS checkout, payments, invoices, accounting, and ERP are out of scope.
