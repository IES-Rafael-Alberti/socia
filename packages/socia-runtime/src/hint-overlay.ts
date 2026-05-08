/**
 * SOCIA Floating Hint Overlay
 *
 * Injects a draggable floating button into every page via Shadow DOM.
 * When clicked, requests a hint from the background and displays it
 * with a typewriter animation, expanding toward whichever side has
 * the most available space.
 */

// ─── CSS (isolated inside Shadow DOM) ───

const OVERLAY_CSS = /* css */ `
  /* Webfont — same as the SOCIA popup + panel. Loaded inside the shadow root
     so the bubble doesn't pick up the host page's typography. */
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap');

  :host {
    all: initial;
    font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .socia-fab {
    position: fixed;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: #e93456;
    color: #fff;
    cursor: grab;
    box-shadow: 0 4px 14px rgba(233, 52, 86, 0.35), 0 2px 6px rgba(0,0,0,0.18);
    user-select: none;
    transition: box-shadow 0.2s, transform 0.15s;
    border: none;
    outline: none;
    padding: 0;
  }
  .socia-fab__icon {
    width: 22px;
    height: 22px;
    display: block;
    color: #fff;
  }

  .socia-fab:hover {
    box-shadow: 0 4px 20px rgba(0,0,0,0.35);
    transform: scale(1.08);
  }

  .socia-fab:active,
  .socia-fab.dragging {
    cursor: grabbing;
    box-shadow: 0 6px 24px rgba(0,0,0,0.4);
    transform: scale(1.04);
  }

  .socia-fab.loading {
    opacity: 0.7;
    pointer-events: none;
  }
  .socia-fab.loading .socia-fab__icon {
    visibility: hidden;
  }

  /* Spinner inside button while loading */
  .socia-fab.loading::after {
    content: '';
    width: 20px;
    height: 20px;
    border: 2.5px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: socia-spin 0.6s linear infinite;
    position: absolute;
  }

  @keyframes socia-spin {
    to { transform: rotate(360deg); }
  }

  /* ─── Hint bubble ─── */

  .socia-bubble {
    position: fixed;
    z-index: 2147483646;
    max-width: 360px;
    min-width: 200px;
    padding: 16px 36px 16px 18px;
    background: #fff;
    border: 1px solid #e6e8ec;
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(20, 22, 27, 0.12), 0 2px 6px rgba(20, 22, 27, 0.06);
    font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.55;
    color: #14161b;
    letter-spacing: -0.005em;
    opacity: 0;
    transform: scale(0.94) translateY(2px);
    transition: opacity 0.18s ease, transform 0.18s ease;
    pointer-events: none;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .socia-bubble::before {
    content: 'Pista';
    display: block;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #e93456;
    margin-bottom: 6px;
  }

  .socia-bubble.visible {
    opacity: 1;
    transform: scale(1) translateY(0);
    pointer-events: auto;
  }

  .socia-bubble-close {
    position: absolute;
    top: 8px;
    right: 8px;
    background: none;
    border: none;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    color: #a8aeb8;
    padding: 6px;
    border-radius: 6px;
    transition: background 0.14s, color 0.14s;
  }

  .socia-bubble-close:hover {
    color: #14161b;
    background: #f4f5f7;
  }

  .socia-cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: #e93456;
    margin-left: 1px;
    vertical-align: text-bottom;
    animation: socia-blink 0.6s step-end infinite;
  }

  @keyframes socia-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  /* ─── Debug panel ─── */

  .socia-debug-toggle {
    display: block;
    background: none;
    border: none;
    color: #9ca3af;
    font-size: 10px;
    cursor: pointer;
    padding: 6px 0 0;
    text-align: left;
  }

  .socia-debug-toggle:hover {
    color: #222;
  }

  .socia-debug-panel {
    margin-top: 8px;
    background: #fafbfc;
    border: 1px solid #e6e8ec;
    border-radius: 8px;
    padding: 8px;
    max-height: 300px;
    overflow-y: auto;
  }

  .socia-debug-section {
    margin-bottom: 8px;
  }

  .socia-debug-section:last-child {
    margin-bottom: 0;
  }

  .socia-debug-section strong {
    display: block;
    font-size: 10px;
    color: #4b5563;
    margin-bottom: 2px;
  }

  .socia-debug-section pre {
    font-size: 9px;
    color: #14161b;
    white-space: pre-wrap;
    word-break: break-word;
    background: #fff;
    border: 1px solid #e6e8ec;
    padding: 6px;
    border-radius: 4px;
    max-height: 150px;
    overflow-y: auto;
    margin: 0;
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
  }
`;

// ─── State ───

const IS_DEBUG = import.meta.env.EXT_DEBUG === 'true';

interface OverlayState {
  container: HTMLDivElement;
  shadow: ShadowRoot;
  fab: HTMLButtonElement;
  bubble: HTMLDivElement;
  bubbleText: HTMLSpanElement;
  cursor: HTMLSpanElement;
  closeBtn: HTMLButtonElement;
  debugToggle: HTMLButtonElement;
  debugPanel: HTMLDivElement;
  posX: number;
  posY: number;
  isDragging: boolean;
  dragStartX: number;
  dragStartY: number;
  fabStartX: number;
  fabStartY: number;
  didMove: boolean;
  isLoading: boolean;
  typewriterTimer: number | null;
  debugVisible: boolean;
}

const FAB_SIZE = 44;
const MARGIN = 12;
const BUBBLE_GAP = 8;

export function createHintOverlay(): OverlayState {
  // ─── Build DOM ───
  const container = document.createElement('div');
  container.id = 'socia-hint-overlay';

  const shadow = container.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  shadow.appendChild(style);

  const fab = document.createElement('button');
  fab.className = 'socia-fab';
  fab.title = 'Pedir pista (SOCIA)';
  // White lightbulb silhouette (filled). Lives inside the shadow so the
  // host page can't restyle it.
  fab.innerHTML = `
    <svg class="socia-fab__icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.5 21.5a1.25 1.25 0 0 0 1.25 1.25h2.5a1.25 1.25 0 0 0 1.25-1.25V20.5h-5v1zM12 1.5a7.25 7.25 0 0 0-4.13 13.21c.7.49 1.13 1.27 1.13 2.12V18a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1.17c0-.85.43-1.63 1.13-2.12A7.25 7.25 0 0 0 12 1.5z"/>
    </svg>
  `;
  shadow.appendChild(fab);

  const bubble = document.createElement('div');
  bubble.className = 'socia-bubble';
  shadow.appendChild(bubble);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'socia-bubble-close';
  closeBtn.textContent = '✕';
  bubble.appendChild(closeBtn);

  const bubbleText = document.createElement('span');
  bubble.appendChild(bubbleText);

  const cursorEl = document.createElement('span');
  cursorEl.className = 'socia-cursor';
  bubble.appendChild(cursorEl);

  // Debug elements (only created when DEBUG=true)
  const debugToggle = document.createElement('button');
  debugToggle.className = 'socia-debug-toggle';
  debugToggle.style.display = 'none';

  const debugPanel = document.createElement('div');
  debugPanel.className = 'socia-debug-panel';
  debugPanel.style.display = 'none';

  if (IS_DEBUG) {
    bubble.appendChild(debugToggle);
    bubble.appendChild(debugPanel);
  }

  document.documentElement.appendChild(container);

  // Initial position: top-right corner
  const posX = window.innerWidth - FAB_SIZE - MARGIN;
  const posY = MARGIN;
  fab.style.left = `${posX}px`;
  fab.style.top = `${posY}px`;

  const state: OverlayState = {
    container,
    shadow,
    fab,
    bubble,
    bubbleText,
    cursor: cursorEl,
    closeBtn,
    debugToggle,
    debugPanel,
    posX,
    posY,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    fabStartX: 0,
    fabStartY: 0,
    didMove: false,
    isLoading: false,
    typewriterTimer: null,
    debugVisible: false,
  };

  // ─── Drag behaviour ───

  fab.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    state.isDragging = true;
    state.didMove = false;
    state.dragStartX = e.clientX;
    state.dragStartY = e.clientY;
    state.fabStartX = state.posX;
    state.fabStartY = state.posY;
    fab.classList.add('dragging');
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!state.isDragging) return;
    const dx = e.clientX - state.dragStartX;
    const dy = e.clientY - state.dragStartY;

    // Consider it a real drag after 4px movement
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      state.didMove = true;
    }

    const newX = Math.max(0, Math.min(window.innerWidth - FAB_SIZE, state.fabStartX + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - FAB_SIZE, state.fabStartY + dy));
    state.posX = newX;
    state.posY = newY;
    fab.style.left = `${newX}px`;
    fab.style.top = `${newY}px`;

    // Reposition bubble if visible
    if (bubble.classList.contains('visible')) {
      positionBubble(state);
    }
  });

  document.addEventListener('mouseup', () => {
    if (!state.isDragging) return;
    state.isDragging = false;
    fab.classList.remove('dragging');
  });

  // ─── Click → request hint ───

  fab.addEventListener('click', () => {
    if (state.didMove || state.isLoading) return;

    // Toggle off if already showing
    if (bubble.classList.contains('visible')) {
      hideBubble(state);
      return;
    }

    requestHint(state);
  });

  // ─── Close button ───

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideBubble(state);
  });

  // ─── Debug toggle ───

  debugToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    state.debugVisible = !state.debugVisible;
    debugPanel.style.display = state.debugVisible ? 'block' : 'none';
    debugToggle.textContent = state.debugVisible
      ? '▲ Ocultar debug'
      : '▼ Ver prompt enviado al LLM';
    positionBubble(state);
  });

  // ─── Dismiss on Escape ───

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && bubble.classList.contains('visible')) {
      hideBubble(state);
    }
  });

  // ─── Reposition on resize ───

  window.addEventListener('resize', () => {
    state.posX = Math.min(state.posX, window.innerWidth - FAB_SIZE);
    state.posY = Math.min(state.posY, window.innerHeight - FAB_SIZE);
    fab.style.left = `${state.posX}px`;
    fab.style.top = `${state.posY}px`;
    if (bubble.classList.contains('visible')) {
      positionBubble(state);
    }
  });

  return state;
}

// ─── Bubble positioning ───

function positionBubble(s: OverlayState) {
  const fabCenterX = s.posX + FAB_SIZE / 2;
  const fabCenterY = s.posY + FAB_SIZE / 2;

  const spaceRight = window.innerWidth - (s.posX + FAB_SIZE);
  const spaceLeft = s.posX;
  const spaceBelow = window.innerHeight - (s.posY + FAB_SIZE);
  const spaceAbove = s.posY;

  const bubbleRect = s.bubble.getBoundingClientRect();
  const bw = bubbleRect.width || 300;
  const bh = bubbleRect.height || 80;

  let bx: number;
  let by: number;

  // Horizontal: expand toward the side with more space
  if (spaceRight >= spaceLeft) {
    bx = s.posX + FAB_SIZE + BUBBLE_GAP;
  } else {
    bx = s.posX - bw - BUBBLE_GAP;
  }

  // Vertical: vertically center on the fab, clamped
  by = fabCenterY - bh / 2;

  // If horizontal doesn't fit, go below or above
  if (bx < MARGIN || bx + bw > window.innerWidth - MARGIN) {
    bx = Math.max(MARGIN, Math.min(fabCenterX - bw / 2, window.innerWidth - bw - MARGIN));
    if (spaceBelow >= spaceAbove) {
      by = s.posY + FAB_SIZE + BUBBLE_GAP;
    } else {
      by = s.posY - bh - BUBBLE_GAP;
    }
  }

  // Clamp vertical
  by = Math.max(MARGIN, Math.min(by, window.innerHeight - bh - MARGIN));

  s.bubble.style.left = `${bx}px`;
  s.bubble.style.top = `${by}px`;
}

// ─── Show / hide ───

function hideBubble(s: OverlayState) {
  if (s.typewriterTimer) {
    clearInterval(s.typewriterTimer);
    s.typewriterTimer = null;
  }
  s.bubble.classList.remove('visible');
  s.cursor.style.display = 'none';
  // Reset debug state
  s.debugToggle.style.display = 'none';
  s.debugPanel.style.display = 'none';
  s.debugPanel.innerHTML = '';
  s.debugVisible = false;
}

function showBubbleWithTypewriter(s: OverlayState, text: string) {
  // Reset
  if (s.typewriterTimer) clearInterval(s.typewriterTimer);
  s.bubbleText.textContent = '';
  s.cursor.style.display = 'inline-block';

  // Show bubble so we can measure & position
  s.bubble.classList.add('visible');
  positionBubble(s);

  let i = 0;
  const speed = 18; // ms per character

  s.typewriterTimer = window.setInterval(() => {
    if (i < text.length) {
      s.bubbleText.textContent += text[i];
      i++;
      // Reposition as text grows
      positionBubble(s);
    } else {
      if (s.typewriterTimer) clearInterval(s.typewriterTimer);
      s.typewriterTimer = null;
      s.cursor.style.display = 'none';
    }
  }, speed);
}

// ─── Hint request ───

async function requestHint(s: OverlayState) {
  s.isLoading = true;
  // The 'loading' class hides the icon and overlays the spinner via ::after,
  // so we don't need to touch the FAB's children.
  s.fab.classList.add('loading');

  try {
    const resp: { success: boolean; hint?: string; error?: string } = await new Promise(
      (resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'SOCIA_REQUEST_HINT' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      }
    );

    const hintText =
      resp.success && resp.hint
        ? resp.hint
        : resp.error || 'No se pudo obtener la pista.';

    showBubbleWithTypewriter(s, hintText);

    // Fetch debug info if DEBUG mode is on
    if (IS_DEBUG) {
      try {
        const dbg: {
          success: boolean;
          debug?: { systemPrompt: string; userPrompt: string; response: string };
        } = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'SOCIA_GET_HINT_DEBUG' }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(response);
          });
        });

        if (dbg.success && dbg.debug) {
          s.debugPanel.innerHTML = '';

          const sections = [
            { title: 'System prompt', content: dbg.debug.systemPrompt },
            { title: 'User prompt', content: dbg.debug.userPrompt },
            { title: 'Respuesta LLM', content: dbg.debug.response },
          ];

          for (const sec of sections) {
            const div = document.createElement('div');
            div.className = 'socia-debug-section';
            const strong = document.createElement('strong');
            strong.textContent = sec.title;
            const pre = document.createElement('pre');
            pre.textContent = sec.content;
            div.appendChild(strong);
            div.appendChild(pre);
            s.debugPanel.appendChild(div);
          }

          s.debugToggle.textContent = '▼ Ver prompt enviado al LLM';
          s.debugToggle.style.display = 'block';
        }
      } catch {
        /* debug fetch failed — not critical */
      }
    }
  } catch (err) {
    showBubbleWithTypewriter(
      s,
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    s.isLoading = false;
    s.fab.classList.remove('loading');
  }
}
