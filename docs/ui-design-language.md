# Aera UI design language

The account area (`/demo/cursor-dashboard/*` today, the real user panel next) is built from **shadcn/ui
components** (style `base-nova`, Base UI primitives) and **Tailwind v4**, themed in one file. This
document is the rulebook. The living version of it is `/demo/cursor-dashboard/kit`: when a token or a
pattern changes, that page changes with it.

## Layers

| Layer | Where | Rule |
| --- | --- | --- |
| Tokens | `src/styles/aera.css` | The only place colours, radius and base type are defined. Scoped to `.aera`. |
| Components | `src/components/ui/*` | shadcn originals. Added with `npx shadcn@latest add <name>`. **Never edited** (the admin area uses them too). |
| Patterns | `src/components/aera/*` | Compositions of shadcn components that carry our page conventions. No new primitives. |
| Pages | `src/components/<feature>/*`, `src/app/**` | Only compose patterns and shadcn components. No CSS modules, no hand-rolled controls. |

If something is missing, the order of preference is: a shadcn component, a composition of shadcn
components in `aera/`, and only then a third-party component added through the shadcn CLI (the activity grid,
`ui/github-activity.tsx`, is the one so far), and only then custom code.

## Scope

Wrap a route in `<AeraScope>` (`src/components/aera/scope.tsx`) and import `@/styles/aera.css` in its
layout. The scope class is also put on `<body>` while mounted, because popovers, menus and dialogs are
portalled to `<body>`; without that they would lose their colours. Nothing outside the scope changes:
the home page, the legacy portal and the admin area do not load this stylesheet.

`aera.css` also defines the `data-horizontal` / `data-vertical` variants that shadcn's components use for Base UI's
`data-orientation` (shadcn's own stylesheet is not installed here); without them Separators have no size.

## Tokens

- **Surfaces**: page `background` `#f7f7f7`, `card` `#fdfdfd`, hairline `border` `#ececec`, controls use
  `input` `#e2e2e2`. Cards have a 1px ring, no shadow. Popovers get a soft shadow.
- **Ink is the action colour**: `primary` `#141414`. One primary button per card.
- **Orange is the data colour** (`brand`, Cloudflare orange `#F38020`, also `ring`): meters, the activity grid, the lead chart series and focus rings. Never a button fill.
- **Status**: `success` green, `warning` amber, `destructive` crimson. Destructive buttons are tinted, not solid.
- **Charts**: `chart-1` (brand orange) and `chart-2` (blue) first, then the others. **No green** anywhere in data visuals. Use the tokens, never hex in JSX.
- **Radius**: base `0.625rem`; cards `rounded-xl`, controls `rounded-lg`, badges pill.
- Dark mode is not done. The variable structure follows shadcn's, so a `.dark` block can be added later.

## Type and scale

Inter, loaded locally. The scale is shadcn's default: 14px body, 32px controls.

| Use | Class |
| --- | --- |
| Page figure | `text-3xl font-medium tracking-tight` |
| Page title | `text-2xl font-medium tracking-tight` |
| Card / plan title | `text-base` or `text-lg font-medium` |
| Body, rows, cells | `text-sm` |
| Secondary | `text-sm text-muted-foreground` |
| Caption, table header, legend | `text-xs text-muted-foreground` |

Only weights 400 and 500. Hierarchy comes from size and colour. Numbers that change or line up use `tabular-nums`.

## Layout

Every page is:

```tsx
<Page>
  <PageHeader title description actions />
  <Section label description actions> …cards… </Section>
</Page>
```

- `Page`: a plain `flex flex-col gap-6` stack. The **shell** decides width and margins (below); form-like pages
  pass `className="max-w-3xl"` and sit left-aligned in the column.
- `PageHeader`: title, one line of description, actions on the right (they wrap under the title when narrow).
- `Section`: a small label (`text-sm font-medium`) above a group of cards. Do not nest sections.
- `SettingRow`: title and help text on the left, control on the right; stacks when its **container** is narrow.
- Shell (`cursor-dashboard/shell.tsx`): a quiet top line (logo, divider, "Back to Agents"), then a fixed left nav and a
  centred content column. At 1920 wide the band is 1646px with 137px margins: nav 366, gap 60, content 1220
  (expressed as `clamp()`s of the viewport so it scales down). The nav is plain `Link` pills with group dividers;
  the user block has a `···` menu. **No collapsing, no drawer, no breadcrumb bar, and no shadcn `Sidebar`.**
  Below `lg` the nav stacks above the content as a horizontally scrolling row of pills.

## Responsive rules

1. **Containers decide, not the viewport.** Card grids use container queries (`@container` on the wrapper,
   `@xl:`/`@2xl:`/`@4xl:` on the grid) so they adapt to the sidebar being open or closed.
   Plan cards: 1 → 2 → 3 columns. Stats: 2 → 4. Current plan + on-demand: stacked → side by side.
2. **A page never scrolls sideways.** Wide things scroll inside their own box: `DataTable` (shadcn `Table`
   container), and the activity grid, which shows as many weeks as fit, newest last.
3. **Tables drop columns, not meaning.** Give `DataTable` columns `hideBelow: "sm" | "md" | "lg"`; put the
   least important column last. Right-align numbers.
4. **Dialogs fit the screen**: `max-h-[92dvh] overflow-y-auto`, full width minus 2rem on phones; the plan
   dialog goes 4 → 2 → 1 columns.
5. Toasts (sonner) are for transient confirmations; `Alert` is for ones that should stay on the page.

## Component map

| Need | Use |
| --- | --- |
| Actions | `Button` (`default`, `outline`, `secondary`, `ghost`, `destructive`). Links-as-buttons: `render={<Link/>}` **and** `nativeButton={false}`. |
| Choose one of few | `ToggleGroup` (value is an array). Of many: `Select` (pass `items` so the trigger shows the label). |
| Text / money input | `Input`, `InputGroup` with `InputGroupAddon` for `$`, or an in-line button (card code + "充值"). Forms: `Field`, `FieldLabel`, `FieldDescription`, `FieldError` (set `data-invalid` on the `Field` and `aria-invalid` on the `Input`), `FieldGroup`. |
| Switch / checkbox | `Switch` for immediate settings, `Checkbox` inside dialogs that have a Save. |
| Dates | `DateRangePicker` (`Popover` + `Calendar`). |
| Tables | `DataTable` (`Table`). |
| Charts | `ChartContainer` + recharts, colours from `--chart-*` through the chart config. `UsageChart` is the model. |
| Overlays | `Dialog` for forms and choices, `AlertDialog` for confirmations (type-to-confirm for destructive ones), `DropdownMenu`, `Popover`, `Tooltip`. |
| Lists of things | `Item` (`IntegrationItem`), separated by `Separator` inside one `Card`. |
| Filters over a list | `Tabs` (`variant="line"`), only the triggers. |
| Chat / conversation thread | `MessageGroup` > `Message` > `MessageAvatar` + `MessageContent` (`MessageHeader`, `Bubble` > `BubbleContent`); "mine" is `Bubble variant="default" align="end"`, the other side `variant="muted"`. Not `MessageScroller` (needs an extra package); scroll to the bottom with a small effect. |
| Pick from a short list / long text | `Select` (pass `items`) / `Textarea`. |
| Questions and answers | `Accordion` (one open at a time). |
| Category entrances | Rare UI `Folder` (decorative: it cannot carry text, so the name and count sit under it). `stone` when idle, `black` and `open` when selected. |
| Several tables on one page | `Tabs` with `TabsContent` (one `DataTable` each) instead of stacking them. |
| Paging | `Pagination` (native; links are anchors, so `preventDefault` when paging in place). |
| Pick one card | `RadioGroup` inside `FieldLabel` > `Field orientation="horizontal"` (the choice-card pattern). |
| Empty | `Empty` (`ComingSoon` for unbuilt pages). |
| Announcements | `NoticeBoard`: the one big reminder slot, in the top line to the right of the back link (`AppShell` `banner`, 66px high). Short, transient messages still use `toast`. |
| Feedback | `toast` from `sonner`; `Alert`; `Spinner` inside a disabled button while pending. |

## Before writing a component

Check shadcn first (the component list at ui.shadcn.com/docs/components, and whether it is in the base-nova registry), then
install it with the CLI. Only when shadcn has nothing, compose shadcn parts in `aera/`. So far that is `KeyValueList` (shadcn has no
description list), `DataTable` (a thin layer over `Table`; shadcn's "Data Table" is a TanStack recipe, not a registry item),
`UsageMeter`, `NoticeBoard` and `PricingCard`. Copy-to-clipboard, countdowns and steppers do not exist in shadcn either: a `Button` plus
`toast`, plain text, or leave them out.

## Charts

Charts are shadcn `Chart` (recharts): `ChartContainer` + `ChartTooltip(Content)` with a chart config, never raw hex in JSX.
Conventions (see `panel-demo/traffic-charts.tsx`):
- **Colour**: the main series is `--chart-1` (brand orange; download), the secondary is `--chart-5` (neutral grey; upload).
  A forecast is a dashed line of the same colour, a quota or average is a reference line. No green.
- **Shape**: bars are pills (`radius` on both ends; in a stack, round the outer end of each segment), lines have round caps,
  donut segments have `cornerRadius` and `paddingAngle`, areas fade to transparent.
- **Numbers**: sizes go through one formatter (`formatMb`), tooltips print sizes not raw numbers; KPI numbers carry a small
  chart of their own (a sparkline), so the picture comes first and the text second.
- **One source**: every chart on a page is derived from the same data (`lib/demo/traffic-model.ts`), so totals agree.
The look follows Amicro's Mono Charts (MIT; recipes only, no code copied). Its components are recharts demos with
fixed data and a dark card, so they were not installed.

## Patterns in `src/components/aera`

`Page`, `PageHeader`, `Section`, `SettingRow` (page-layout), `StatCard` / `Stat`, `UsageMeter`, `PlanCard`,
`DataTable`, `DateRangePicker`, `UsageChart`, `NoticeBoard`, `AlertBar`, `PricingCard`, `KeyValueList`, `IntegrationItem`, `BrandGlyph`,
`AeraScope`.

## Don't

- Don't write a `.module.css` or inline `style` for layout in a page.
- Don't edit files in `src/components/ui`. Wrap them.
- Don't use hex colours or `bg-[#...]` in JSX. Add or reuse a token.
- Don't use more than one solid primary button in a card, or orange as a fill.
- Don't add a font weight above 500.
- Don't size things in `px` where a Tailwind step exists; don't set widths that the container can't honour at 390px.

## Adding a page

1. `src/app/<route>/page.tsx` renders a component; the layout already provides the shell.
2. Build it from `Page` → `PageHeader` → `Section` → shadcn cards and the patterns above.
3. Check 1920, 1280, 1024, 768 and 390 wide: no horizontal page scroll, dialogs and menus open inside the screen.
4. If you needed something new twice, turn it into a pattern in `aera/` and add it to the kit page.

## Third-party components

`src/components/ui/github-activity.tsx` is from Rare UI (rareui.com): MIT + Commons Clause, **credit required**.
The credit link lives in the account area's footer and in `README.md`; keep both, and keep the notice at the top of
the file. It is the only file in `ui/` we have edited (two props and one colour, noted in its header).

`src/components/ui/split-flap-display.tsx` is adapted from Componentry's Split Flap Display (21st.dev, MIT). It was rewritten
so the cells can flip through a caller-supplied character set (the original only handled A-Z and digits) and so it uses our
tokens; the source header keeps the origin. It is used only by `NoticeBoard`.

`src/components/ui/folder-component.tsx` is from Rare UI (same licence and credit as above): the docs page uses it for its category
entrances. Edits (listed in its header): `size` takes a number, an `open` prop, a `stone` theme, and the perspective is no
longer scaled twice.

## Price cards

`PricingCard` (`aera/pricing-card.tsx`) copies GitBook's pricing page, measured at 1920 wide: 16px radius, 1px `hairline` border on a
warm off-white (`stone-50`), 34px top and 24px side padding, 16px between blocks, a 38px pill button; the highlighted plan is white
with a brand-coloured border and a dark button. Text uses the stone scale (`stone-900` / `stone-500`). It is the plain, in-app
price card. The home page's price cards (pixel art, brand icons) are the decorated ones, and the two are not shared.
