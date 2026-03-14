// AURA Theme Switcher
// Themes: dark, black, white, sunset, ocean

const THEMES = ['dark', 'black', 'white', 'sunset', 'ocean'];
const THEME_LABELS = {
  dark:   'Dark',
  black:  'AMOLED',
  white:  'Light',
  sunset: 'Sunset',
  ocean:  'Ocean'
};
const THEME_COLORS = {
  dark:   '#7C3AED',
  black:  '#9333EA',
  white:  '#7C3AED',
  sunset: '#F97316',
  ocean:  '#0EA5E9'
};

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('aura-theme', theme);
  // Update all theme option buttons
  document.querySelectorAll('[data-theme-btn]').forEach(btn => {
    btn.classList.toggle('current', btn.dataset.themeBtn === theme);
  });
  // Update meta theme-color for mobile
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
  meta.content = THEME_COLORS[theme] || '#7C3AED';
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

// Build theme switcher UI into any element with id="theme-switcher"
function buildThemeSwitcher(containerId = 'theme-switcher') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = THEMES.map(t => `
    <button class="theme-option" data-theme-btn="${t}" title="${THEME_LABELS[t]}" onclick="applyTheme('${t}')">
      <span class="theme-swatch" style="background:${THEME_COLORS[t]}"></span>
      <span class="theme-label">${THEME_LABELS[t]}</span>
    </button>
  `).join('');
  // Mark current
  const curr = getSavedTheme();
  el.querySelectorAll('[data-theme-btn]').forEach(btn => {
    btn.classList.toggle('current', btn.dataset.themeBtn === curr);
  });
}

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  buildThemeSwitcher();
  buildThemeSwitcher('theme-switcher-sidebar');
  buildThemeSwitcher('theme-switcher-settings');
});
