// =============================================
// AURA – theme.js  (10 themes + floating panel)
// =============================================

const THEMES = [
  'dark', 'black', 'white', 'sunset', 'ocean',
  'aurora', 'neon', 'rose', 'midnight', 'forest'
];

const THEME_META = {
  dark:     { label: 'Dark',     color: '#7C3AED', bg: '#0A0A0F', emoji: '🌑' },
  black:    { label: 'AMOLED',   color: '#9333EA', bg: '#000000', emoji: '⬛' },
  white:    { label: 'Light',    color: '#7C3AED', bg: '#F8F7FF', emoji: '☀️' },
  sunset:   { label: 'Sunset',   color: '#F97316', bg: '#0F0805', emoji: '🌅' },
  ocean:    { label: 'Ocean',    color: '#0EA5E9', bg: '#020B18', emoji: '🌊' },
  aurora:   { label: 'Aurora',   color: '#00D9FF', bg: '#040D1A', emoji: '🌌' },
  neon:     { label: 'Neon',     color: '#FF0090', bg: '#0A0015', emoji: '⚡' },
  rose:     { label: 'Rose',     color: '#E91E8C', bg: '#130810', emoji: '🌸' },
  midnight: { label: 'Midnight', color: '#6366F1', bg: '#04051A', emoji: '🌙' },
  forest:   { label: 'Forest',   color: '#10B981', bg: '#030E0A', emoji: '🌿' },
};

// ── Core apply / get / cycle ──────────────────
function applyTheme(theme) {
  if (!THEME_META[theme]) theme = 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('aura-theme', theme);

  // Update meta theme-color
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
  meta.content = THEME_META[theme].color;

  // Sync all switcher UIs
  document.querySelectorAll('[data-theme-btn]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeBtn === theme);
  });
  document.querySelectorAll('.theme-option-item').forEach(item => {
    item.classList.toggle('active', item.dataset.themeBtn === theme);
  });
}

function getSavedTheme() {
  return localStorage.getItem('aura-theme') || 'dark';
}

function initTheme() {
  applyTheme(getSavedTheme());
}

function cycleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const idx = THEMES.indexOf(current);
  applyTheme(THEMES[(idx + 1) % THEMES.length]);
}

// ── Floating theme panel (injects once into <body>) ───────────────
function buildFloatingThemePanel() {
  if (document.getElementById('aura-theme-panel')) return; // already built

  const panel = document.createElement('div');
  panel.id = 'aura-theme-panel';
  panel.setAttribute('aria-label', 'Theme selector');

  panel.innerHTML = `
    <button class="aura-theme-toggle" id="aura-theme-toggle" aria-label="Change theme" aria-expanded="false">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4"/>
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
      </svg>
      <span class="aura-theme-toggle-label">Theme</span>
    </button>
    <div class="aura-theme-dropdown" id="aura-theme-dropdown" role="menu">
      <div class="aura-theme-dropdown-title">Choose Theme</div>
      <div class="aura-theme-grid">
        ${THEMES.map(t => {
          const m = THEME_META[t];
          return `<button class="theme-option-item" data-theme-btn="${t}" onclick="applyTheme('${t}')" role="menuitem" title="${m.label}">
            <span class="theme-swatch-ring">
              <span class="theme-swatch-dot" style="background:${m.color};box-shadow:0 0 8px ${m.color}55;"></span>
            </span>
            <span class="theme-option-name">${m.emoji} ${m.label}</span>
          </button>`;
        }).join('')}
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  // Toggle open/close
  const toggle = panel.querySelector('#aura-theme-toggle');
  const dropdown = panel.querySelector('#aura-theme-dropdown');
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const open = dropdown.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (!panel.contains(e.target)) {
      dropdown.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      dropdown.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Mark current theme
  const curr = getSavedTheme();
  panel.querySelectorAll('.theme-option-item').forEach(item => {
    item.classList.toggle('active', item.dataset.themeBtn === curr);
  });
}

// Legacy: keep buildThemeSwitcher so existing HTML #theme-switcher divs still work
function buildThemeSwitcher(containerId = 'theme-switcher') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.style.display = 'none'; // hide legacy containers; floating panel handles it
}

// ── Auto-init ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  buildFloatingThemePanel();
});
