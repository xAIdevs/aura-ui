// =============================================
// AURA – app.js
// All interactive behaviours (Vanilla JS, ES6+)
// =============================================

/* ─────────────────────────────────────────────
   1. PHOTO GALLERY
───────────────────────────────────────────── */

let currentPhoto = 0;
const photos = [
  { bg: 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)', emoji: '✨' },
  { bg: 'linear-gradient(135deg,#f093fb 0%,#f5576c 100%)', emoji: '🌸' },
  { bg: 'linear-gradient(135deg,#4facfe 0%,#00f2fe 100%)', emoji: '🌊' },
  { bg: 'linear-gradient(135deg,#43e97b 0%,#38f9d7 100%)', emoji: '🌿' },
  { bg: 'linear-gradient(135deg,#fa709a 0%,#fee140 100%)', emoji: '🌅' },
];

function goPhoto(index, event) {
  if (event) event.stopPropagation();
  const frame = document.querySelector('.photo-frame');
  if (!frame) return;

  currentPhoto = ((index % photos.length) + photos.length) % photos.length;

  const main = frame.querySelector('.main-photo');
  if (main) {
    main.style.background = photos[currentPhoto].bg;
    const emojiEl = main.querySelector('.photo-emoji');
    if (emojiEl) emojiEl.textContent = photos[currentPhoto].emoji;
  }

  frame.querySelectorAll('.photo-pill').forEach((p, i)  => p.classList.toggle('active', i === currentPhoto));
  frame.querySelectorAll('.photo-thumb').forEach((t, i) => t.classList.toggle('active', i === currentPhoto));
}

function nextPhoto(event) {
  if (event) event.stopPropagation();
  goPhoto(currentPhoto + 1, null);
}

function prevPhoto(event) {
  if (event) event.stopPropagation();
  goPhoto(currentPhoto - 1, null);
}

function initPhotoGallery() {
  const frame = document.querySelector('.photo-frame');
  if (!frame) return;

  frame.setAttribute('tabindex', '0');
  frame.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') nextPhoto(e);
    else if (e.key === 'ArrowLeft') prevPhoto(e);
  });

  let touchStartX = 0;
  frame.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  frame.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) dx > 0 ? prevPhoto(e) : nextPhoto(e);
  }, { passive: true });

  goPhoto(0, null);
}

/* ─────────────────────────────────────────────
   2. MATCH SELECTION
───────────────────────────────────────────── */

function selectMatch(element) {
  document.querySelectorAll('.match-item').forEach(el => el.classList.remove('active'));
  element.classList.add('active');

  const nameEl   = document.querySelector('.chat-partner-name');
  const avatarEl = document.querySelector('.chat-partner-avatar');
  if (nameEl   && element.dataset.name)   nameEl.textContent = element.dataset.name;
  if (avatarEl && element.dataset.avatar) avatarEl.src        = element.dataset.avatar;
}

/* ─────────────────────────────────────────────
   3. DISCOVER CARD ACTIONS
───────────────────────────────────────────── */

function getTopCard() {
  return document.querySelector('.discover-card:not(.swiped)');
}

function doAction(type) {
  const card = getTopCard();
  switch (type) {
    case 'like': {
      if (!card) break;
      card.classList.add('swipe-right');
      setTimeout(() => { card.classList.add('swiped'); loadNextCard(); }, 400);
      if (Math.random() < 0.2) setTimeout(() => openModal('match-modal'), 600);
      break;
    }
    case 'pass': {
      if (!card) break;
      card.classList.add('swipe-left');
      setTimeout(() => { card.classList.add('swiped'); loadNextCard(); }, 400);
      break;
    }
    case 'super': {
      if (!card) break;
      card.classList.add('super-like');
      showToast('Super Like sent! ⭐', 'info');
      setTimeout(() => { card.classList.add('swiped'); loadNextCard(); }, 600);
      break;
    }
    case 'boost':
      openModal('boost-modal');
      break;
    case 'msg':
      if (document.querySelector('a[href="chat.html"]')) window.location.href = 'chat.html';
      else openModal('message-modal');
      break;
  }
}

function loadNextCard() {
  const next = Array.from(document.querySelectorAll('.discover-card'))
    .find(c => !c.classList.contains('swiped'));
  if (next) next.classList.add('active');
}

function initDiscoverCards() {
  const deck = document.querySelector('.card-deck, .discover-deck');
  if (!deck) return;

  const first = deck.querySelector('.discover-card');
  if (first && !first.classList.contains('active')) first.classList.add('active');

  // Global keyboard shortcuts (only fire when no focusable element is active)
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); doAction('like'); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); doAction('pass'); }
    else if (e.key === 'ArrowUp')    { e.preventDefault(); doAction('super'); }
  });

  initCardDrag(deck);
}

function initCardDrag(deck) {
  let startX = 0, startY = 0, dragCard = null;

  function onStart(clientX, clientY) {
    dragCard = getTopCard();
    if (!dragCard) return;
    startX = clientX;
    startY = clientY;
    dragCard.style.transition = 'none';
  }

  function onMove(clientX, clientY) {
    if (!dragCard) return;
    const dx = clientX - startX;
    const dy = clientY - startY;
    dragCard.style.transform = `translateX(${dx}px) translateY(${dy * 0.3}px) rotate(${dx * 0.08}deg)`;
    const likeEl = dragCard.querySelector('.like-indicator');
    const passEl = dragCard.querySelector('.pass-indicator');
    if (likeEl) likeEl.style.opacity = String(Math.max(0, Math.min(dx / 80,  1)));
    if (passEl) passEl.style.opacity = String(Math.max(0, Math.min(-dx / 80, 1)));
  }

  function onEnd(clientX) {
    if (!dragCard) return;
    dragCard.style.transition = '';
    const dx = clientX - startX;
    const likeEl = dragCard.querySelector('.like-indicator');
    const passEl = dragCard.querySelector('.pass-indicator');
    if (likeEl) likeEl.style.opacity = '0';
    if (passEl) passEl.style.opacity = '0';

    if      (dx >  100) doAction('like');
    else if (dx < -100) doAction('pass');
    else                dragCard.style.transform = '';
    dragCard = null;
  }

  // Mouse drag
  deck.addEventListener('mousedown', e => {
    onStart(e.clientX, e.clientY);
    const onMm = e => onMove(e.clientX, e.clientY);
    const onMu = e => {
      onEnd(e.clientX);
      document.removeEventListener('mousemove', onMm);
      document.removeEventListener('mouseup',   onMu);
    };
    document.addEventListener('mousemove', onMm);
    document.addEventListener('mouseup',   onMu);
  });

  // Touch drag
  deck.addEventListener('touchstart', e => onStart(e.touches[0].clientX, e.touches[0].clientY),       { passive: true });
  deck.addEventListener('touchmove',  e => onMove(e.touches[0].clientX,  e.touches[0].clientY),       { passive: true });
  deck.addEventListener('touchend',   e => onEnd(e.changedTouches[0].clientX),                        { passive: true });
}

/* ─────────────────────────────────────────────
   4. MODAL SYSTEM
───────────────────────────────────────────── */

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('open'));
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = 'auto';
  setTimeout(() => { if (!modal.classList.contains('open')) modal.style.display = 'none'; }, 300);
}

// Click backdrop to close
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal') && e.target.id) closeModal(e.target.id);
  if (e.target.dataset.closeModal)                         closeModal(e.target.dataset.closeModal);
});

// Escape closes all open modals
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal.open').forEach(m => closeModal(m.id));
});

/* ─────────────────────────────────────────────
   5. OTP INPUT
───────────────────────────────────────────── */

function initOTP() {
  const boxes = [...document.querySelectorAll('.otp-box')];
  if (!boxes.length) return;

  boxes.forEach((box, i) => {
    // Digits only
    box.addEventListener('keypress', e => { if (!/[0-9]/.test(e.key)) e.preventDefault(); });

    box.addEventListener('input', () => {
      const v = box.value.replace(/\D/g, '');
      box.value = v ? v[0] : '';
      if (v && i < boxes.length - 1) boxes[i + 1].focus();
    });

    box.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].value = '';
        boxes[i - 1].focus();
      }
    });

    box.addEventListener('paste', e => {
      e.preventDefault();
      const digits = (e.clipboardData ?? window.clipboardData)
        .getData('text').replace(/\D/g, '');
      [...digits].slice(0, boxes.length - i)
        .forEach((d, j) => { if (boxes[i + j]) boxes[i + j].value = d; });
      boxes[Math.min(i + digits.length, boxes.length - 1)].focus();
    });
  });
}

function getOTP() {
  return [...document.querySelectorAll('.otp-box')].map(b => b.value).join('');
}

/* ─────────────────────────────────────────────
   6. SIGNUP MULTI-STEP WIZARD
───────────────────────────────────────────── */

let currentStep = 1;
const totalSteps = 6;

function showStep(n) {
  currentStep = Math.max(1, Math.min(n, totalSteps));

  document.querySelectorAll('.signup-step').forEach(s => s.classList.remove('active'));
  const target = document.querySelector(`.signup-step[data-step="${currentStep}"]`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i + 1 === currentStep);
    dot.classList.toggle('done',   i + 1 <  currentStep);
  });

  const fill = document.querySelector('.progress-fill');
  if (fill) fill.style.width = `${((currentStep - 1) / (totalSteps - 1)) * 100}%`;

  clearStepError();
}

function validateStep(step) {
  switch (step) {
    case 1: {
      const phone = document.querySelector('#phone-input,[name="phone"]');
      if (phone && phone.value.replace(/\D/g, '').length < 10) {
        showStepError('Enter a valid 10-digit phone number');
        return false;
      }
      return true;
    }
    case 2: {
      if (getOTP().length < 6) { showStepError('Enter the complete 6-digit OTP'); return false; }
      return true;
    }
    case 3: {
      const name   = document.querySelector('#name-input,[name="name"]');
      const dob    = document.querySelector('#dob-input,[name="dob"]');
      const gender = document.querySelector(
        'input[name="gender"]:checked,.gender-option.selected,.gender-btn.active'
      );
      if (!name?.value.trim()) { showStepError('Name is required');              return false; }
      if (!dob?.value)         { showStepError('Date of birth is required');     return false; }
      if (!gender)             { showStepError('Please select your gender');     return false; }
      return true;
    }
    case 4: {
      if (document.querySelectorAll('.tag.toggleable.on').length < 3) {
        showStepError('Select at least 3 interests');
        return false;
      }
      return true;
    }
    case 5: {
      const bio = document.querySelector('#bio-input,[name="bio"]');
      if (!bio || bio.value.trim().length < 20) {
        showStepError('Bio must be at least 20 characters');
        return false;
      }
      return true;
    }
    case 6: {
      const pref = document.querySelector(
        '.preference-option.active,input[name="preference"]:checked,.pref-btn.active'
      );
      if (!pref) { showStepError('Please select at least one preference'); return false; }
      return true;
    }
    default: return true;
  }
}

function nextStep() { if (validateStep(currentStep)) showStep(currentStep + 1); }
function prevStep() { showStep(currentStep - 1); }

function showStepError(msg) {
  const active = document.querySelector('.signup-step.active');
  if (!active) return;
  let err = active.querySelector('.step-error');
  if (!err) {
    err = document.createElement('p');
    err.className = 'step-error';
    active.appendChild(err);
  }
  err.textContent  = msg;
  err.style.display = 'block';
}

function clearStepError() {
  document.querySelectorAll('.step-error').forEach(e => { e.style.display = 'none'; });
}

/* ─────────────────────────────────────────────
   7. INTEREST TAGS TOGGLE
───────────────────────────────────────────── */

let selectedCount = 0;

function initInterestTags() {
  selectedCount = document.querySelectorAll('.tag.toggleable.on').length;
  _syncCountDisplay();

  document.querySelectorAll('.tag.toggleable').forEach(tag => {
    tag.addEventListener('click', () => {
      const wasOn = tag.classList.contains('on');
      tag.classList.toggle('on',  !wasOn);
      tag.classList.toggle('off',  wasOn);
      selectedCount += wasOn ? -1 : 1;
      _syncCountDisplay();
    });
  });
}

function _syncCountDisplay() {
  const el = document.getElementById('selected-count');
  if (el) el.textContent = selectedCount;
}

/* ─────────────────────────────────────────────
   8. TRAIT BARS ANIMATION
───────────────────────────────────────────── */

function animateTraitBars() {
  const fills = document.querySelectorAll('.trait-fill');
  if (!fills.length) return;

  const obs = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.style.width = en.target.dataset.w || '0%';
        obs.unobserve(en.target);
      }
    });
  }, { threshold: 0.1 });

  fills.forEach(fill => {
    fill.style.width      = '0%';
    fill.style.transition = 'width 0.8s ease';
    obs.observe(fill);
  });
}

/* ─────────────────────────────────────────────
   9. CHAT FEATURES
───────────────────────────────────────────── */

const AUTO_REPLIES = [
  "That's so interesting! Tell me more 😊",
  "I feel the same way! ✨",
  "Haha, you're funny! 😄",
  "Wow, really? I'd love to hear about that!",
  "That sounds amazing! 💫",
  "I totally agree with you!",
  "Oh interesting perspective! 🤔",
  "You seem really cool 😊",
  "Omg same! 😂",
  "Tell me more about yourself! 🌟",
];

function initChat() {
  const input   = document.querySelector('.chat-input, #chat-input');
  const sendBtn = document.querySelector('.send-btn, #send-btn, [data-action="send"]');

  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      const text = input?.value.trim();
      if (text) { sendMessage(text); if (input) input.value = ''; }
    });
  }

  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = input.value.trim();
        if (text) { sendMessage(text); input.value = ''; }
      }
    });
  }

  // AI suggestion chips fill the input
  document.querySelectorAll('.ai-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (input) { input.value = chip.textContent.trim(); input.focus(); }
    });
  });
}

function sendMessage(text) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  appendMessage('sent', text, time);
  scrollToBottom();

  // Simulate partner reply
  setTimeout(() => {
    showTypingIndicator();
    const delay = 1000 + Math.random() * 1000;
    setTimeout(() => {
      hideTypingIndicator();
      receiveMessage(AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)]);
    }, delay);
  }, 300);
}

function receiveMessage(text) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  appendMessage('received', text, time);
  scrollToBottom();
}

function appendMessage(type, text, time) {
  const messages = document.querySelector('.chat-messages');
  if (!messages) return;
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${type}`;
  bubble.innerHTML = `
    <span class="bubble-text">${escapeHtml(text)}</span>
    <span class="bubble-time">${time}</span>
  `;
  messages.appendChild(bubble);
}

function showTypingIndicator() {
  const messages = document.querySelector('.chat-messages');
  if (!messages || messages.querySelector('.typing-indicator')) return;
  const el = document.createElement('div');
  el.className = 'chat-bubble received typing-indicator';
  el.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  messages.appendChild(el);
  scrollToBottom();
}

function hideTypingIndicator() {
  document.querySelector('.typing-indicator')?.remove();
}

function scrollToBottom() {
  const messages = document.querySelector('.chat-messages');
  if (messages) messages.scrollTop = messages.scrollHeight;
}

function escapeHtml(str) {
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

/* ─────────────────────────────────────────────
   10. SEARCH & FILTERS
───────────────────────────────────────────── */

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function handleSearchInput(e) {
  const query = e.target.value.trim().toLowerCase();
  document.querySelectorAll('[data-searchable]').forEach(item => {
    item.style.display = item.textContent.toLowerCase().includes(query) ? '' : 'none';
  });
}

function initRangeSliders() {
  // Custom dual-thumb range sliders
  document.querySelectorAll('.range-slider').forEach(slider => {
    const minThumb = slider.querySelector('.thumb-min');
    const maxThumb = slider.querySelector('.thumb-max');
    const fillEl   = slider.querySelector('.range-fill');
    const minValEl = slider.querySelector('.range-min-val');
    const maxValEl = slider.querySelector('.range-max-val');
    if (!minThumb || !maxThumb) return;

    const rangeMin = parseInt(slider.dataset.min        ?? '0');
    const rangeMax = parseInt(slider.dataset.max        ?? '100');
    let   minV     = parseInt(slider.dataset.valueMin   ?? rangeMin);
    let   maxV     = parseInt(slider.dataset.valueMax   ?? rangeMax);

    function refresh() {
      const span = rangeMax - rangeMin;
      const lo   = ((minV - rangeMin) / span) * 100;
      const hi   = ((maxV - rangeMin) / span) * 100;
      minThumb.style.left = `${lo}%`;
      maxThumb.style.left = `${hi}%`;
      if (fillEl)   { fillEl.style.left = `${lo}%`; fillEl.style.width = `${hi - lo}%`; }
      if (minValEl) minValEl.textContent = minV;
      if (maxValEl) maxValEl.textContent = maxV;
    }

    function updateFromX(clientX, isMin) {
      const rect = slider.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const val  = Math.round(rangeMin + pct * (rangeMax - rangeMin));
      if (isMin) minV = Math.min(val, maxV - 1);
      else       maxV = Math.max(val, minV + 1);
      refresh();
    }

    function attachDrag(thumb, isMin) {
      thumb.addEventListener('mousedown', e => {
        e.preventDefault();
        const onMove = me => updateFromX(me.clientX, isMin);
        const onStop = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onStop);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onStop);
      });

      thumb.addEventListener('touchstart', () => {
        const onMove = te => updateFromX(te.touches[0].clientX, isMin);
        const onStop = () => {
          document.removeEventListener('touchmove', onMove);
          document.removeEventListener('touchend',  onStop);
        };
        document.addEventListener('touchmove', onMove, { passive: true });
        document.addEventListener('touchend',  onStop, { passive: true });
      }, { passive: true });
    }

    attachDrag(minThumb, true);
    attachDrag(maxThumb, false);
    refresh();
  });

  // Native <input type="range"> with a [data-for] output label
  document.querySelectorAll('input[type="range"].range-input').forEach(input => {
    const out = document.querySelector(`[data-for="${input.id}"]`);
    if (out) {
      out.textContent = input.value;
      input.addEventListener('input', () => { out.textContent = input.value; });
    }
  });
}

function initFilterChips() {
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('active'));
  });

  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.addEventListener('input', debounce(handleSearchInput, 300));
}

/* ─────────────────────────────────────────────
   11. PHONE INPUT
───────────────────────────────────────────── */

const COUNTRIES = [
  { code: '+1',  flag: '🇺🇸', name: 'United States'  },
  { code: '+44', flag: '🇬🇧', name: 'United Kingdom'  },
  { code: '+91', flag: '🇮🇳', name: 'India'           },
  { code: '+61', flag: '🇦🇺', name: 'Australia'       },
  { code: '+81', flag: '🇯🇵', name: 'Japan'           },
  { code: '+49', flag: '🇩🇪', name: 'Germany'         },
  { code: '+33', flag: '🇫🇷', name: 'France'          },
  { code: '+55', flag: '🇧🇷', name: 'Brazil'          },
  { code: '+86', flag: '🇨🇳', name: 'China'           },
  { code: '+34', flag: '🇪🇸', name: 'Spain'           },
  { code: '+39', flag: '🇮🇹', name: 'Italy'           },
  { code: '+7',  flag: '🇷🇺', name: 'Russia'          },
  { code: '+82', flag: '🇰🇷', name: 'South Korea'     },
  { code: '+52', flag: '🇲🇽', name: 'Mexico'          },
  { code: '+31', flag: '🇳🇱', name: 'Netherlands'     },
];

function initPhoneInput() {
  const picker     = document.querySelector('.country-picker');
  const phoneInput = document.querySelector('.phone-number-input, #phone-input');
  if (!picker) return;

  let current = COUNTRIES[0];

  // Build dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'country-dropdown';
  dropdown.style.cssText = [
    'display:none', 'position:absolute', 'z-index:1000',
    'background:var(--card-bg,#1a1a2e)', 'border:1px solid var(--border,#333)',
    'border-radius:10px', 'max-height:220px', 'overflow-y:auto',
    'min-width:230px', 'box-shadow:0 8px 32px rgba(0,0,0,.5)',
  ].join(';');

  dropdown.innerHTML = COUNTRIES.map((c, i) => `
    <div class="country-option" data-idx="${i}"
         style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;transition:background .15s">
      <span style="font-size:1.3em">${c.flag}</span>
      <span style="font-weight:600;min-width:38px">${c.code}</span>
      <span style="opacity:.7;font-size:.88em">${c.name}</span>
    </div>
  `).join('');

  const wrap = picker.parentElement;
  wrap.style.position = 'relative';
  wrap.appendChild(dropdown);

  picker.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  });

  dropdown.querySelectorAll('.country-option').forEach(opt => {
    opt.addEventListener('mouseenter', () => { opt.style.background = 'rgba(255,255,255,.07)'; });
    opt.addEventListener('mouseleave', () => { opt.style.background = ''; });
    opt.addEventListener('click', e => {
      e.stopPropagation();
      current = COUNTRIES[+opt.dataset.idx];
      const flagEl = picker.querySelector('.picker-flag');
      const codeEl = picker.querySelector('.picker-code');
      if (flagEl) flagEl.textContent = current.flag;
      if (codeEl) codeEl.textContent = current.code;
      dropdown.style.display = 'none';
    });
  });

  document.addEventListener('click', () => { dropdown.style.display = 'none'; });

  // US-style formatting while typing
  if (phoneInput) {
    phoneInput.addEventListener('input', () => {
      if (current.code !== '+1') return;
      let d = phoneInput.value.replace(/\D/g, '').slice(0, 10);
      if      (d.length > 6) d = `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
      else if (d.length > 3) d = `${d.slice(0,3)}-${d.slice(3)}`;
      phoneInput.value = d;
    });
  }
}

/* ─────────────────────────────────────────────
   12. TOAST NOTIFICATIONS
───────────────────────────────────────────── */

function showToast(message, type = 'success', duration = 3000) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:9999',
      'display:flex', 'flex-direction:column', 'gap:10px', 'pointer-events:none',
    ].join(';');
    document.body.appendChild(container);
  }

  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.cssText = [
    'display:flex', 'align-items:center', 'gap:10px',
    'padding:12px 18px', 'border-radius:12px',
    'background:var(--card-bg,#1e1e2e)', 'color:var(--text,#fff)',
    'box-shadow:0 4px 24px rgba(0,0,0,.45)', 'pointer-events:auto',
    'opacity:0', 'transform:translateY(14px)',
    'transition:opacity .3s ease,transform .3s ease',
    'min-width:220px', 'max-width:360px', 'font-size:.95rem',
  ].join(';');
  toast.innerHTML = `<span>${icons[type] ?? '✅'}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity   = '1';
    toast.style.transform = 'translateY(0)';
  });

  // Animate out then remove
  setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

/* ─────────────────────────────────────────────
   13. SCROLL ANIMATIONS
───────────────────────────────────────────── */

function initScrollAnimations() {
  const els = document.querySelectorAll('.animate-on-scroll');
  if (!els.length) return;

  const obs = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add('visible');
        obs.unobserve(en.target);
      }
    });
  }, { threshold: 0.8 });

  els.forEach(el => obs.observe(el));
}

/* ─────────────────────────────────────────────
   14. INIT ALL
───────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  initOTP();
  initInterestTags();
  animateTraitBars();
  initChat();
  initRangeSliders();
  initFilterChips();
  initPhoneInput();
  initScrollAnimations();

  // Page-specific inits driven by <body data-page="...">
  const page = document.body.dataset.page;
  if (page === 'discover') initDiscoverCards();
  if (page === 'signup')   showStep(1);
  if (page === 'profile')  initPhotoGallery();
});
