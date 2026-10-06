# Project Launchpad — batch 2

Internal handoff, not rendered as UI instructions.

## Deployment order

1. Confirm a database backup/restore path. Apply
   `supabase/migrations/202610060002_launchpad_catalog.sql` once, after batch 1.
   Existing products/quotes/files and identifiers are preserved. The migration
   creates a trigram index for cloud search and may briefly lock the product
   table; schedule outside active catalog editing/importing.
2. Run `supabase/tests/launchpad_catalog.sql` (read-only/rollback).
3. Deploy batch 2 application. No new environment secrets/redirect URLs needed.
4. In a TEST company, open `/catalog-settings?company=<id>` as an admin. Test a
   custom prefix and automatic new code; verify a manually supplied code works.
5. Download the CSV template; use a few real-shaped test rows. Preview must not
   write products. Existing codes are skipped, not overwritten. Review results.
6. Confirm search can find an item beyond the first page, paging keeps an active
   unsaved quotation, and decimal quantities/units appear in generated PDFs.

After producing decimal-quantity quotes, do not roll back to an old application
that only validates integers. Fix-forward or use a compatible release; database
backups are not a substitute for preserving new quotes during rollback.

## Implemented

- Keyset paging (50 rows); full-company search for code/name/tags/category/notes.
  Exact total matching count returned per search; `%`/`_` treated as literal text.
  Old network responses cannot replace a newer search. Only one page is rendered.
- Number prefix/digit count/next value and auto/manual mode, admin-only. Internal
  UUID never changes. Auto reservations retry by UUID, skip existing codes and
  allow gaps. Manual/CSV codes are not renumbered. Settings use revision checks.
- Unit/category/description/service flag optional. Quantity up to 3 decimals;
  each line rounded half up to cents in BOTH SQL and JS fixed-point math. Stored
  unit/description/type is a quotation snapshot, not a link to mutable live data.
- New uploaded images have a 320px max-side thumbnail alongside originals. List
  signs/loads thumbnails lazily; detail/share fetches the original. Legacy photos
  fall back to original lazily; no bulk image conversion/reupload occurs.
- CSV UTF-8 with comma/semicolon/Tab, max 5MB/10,000 records/40 columns. Mapping,
  validation, existing-code check, preview and escaped downloadable result CSV.
  Leading zeros retained when present in source CSV; cannot recover zeros Excel
  already discarded. CSV multiline record errors show physical starting lines.
- Import RPC admin-only, max 100 records/request, per-row savepoints, company lock,
  import UUID + row identity for safe retries. Existing code never overwritten.
  Product cap applies to BOTH direct inserts and import RPC. Quota downgrade
  retains existing products and permits edits; further adds are denied at cap.
- Product insert lost responses are confirmed using normalized price/fields and
  photo digest; repeat inserts cannot silently overwrite a different cloud row.
- First-batch account/platform/permission and old quote workflow regression kept.

## Boundaries

- File and progress live only in current-page memory. Pausing completes the
  current request first. On network failure, stay on page and retry the SAME
  task. After leaving, re-preview the original CSV: already-added codes are
  skipped, not overwritten. Do not promise persistent background import jobs.
- Changed mapping/data requires a new preview/import ID. Successful old rows
  are retained. Failed rows can be retried after a quota correction without
  recreating successful rows. Results distinguish invalid/duplicate/failed.
- No image URL ingestion, remote file fetching, Excel binary parser or bulk
  picture import; images can be added through the existing upload afterwards.
- Product cap is now enforced. Storage cap and feature JSON remain RESERVED
  only, labelled in platform UI; no claim of complete subscription paywalls.
- Bulk price update, customer book, default quotation terms, duplicate quote,
  temporary quote lines, Paid/statistics and public catalog remain later batches.
- No inventory, orders, payments, translation switcher or visual redesign.

## Local verification

`npm test` includes the actual migration in isolated PGlite PostgreSQL with
pg_trgm, including a 10,000-product fixture and 200 unique keyset pages.
`scripts/test-catalog-browser.cjs` uses local fake Auth/Data/Storage only and tests
mobile off-page search, stale responses, numbering, thumbnail, decimal PDF,
CSV preview/retry and admin boundaries. Account and legacy quotation browser
scripts run against their own local fixtures; never perform production writes.
