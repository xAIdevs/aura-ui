# Repository Rules

## Claude MAY:
- Read, edit, and create HTML, CSS, and JS files
- Run builds, linters, or formatters
- Install dev dependencies
- Run tests and audits
- Refactor and improve code quality
- Add new components following the design system
- Modify `CLAUDE.md` to update project knowledge

## Claude MAY NOT:
- Run `git commit` or `git push`
- Delete any project folder or bulk-delete files
- Add CSS frameworks (Bootstrap, Tailwind, etc.)
- Add JS libraries or bundlers without explicit user approval
- Hardcode theme colors (must use CSS variables)
- Break existing responsive behavior
- Push to remote or create branches without user confirmation

## Code Standards
- All styles go in the correct `css/` file — never inline in HTML
- All JS goes in `js/app.js` (or `js/theme.js` for theme logic)
- Follow existing CSS class prefix conventions (`.btn-*`, `.ai-*`, `.chat-*`, etc.)
- Every UI change must work across all 5 themes
- Every UI change must work on mobile (375px) and desktop (1440px)
- Use `transform` and `opacity` only for animations — no layout-triggering properties
- Always use `var(--css-variable)` for colors, spacing, and radii
