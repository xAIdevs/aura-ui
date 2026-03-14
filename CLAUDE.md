# AURA UI — Claude Development Guide

## Project Overview
**AURA** is a premium AI-powered dating app static website. Stack: HTML5, CSS3, Vanilla JS (no framework, no build tool). Fonts via Google Fonts. Theme stored in `localStorage`.

## Core Pages
| File | Purpose |
|------|---------|
| `index.html` | Landing page |
| `discover.html` | Card swipe (core feature) |
| `chat.html` | Messaging with AI chips |
| `matches.html` | Match list |
| `profile.html` | Profile view with AI score |
| `my-account.html` | Settings & dashboard |
| `search.html` | Filter + results grid |
| `login.html` / `signup.html` | Auth screens |
| `demo.html` | Component showcase |

## CSS Architecture
```
css/
  base.css        ← reset, typography, CSS vars, utilities
  layout.css      ← 3-panel layout, sidebar, breakpoints
  components.css  ← all UI components (source of truth)
  animations.css  ← keyframes + animation utility classes
  themes.css      ← 5 theme overrides (dark/black/white/sunset/ocean)
```

**Always add new styles to the correct file. Never inline styles in HTML.**

## Design System

### Themes (5 total, set via `data-theme` on `<html>`)
- `dark` (default) — violet `#7C3AED` on `#0A0A0F`
- `black` — AMOLED `#000000`
- `white` — light mode `#F8F7FF`
- `sunset` — orange `#F97316` on `#0F0805`
- `ocean` — cyan `#0EA5E9` on `#020B18`

### Key CSS Variables (always use these, never hardcode)
```css
--primary       /* theme primary color */
--secondary     /* theme secondary color */
--bg            /* page background */
--surface       /* card surface */
--text          /* primary text */
--text-2        /* secondary text */
--border        /* border color */
--radius        /* 16px — standard cards */
--radius2       /* 24px — large elements */
--radius3       /* 12px — inputs/small */
--glow          /* primary box-shadow glow */
```

### Typography
- **Display/Headings**: `Space Grotesk` (weights 400–700)
- **Body/UI**: `Inter` (weights 300–900)
- Never use system fonts for new UI elements.

### Component Prefixes (follow existing conventions)
- `.btn-*` — buttons
- `.form-*` — form elements
- `.g-card` — glass card base
- `.ai-*` — AI-specific components
- `.chat-*` — messaging components
- `.profile-*` — profile display
- `.modal-*` — modal/dialog
- `.vibe-tag` — personality tags (v1–v5)

## JavaScript
- `js/app.js` — all interactions (swipe, drag, modals, OTP, gallery, chat)
- `js/theme.js` — theme switching only
- **Vanilla ES6+ only.** No libraries. No `import`/`export` (no bundler).
- Use `data-*` attributes to hook JS to HTML, not IDs where possible.
- Always add passive listeners for touch events.

## Responsive Rules
| Breakpoint | Behavior |
|-----------|---------|
| `>1280px` | Full 3-panel layout |
| `1100–1280px` | Right panel hidden |
| `<1100px` | Sidebar collapses |
| `<768px` | Sidebar moves to bottom, single column, touch-first |

**Every new UI element must be tested at 375px (mobile) and 1440px (desktop).**

## AI Dating App — Feature Focus
- **AI Score Ring** — SVG circle with gradient stroke, `.ai-score-ring`
- **Compatibility Signals** — trait bars with fill percentages, `.ai-analysis-box`
- **AI Chips in Chat** — suggestion prompts, `.ai-chip`
- **Match Score Badge** — high/low variant on cards
- Maintain AI feel: futuristic, glassmorphism, purple-forward, glow effects.

## Code Quality Standards
- **Glass morphism pattern**: `backdrop-filter: blur(12px)` + semi-transparent `rgba` + border
- **Hover lift**: `translateY(-2px)` + stronger glow
- **Entrance animations**: use existing classes (`.animate-fade-up`, `.animate-scale-in`) with `.delay-*`
- **No magic numbers** — use CSS variables or named constants
- **Accessibility**: focus states must be visible, `aria-label` on icon-only buttons, `alt` on images
- **Performance**: no layout-triggering properties in animations (use `transform` + `opacity` only)

## Dos and Don'ts
**Do:**
- Use existing component classes before creating new ones
- Follow the 5-theme variable system for every color
- Test all interactions on mobile touch AND desktop drag
- Keep JS in `app.js`, keep theme logic in `theme.js`

**Don't:**
- Add CSS frameworks (Bootstrap, Tailwind, etc.)
- Use `!important` unless overriding a third-party style
- Hardcode hex colors — always use `var(--primary)` etc.
- Break the glassmorphism visual language with flat/solid backgrounds
- Commit or push code (see `.claude/settings.json`)
