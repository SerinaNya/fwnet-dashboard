<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Session constraints

- Use `pnpm` / `pnpm exec`, not `.cmd` executable paths. On network failures, report to the user; do not retry with proxies or other workarounds.
- Docker work is configuration/documentation only unless explicitly authorized; do not execute Docker commands.
- Requirements arrive incrementally. Ask about unresolved domain choices rather than inventing ownership, permissions, or data mappings.

## Commands and runtime

- Node >=24.15 is required for built-in `node:sqlite`; Docker uses Node 24.18. There is no SQLite ORM or native npm database driver.
- Development: `pnpm dev`. Focused checks: `pnpm exec eslint <changed-files>` and `pnpm typecheck`; production check: `pnpm build`.
- Persistence checks: `pnpm db:verify` and `node scripts/verify-network-route.mjs`; both isolate their database fixtures in temporary directories. There is no general `test` script.
- Full lint is `pnpm lint`; it currently has legacy hook-effect errors in `components/chart-area-interactive.tsx` and `hooks/use-mobile.ts`. Distinguish these from changed-file results.
- `pnpm format` rewrites all TS/TSX files; prefer a focused formatter invocation for scoped changes.
- If the installed Next docs path above is inaccessible, resolve `next/package.json` and use its sibling `dist/docs/`; pnpm's real package is under `node_modules/.pnpm/`.

## Data boundaries

- Business pages (`/maintainers`, `/asns`, `/roas`) use the root `NetworkDataProvider` → `/api/network` → `lib/server/network-store.mjs`. `/dashboard` is still template demo content.
- GET and successful POST return `{ error: null, data: snapshot }`. Provider requests are serialized; keep writes asynchronous and update UI only after server success.
- Authorization is derived server-side from the imported current-maintainer UUID (SerinaNya), not submitted `canEdit`/`isMine`. OIDC is not implemented; `isAdmin` is currently false and maintainer source changes are not accepted.
- ASN–maintainer links are many-to-many by UUID; imported ASNs may have no links. ROA ASN may be `null` for unallocated routes; never substitute ASN 0. Referenced ASNs cannot be deleted.
- The server canonicalizes CIDRs, rejects host bits and enforces Max Length bounds in `lib/server/route-cidr.mjs` / store validation; client form checks are partial and do not replace these checks.
- Network `updatedAt` values are integer Unix epoch milliseconds in SQLite and numeric API fields, not seconds or ISO strings. Writes use server `Date.now()`; import normalizes supported ISO timestamps. The v2 migration preserves existing instants and millisecond precision.
- `DATABASE_PATH` defaults to `data/fwnet.sqlite`. Never reset or test destructively against it; use a temporary database for verification.
- Initialization: `pnpm db:migrate`; import a converted JSON dataset only when explicitly requested, using its external path (for example `pnpm db:import -- /path/to/network.json`). Same-file reimport is a no-op; a different import into a nonempty database is rejected. Never infer missing owners from descriptions, and interpret source timestamps as UTC+8.
- Schema upgrades belong in `lib/server/migrations/` and require updating migration dispatch/version in `database.mjs`; opening the database applies pending migrations but does not seed data.
- Persist the entire `/data` directory (including WAL files). HTTPS reverse proxies require exact `PUBLIC_ORIGIN`; see README for configuration, imports and backups.

## UI conventions and version traps

- Read `.agents/skills/shadcn/SKILL.md` and relevant component docs for UI work. This is Tailwind v4 / shadcn `base-nova` using Base UI `render`, not Radix `asChild`.
- TanStack Table is v9: use `tableFeatures`, `useTable` and `table.FlexRender`, not v8 `useReactTable` / `get*RowModel` examples.
- Base UI Combobox label/search and submitted value are separate: UUID-valued maintainer choices must filter by name. `itemToStringValue` alone does not fix name search.
- `CardHeader` is Grid; use `CardAction` for right-aligned controls. `flex-row` alone does not change its display type.
- Business UI copy is Chinese. ASN displays as digits without `AS`; internal UUIDs are not displayed. Empty table fields stay blank; tables are unpaginated by default.
- ASN/ROA timestamps display in the browser's local timezone. Keep server/initial hydration output stable (`useSyncExternalStore` is used), then format locally; HTML `time.dateTime` remains ISO and sorting compares epoch numbers.
- ROA CIDR sorting uses `lib/route-sort.ts`: address family (IPv4 first), numeric address, then prefix length. Do not replace it with lexical sorting of route strings.
- All field changes belong in modals. Keep compact icon actions from increasing row height; do not equalize rows by adding tall placeholders. Use semantic theme colors for headers and unallocated rows.
- Sidebar business entries are maintained in `components/app-sidebar.tsx`; Settings, Get Help and the placeholder user menu are intentionally retained.
