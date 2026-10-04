# SalesGo interface

Primary reference: Figma file `ebDCNP5QmGwo0p7aFy8vRZ`, frames Admin Home
`1:3`, Salesman Home `5:66`, Salesman Plus Home `5:174`, Quotation `5:329`.
Figma remains unchanged. The app implements its layout and visual hierarchy,
not its 6–11px text, 22px inputs or fixed frame height.

## Shared system

`app/globals.css` defines monochrome surface/text/border tokens, a 4px spacing
scale, 10/16/22px radii, 48px controls (44px compact actions), 16px input text,
system sans typography and visible keyboard focus. Inputs avoid iOS focus zoom.
No new runtime package or external font request is needed.

`app/ui.js` supplies Button, NavLink, PageHeader, Panel, Status, EmptyState,
DesignIcon, FloatingAction and a native Modal. Product forms trap focus through
the native dialog, close on Escape/backdrop when not saving, lock body scroll
and restore focus. Product detail retains its existing native dialog behavior.

Mobile catalog is one column; tablet two; desktop three inside a bounded 1120px
workspace. Account/quotation/management pages use a 720px reading width. All
business content grows and scrolls naturally rather than fitting a fixed frame.
The floating quotation/home control has a 56px touch target and safe-area offset;
quotation input focus hides it while typing. Pages reserve bottom scroll space.
Loading, dirty, denied and failed-save states remain visible and actionable.

## Function mapping

- Order List/Select Order/New Order mean quotations, not a newly introduced order
  feature. Existing Chinese feature names and routes remain.
- Admin invitation shortcut links to the existing employee invitation form.
- Salesman Plus means the existing product-management flag, not a new role.
- Grey product placeholders become dynamic product cards. No placeholder product
  names/prices/customer information from Figma enter the application data.
- The quotation layout begins with customer information, then products, quotation
  totals and the preserved read-only company snapshot. Customer phone remains
  optional, as in the existing business validation.
- Cloud product refresh and quotation/branding reload remain separate operations;
  the latter is under the expandable cloud/permissions information section.
- Generation/sharing, optimistic version checks, ownership, Pending/Success,
  trash retention, company isolation and all API/database rules are unchanged.

## Local Figma assets

Assets are downloaded exports, not redrawn icons or temporary remote links.
Intrinsic SVG dimensions are retained; touch-target wrappers are enlarged.

| Local file in `public/figma/` | Figma layer | Application slot |
| --- | --- | --- |
| profile.svg | 5:7 (24×24) | Profile/page header |
| search.svg | 5:48 (11×11) | Product search input |
| add.svg | 5:53 (14×14) | New-product button |
| quotation-fab.svg | 5:64 (46×46 composite) | Floating quotation control |
| count.svg | 5:29 (17×17) | Cart-count backing |
| quotation.svg | 5:363 (24×24) | Quotation/page header |
| home-fab.svg | 5:330 (46×46 composite) | Floating return-to-catalog control |
| divider.svg | 5:525 / 5:460 (326×1) | Quotation total divider |

## Verification

`npm test` exercises unchanged business/database logic. `npm run build` verifies
production compilation. `scripts/test-workspace-browser.cjs` uses ONLY a local
API fixture, never live Supabase writes. It includes the existing workflow tests
and `scripts/ui-browser-checks.cjs` presentation checks for 320/390/768/1280px:
overflow, touch-target heights, input typography and loaded local Figma assets.
Optional `SALESGO_TEST_SCREENSHOTS` exports mobile/desktop review screenshots.
Fixture builds use fresh ignored `.next-salesgo/ui-...` directories so local
test URLs do not overwrite the normal production configuration. Normal builds
keep `.next`. If OneDrive locks its previous output, set the local-only
`SALESGO_ISOLATED_BUILD=production-check` to verify a production-configured
build in a separate directory. No existing cache or project files are deleted.

This redesign needs no additional SQL, environment variable, billing permission,
subscription or production data migration. Push/deployment and a real iPhone/
Android acceptance check remain separate from local automated verification.
