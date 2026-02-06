// ============================================================
// BlindBug – Content Script
// Floating toolbar with: Box Blur, Save, Undo, Eraser, Hide Title
// ============================================================

(function () {
  'use strict';

  if (document.getElementById('blindbug-toolbar')) return; // prevent double-init

  // ---- State ----
  let activeTool = null;          // 'blur' | 'eraser' | null
  let isDrawing = false;
  let drawStart = null;
  let pendingRegions = [];        // unsaved blur rects (DOM elements)
  let savedRegions = [];          // saved blur rects (DOM elements)
  let undoStack = [];             // { type, element?, ... } for undo
  let titleHidden = false;
  let blurLevel = 18;             // current blur px (default 18)
  const BLUR_STEP = 4;
  const BLUR_MIN = 4;
  const BLUR_MAX = 40;

  // ---- Inline SVG icons ----
  const ICONS = {
    blur: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18" opacity="0.3"/></svg>`,
    save: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
    undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 105.64-11.36L1 10"/></svg>`,
    eraser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16a1.5 1.5 0 010-2.12L14.88 2a1.5 1.5 0 012.12 0L21 6.12a1.5 1.5 0 010 2.12L11 18"/><path d="M6 12l6 6"/></svg>`,
    title: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`,
    sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`
  };

  let lightMode = false;

  // ---- Build Toolbar ----
  const toolbar = document.createElement('div');
  toolbar.id = 'blindbug-toolbar';
  toolbar.innerHTML = `
    <img class="bb-logo" src="${chrome.runtime.getURL('icons/icon48.png')}" alt="BlindBug">
    <div class="bb-sep"></div>
    <button data-tool="blur" title="Box Blur – draw to select area">${ICONS.blur}<span>Box Blur</span></button>
    <button data-tool="eraser" title="Eraser – click a blurred area to remove">${ICONS.eraser}<span>Eraser</span></button>
    <div class="bb-sep"></div>
    <button data-tool="save" class="bb-save" title="Save – confirm pending blurs">${ICONS.save}<span>Save</span></button>
    <button data-tool="undo" class="bb-undo" title="Undo last action">${ICONS.undo}<span>Undo</span></button>
    <div class="bb-sep"></div>
    <button data-tool="title" title="Hide / show page title">${ICONS.title}<span>Hide Title</span></button>
    <div class="bb-sep"></div>
    <div class="bb-opacity-group">
      <span class="bb-opacity-label">Blur</span>
      <button class="bb-opacity-btn" data-tool="blur-down" title="Decrease blur intensity">&minus;</button>
      <span class="bb-opacity-value" id="bb-blur-val">${blurLevel}px</span>
      <button class="bb-opacity-btn" data-tool="blur-up" title="Increase blur intensity">+</button>
    </div>
    <div class="bb-sep"></div>
    <button data-tool="theme" class="bb-theme" title="Toggle light / dark mode">${ICONS.sun}</button>
    <button data-tool="close" class="bb-close" title="Hide toolbar on this page">&times;</button>
  `;
  document.documentElement.appendChild(toolbar);

  // ---- Build Canvas (for drawing selection rectangles) ----
  const canvas = document.createElement('canvas');
  canvas.id = 'blindbug-canvas';
  document.documentElement.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // ---- Build Toast ----
  const toast = document.createElement('div');
  toast.id = 'blindbug-toast';
  document.documentElement.appendChild(toast);

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('bb-show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('bb-show'), 1800);
  }

  // ---- Undo button state ----
  function updateUndoBtn() {
    const btn = toolbar.querySelector('[data-tool="undo"]');
    btn.disabled = undoStack.length === 0;
  }
  updateUndoBtn();

  // ---- Tool activation ----
  function setTool(tool) {
    if (tool === activeTool) {
      // Toggle off
      activeTool = null;
    } else {
      activeTool = tool;
    }

    // Update button styles
    toolbar.querySelectorAll('button').forEach((btn) => {
      const t = btn.dataset.tool;
      btn.classList.toggle('bb-active', t === activeTool && (t === 'blur' || t === 'eraser'));
    });

    // Update canvas mode
    canvas.classList.remove('bb-drawing', 'bb-erasing');
    if (activeTool === 'blur') canvas.classList.add('bb-drawing');
    if (activeTool === 'eraser') canvas.classList.add('bb-erasing');
  }

  // ---- Create blur region element ----
  // rect uses DOCUMENT coordinates (scroll-aware), so the region scrolls with content
  function createBlurRegion(rect, pending) {
    const el = document.createElement('div');
    el.className = 'blindbug-blur-region' + (pending ? ' bb-pending' : '');
    el.style.left = rect.x + 'px';
    el.style.top = rect.y + 'px';
    el.style.width = rect.w + 'px';
    el.style.height = rect.h + 'px';
    const blur = rect.blur || blurLevel;
    el.style.backdropFilter = `blur(${blur}px)`;
    el.style.webkitBackdropFilter = `blur(${blur}px)`;
    el.dataset.blur = blur;
    document.body.appendChild(el);
    return el;
  }

  // ---- Drawing logic (Box Blur) ----
  canvas.addEventListener('mousedown', (e) => {
    if (activeTool === 'blur') {
      isDrawing = true;
      drawStart = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing || activeTool !== 'blur') return;
    // Draw selection rectangle preview on canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const x = Math.min(drawStart.x, e.clientX);
    const y = Math.min(drawStart.y, e.clientY);
    const w = Math.abs(e.clientX - drawStart.x);
    const h = Math.abs(e.clientY - drawStart.y);

    ctx.strokeStyle = '#6BCB4A';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = 'rgba(107, 203, 74, 0.08)';
    ctx.fillRect(x, y, w, h);
  });

  canvas.addEventListener('mouseup', (e) => {
    if (!isDrawing || activeTool !== 'blur') return;
    isDrawing = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Viewport coordinates for size
    const vx = Math.min(drawStart.x, e.clientX);
    const vy = Math.min(drawStart.y, e.clientY);
    const w = Math.abs(e.clientX - drawStart.x);
    const h = Math.abs(e.clientY - drawStart.y);

    // Minimum size gate
    if (w < 10 || h < 10) return;

    // Convert to DOCUMENT coordinates so region scrolls with the page
    const docX = vx + window.scrollX;
    const docY = vy + window.scrollY;

    const region = createBlurRegion({ x: docX, y: docY, w, h }, true);
    pendingRegions.push(region);
    undoStack.push({ type: 'add-pending', element: region });
    updateUndoBtn();
    showToast('Area selected – click Save to confirm');
  });

  // ---- Eraser logic ----
  canvas.addEventListener('click', (e) => {
    if (activeTool !== 'eraser') return;

    const px = e.clientX;
    const py = e.clientY;

    // Check saved regions (reverse order so topmost first)
    for (let i = savedRegions.length - 1; i >= 0; i--) {
      const el = savedRegions[i];
      const r = el.getBoundingClientRect();
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) {
        el.remove();
        savedRegions.splice(i, 1);
        undoStack.push({ type: 'erase-saved', element: el, index: i });
        updateUndoBtn();
        showToast('Blur removed');
        return;
      }
    }

    // Check pending regions
    for (let i = pendingRegions.length - 1; i >= 0; i--) {
      const el = pendingRegions[i];
      const r = el.getBoundingClientRect();
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) {
        el.remove();
        pendingRegions.splice(i, 1);
        undoStack.push({ type: 'erase-pending', element: el, index: i });
        updateUndoBtn();
        showToast('Pending blur removed');
        return;
      }
    }
  });

  // ---- Save ----
  function saveRegions() {
    if (pendingRegions.length === 0) {
      showToast('Nothing to save');
      return;
    }
    const count = pendingRegions.length;
    pendingRegions.forEach((el) => {
      el.classList.remove('bb-pending');
      savedRegions.push(el);
    });
    undoStack.push({ type: 'save', count });
    pendingRegions = [];
    updateUndoBtn();
    showToast(`${count} blur region${count > 1 ? 's' : ''} saved`);
  }

  // ---- Undo ----
  function undo() {
    if (undoStack.length === 0) return;
    const action = undoStack.pop();

    switch (action.type) {
      case 'add-pending': {
        // Remove the pending region that was just drawn
        const idx = pendingRegions.indexOf(action.element);
        if (idx !== -1) pendingRegions.splice(idx, 1);
        action.element.remove();
        showToast('Undo: blur selection removed');
        break;
      }
      case 'save': {
        // Un-save the last batch: move them back to pending
        const batch = savedRegions.splice(-action.count);
        batch.forEach((el) => {
          el.classList.add('bb-pending');
          pendingRegions.push(el);
        });
        showToast('Undo: save reverted');
        break;
      }
      case 'erase-saved': {
        // Restore erased saved region
        document.body.appendChild(action.element);
        savedRegions.splice(action.index, 0, action.element);
        showToast('Undo: blur restored');
        break;
      }
      case 'erase-pending': {
        // Restore erased pending region
        document.body.appendChild(action.element);
        pendingRegions.splice(action.index, 0, action.element);
        showToast('Undo: pending blur restored');
        break;
      }
      case 'hide-title': {
        setTitleVisibility(true);
        showToast('Undo: title restored');
        break;
      }
      case 'show-title': {
        setTitleVisibility(false);
        showToast('Undo: title hidden again');
        break;
      }
    }
    updateUndoBtn();
  }

  // ---- Hide Title ----
  function setTitleVisibility(visible) {
    titleHidden = !visible;
    // Blur all title-like elements
    const targets = [
      ...document.querySelectorAll('h1'),
      ...document.querySelectorAll('title')
    ];
    targets.forEach((el) => {
      if (visible) {
        el.classList.remove('blindbug-title-hidden');
      } else {
        el.classList.add('blindbug-title-hidden');
      }
    });

    // Also blur the tab title via document.title manipulation
    if (!visible) {
      document._bbOriginalTitle = document.title;
      document.title = '\u2588'.repeat(document.title.length);
    } else if (document._bbOriginalTitle) {
      document.title = document._bbOriginalTitle;
    }

    // Update button appearance
    const btn = toolbar.querySelector('[data-tool="title"]');
    btn.classList.toggle('bb-active', titleHidden);
    btn.querySelector('span').textContent = titleHidden ? 'Show Title' : 'Hide Title';
  }

  function toggleTitle() {
    if (titleHidden) {
      setTitleVisibility(true);
      undoStack.push({ type: 'show-title' });
      showToast('Page title restored');
    } else {
      setTitleVisibility(false);
      undoStack.push({ type: 'hide-title' });
      showToast('Page title hidden');
    }
    updateUndoBtn();
  }

  // ---- Theme toggle ----
  function applyTheme(isLight) {
    lightMode = isLight;
    toolbar.classList.toggle('bb-light', isLight);
    toast.classList.toggle('bb-light', isLight);
    const themeBtn = toolbar.querySelector('[data-tool="theme"]');
    if (themeBtn) themeBtn.innerHTML = isLight ? ICONS.moon : ICONS.sun;
  }

  function toggleTheme() {
    applyTheme(!lightMode);
    chrome.storage?.local?.set({ blindbugLightMode: lightMode });
    showToast(lightMode ? 'Light mode' : 'Dark mode');
  }

  // ---- Opacity / blur-level helpers ----
  function updateBlurLabel() {
    const label = toolbar.querySelector('#bb-blur-val');
    if (label) label.textContent = blurLevel + 'px';
  }

  function adjustBlur(delta) {
    const prev = blurLevel;
    blurLevel = Math.max(BLUR_MIN, Math.min(BLUR_MAX, blurLevel + delta));
    if (blurLevel !== prev) {
      updateBlurLabel();
      showToast(`Blur intensity: ${blurLevel}px`);
    }
  }

  // ---- Toolbar click handler ----
  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const tool = btn.dataset.tool;

    switch (tool) {
      case 'blur':
      case 'eraser':
        setTool(tool);
        break;
      case 'save':
        saveRegions();
        break;
      case 'undo':
        undo();
        break;
      case 'title':
        toggleTitle();
        break;
      case 'blur-up':
        adjustBlur(BLUR_STEP);
        break;
      case 'blur-down':
        adjustBlur(-BLUR_STEP);
        break;
      case 'theme':
        toggleTheme();
        break;
      case 'close':
        toolbar.classList.add('blindbug-hidden');
        setTool(null);
        canvas.classList.remove('bb-drawing', 'bb-erasing');
        chrome.storage?.local?.set({ blindbugEnabled: false });
        break;
    }
  });

  // ---- Keyboard shortcuts ----
  document.addEventListener('keydown', (e) => {
    // Escape to deactivate tool
    if (e.key === 'Escape') {
      if (activeTool) {
        setTool(null);
        showToast('Tool deactivated');
      }
    }
    // Ctrl+Z to undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      if (undoStack.length > 0) {
        e.preventDefault();
        undo();
      }
    }
  });

  // ---- Apply saved state on load ----
  chrome.storage?.local?.get(['blindbugEnabled', 'blindbugLightMode'], (data) => {
    const enabled = data.blindbugEnabled !== false; // default on
    toolbar.classList.toggle('blindbug-hidden', !enabled);
    if (!enabled) {
      setTool(null);
      canvas.classList.remove('bb-drawing', 'bb-erasing');
    }
    if (data.blindbugLightMode) {
      applyTheme(true);
    }
  });

  // ---- Listen for popup toggle message ----
  chrome.runtime?.onMessage?.addListener((msg) => {
    if (msg.type === 'blindbug-toggle') {
      toolbar.classList.toggle('blindbug-hidden', !msg.enabled);
      if (!msg.enabled) {
        setTool(null);
        canvas.classList.remove('bb-drawing', 'bb-erasing');
      }
    }
  });

})();
