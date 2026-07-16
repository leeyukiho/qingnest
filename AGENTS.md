<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **qingnest** (1108 symbols, 3025 relationships, 91 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/qingnest/context` | Codebase overview, check index freshness |
| `gitnexus://repo/qingnest/clusters` | All functional areas |
| `gitnexus://repo/qingnest/processes` | All execution flows |
| `gitnexus://repo/qingnest/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |
| Work in the Ui area (111 symbols) | `.claude/skills/generated/ui/SKILL.md` |
| Work in the Pages area (92 symbols) | `.claude/skills/generated/pages/SKILL.md` |
| Work in the Config area (88 symbols) | `.claude/skills/generated/config/SKILL.md` |
| Work in the App area (69 symbols) | `.claude/skills/generated/app/SKILL.md` |
| Work in the Deployment area (17 symbols) | `.claude/skills/generated/deployment/SKILL.md` |
| Work in the Cluster_20 area (13 symbols) | `.claude/skills/generated/cluster-20/SKILL.md` |
| Work in the Cluster_19 area (9 symbols) | `.claude/skills/generated/cluster-19/SKILL.md` |
| Work in the Cluster_27 area (9 symbols) | `.claude/skills/generated/cluster-27/SKILL.md` |
| Work in the Cluster_18 area (7 symbols) | `.claude/skills/generated/cluster-18/SKILL.md` |
| Work in the Cluster_23 area (7 symbols) | `.claude/skills/generated/cluster-23/SKILL.md` |
| Work in the Cluster_26 area (7 symbols) | `.claude/skills/generated/cluster-26/SKILL.md` |
| Work in the Cluster_17 area (6 symbols) | `.claude/skills/generated/cluster-17/SKILL.md` |
| Work in the Cluster_21 area (6 symbols) | `.claude/skills/generated/cluster-21/SKILL.md` |
| Work in the Cluster_25 area (6 symbols) | `.claude/skills/generated/cluster-25/SKILL.md` |
| Work in the Cluster_16 area (4 symbols) | `.claude/skills/generated/cluster-16/SKILL.md` |
| Work in the Cluster_24 area (4 symbols) | `.claude/skills/generated/cluster-24/SKILL.md` |
| Work in the Cluster_28 area (4 symbols) | `.claude/skills/generated/cluster-28/SKILL.md` |

<!-- gitnexus:end -->
