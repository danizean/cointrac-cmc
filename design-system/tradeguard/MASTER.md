# Design System Master File — TradeGuard Institutional Terminal

**Project:** TradeGuard Crypto Market Intelligence MCP
**Category:** Dark-First Institutional Quant & Developer Terminal
**Design Dials:** Variance 7/10 (Modern Bento) | Motion 3/10 (Crisp Micro-Interactions) | Density 8/10 (Dense / Dashboard)

---

## Global Rules

### Color Palette (Dark-First Product Default)

| Role | Dark Hex (Default) | Light Hex | CSS Variable |
|------|--------------------|-----------|--------------|
| Background | `#070B14` | `#F8FAFC` | `--background` |
| Foreground | `#F1F5F9` | `#09090B` | `--foreground` |
| Card | `#0E1525` | `#FFFFFF` | `--card` |
| Card Elevated | `#131C31` | `#F1F5F9` | `--card-elevated` |
| Primary (Interactive) | `#38BDF8` | `#0284C7` | `--primary` |
| On Primary | `#070B14` | `#FFFFFF` | `--on-primary` |
| Accent / Hero CTA / RWA | `#F59E0B` | `#D97706` | `--accent` |
| On Accent | `#070B14` | `#FFFFFF` | `--on-accent` |
| Positive / LIVE / Bullish | `#10B981` | `#059669` | `--positive` |
| Destructive / Risk-Off | `#F43F5E` | `#E11D48` | `--destructive` |
| Muted Surface | `#162035` | `#E2E8F0` | `--muted` |
| Muted Foreground | `#94A3B8` | `#475569` | `--muted-foreground` |
| Border | `rgba(148, 163, 184, 0.14)` | `#E2E8F0` | `--border` |

**Color Discipline:** Obsidian canvas + Electric Sky interactive focus + Emerald positive/live + Institutional Amber Gold CTA/RWA + Rose negative/stress. Zero AI purple/pink gradients.

### Typography
- **UI / Display Font:** Plus Jakarta Sans (`--font-sans`)
- **Quant / Mono Font:** JetBrains Mono (`--font-mono`, `tabular-nums`)

### Anti-Patterns (Forbidden)
- No AI purple/pink glow gradients
- No dated royal-blue body text on light white boxes
- No emojis as structural icons (use Lucide SVG icons exclusively)
- No layout-shifting hover scale animations
- Never turn missing `null` market values into `0`
