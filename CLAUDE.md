# EduSpace Allocator

Spec: [README.md](README.md). Build plan and task IDs: [PLAN.md](PLAN.md). Stack: Next.js App Router, TypeScript strict, Tailwind + shadcn/ui, MongoDB Atlas (Mongoose), Auth.js.

## Design system (mandatory for all UI work)

All UI follows the EduSpace design system: https://claude.ai/artifact/58sQU8fyC1kGAdBL2o9xmQ

- Before building or changing UI, read its `project/README.md` and `project/tokens.json` (Artifact tool, `action: "read"`, `path`). For a component, also read `project/components/<Name>/README.md` and its `preview.html`.
- Tokens are the single source of truth. Declare them as CSS variables in `app/globals.css` (light on `:root`, dark on `.dark`) and expose them through `tailwind.config`. Never hard-code hex values, font sizes or radii in components.
- Fonts: Geist (`--font-sans`) for text and figures, Geist Mono (`--font-mono`) for nav, buttons, badges, tags, table headers, breadcrumbs, dates and scores. Load them with `next/font/google`.
- shadcn mapping: `--background` → `surface-sunken`, `--card` → `surface`, `--primary` → `accent-strong`, `--primary-foreground` → `on-accent`, `--muted-foreground` → `ink-muted`, `--border` → `border`, `--input` → `border-control`, `--ring` → `focus`, `--radius` → `radius-md`. Restyle shadcn primitives to match the system's components; don't ship shadcn defaults.
- Rebuild the system's components in `src/components/ui` and `src/components/shared` with the same names and props: Button, IconButton, ActionTile, Badge, Tag, Delta, StatCard, Progress, SegmentBar, DataTable, CriterionRow, NavItem, Breadcrumb, SearchField. Use lucide-react icons (stroke 1.6, 16px in controls, 18px in nav).
- Key rules: one primary button per view; `accent` is a fill colour only, so orange text uses `accent-ink`; statuses always carry a word and take their tone from the README's status vocabulary; deltas carry a sign and an arrow; numbers use tabular numerals; borders before shadows; a 2px `focus` ring on everything interactive; both themes pass contrast.
- Copy: Title Case for titles, nav and buttons; sentence case for descriptions; never show algorithm names (users see "Smart Allocation" and "Demand Insights"); call scores "compatibility score", never a probability; ₹ with `en-IN` grouping; never expose a learner's exact location to other roles.
- If a screen needs something the system doesn't cover (charts, map layers, forms, dialogs, empty states), design it from the same tokens. Then add it to the design system (README section or new component with preview) so the system stays the reference.
