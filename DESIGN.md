# DESIGN.md: QingNest Pricing

## Source
- Reference URL: https://www.cloudflare.com/plans/
- Capture date: 2026-07-16
- Evidence: Firecrawl branding output and full-page content capture in `.firecrawl/`

## Design Summary
Use Cloudflare's information architecture, not its branding: a direct pricing headline, large comparable prices, one clearly recommended plan, and a full-width feature matrix. Preserve QingNest's black, white, cyan, emerald, and amber product language.

## Design Tokens
- Background: `#000000`; surfaces: `rgba(255,255,255,0.06)` only for the recommended plan.
- Text: white primary, zinc-400 secondary, zinc-500 labels.
- Accents: cyan for recommendation, emerald for savings, amber for deployment value.
- Radius: 6px or less. Pricing columns share borders instead of floating as isolated cards.
- Typography: existing Geist Sans; large prices use 60-72px, headings 36-60px, body 14-18px.

## Components
- Pricing columns: aligned heights, prominent renewal price, daily equivalent, compact CTA, four key quotas.
- Savings badge: always adjacent to paid renewal pricing and never communicated by color alone.
- Comparison table: semantic table, horizontal scrolling below tablet width, check and X icons with accessible labels.

## Page Patterns
1. Compact pricing hero.
2. Shared-border pricing comparison grid.
3. Full entitlement and quota matrix.

## Content Style
Use concrete limits, daily cost, and renewal savings. Avoid vague superlatives and hidden billing qualifications.

## Agent Build Instructions
Render only enabled plans returned by the public plan API. Keep all columns data-driven, retain keyboard focus states, and avoid layout shifts while loading.

## Rerun Inputs
workflow: firecrawl-website-design-clone
source_url: https://www.cloudflare.com/plans/
target_stack: React + Tailwind CSS
output: DESIGN.md
