// =====================================================================
// FEEDBACK — Pull-to-refresh (Instagram-style)
// =====================================================================
// One global touch listener that fires the passed-in `onRefresh`
// callback when the user drags down past a threshold at the top of the
// page scroll. A spinner pinned at the top scales / rotates with the
// drag and starts spinning while the refresh is in flight.
//
// Cross-platform notes:
//   * iOS Safari (browser tab): native pull-to-refresh reloads the page.
//     `overscroll-behavior-y: contain` on <html> disables that, letting
//     our gesture take over.
//   * iOS PWA standalone: no native pull-to-refresh; ours runs unopposed.
//   * Android Chrome: same as iOS Safari, contained by overscroll-behavior.
//
// We deliberately skip activation:
//   * when the user is inside `.chat-messages` (chat has its own scroll
//     and the gesture would conflict with reading history),
//   * when the page is a `.chat-page` (full-bleed layout, no header pull
//     makes sense — the user is talking, not refreshing a feed),
//   * when window.scrollY > 0 (only the very top of a feed counts).
// =====================================================================

const TRIGGER_PX = 80;       // how far user must drag past resistance
const MAX_PULL_PX = 120;     // hard cap for the indicator's translation
const DRAG_RESISTANCE = 0.5; // 1 = no resistance, lower = harder pull

let _onRefresh = null;
let _isRefreshing = false;

export function setupPullToRefresh(onRefresh) {
  _onRefresh = onRefresh;

  const indicator = document.createElement('div');
  indicator.className = 'ptr-indicator';
  indicator.innerHTML = '<div class="ptr-spinner"></div>';
  document.body.appendChild(indicator);

  let startY = 0;
  let currentY = 0;
  let pulling = false;

  function reset(animated = true) {
    if (animated) indicator.style.transition = 'transform 280ms var(--ease-out), opacity 280ms var(--ease-out)';
    indicator.style.transform = '';
    indicator.style.opacity = '';
    indicator.classList.remove('ptr-spinning');
    if (animated) setTimeout(() => { indicator.style.transition = ''; }, 280);
  }

  document.addEventListener('touchstart', (e) => {
    if (_isRefreshing) return;
    if (window.scrollY > 0) { pulling = false; return; }

    // Don't compete with internal scrollers / chat composer / inputs.
    const target = e.target;
    if (target instanceof Element) {
      if (target.closest('.chat-messages')) { pulling = false; return; }
      if (target.closest('.chat-page')) { pulling = false; return; }
      if (target.closest('input, textarea, select, button')) { pulling = false; return; }
    }

    startY = e.touches[0].clientY;
    currentY = startY;
    pulling = true;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    currentY = e.touches[0].clientY;
    const rawDelta = currentY - startY;

    if (rawDelta <= 0) {
      // User reversed direction — treat as scroll, not pull.
      pulling = false;
      reset();
      return;
    }

    const resistedDelta = Math.min(rawDelta * DRAG_RESISTANCE, MAX_PULL_PX);
    const progress = Math.min(resistedDelta / TRIGGER_PX, 1);

    indicator.style.transform = `translateX(-50%) translateY(${resistedDelta}px) rotate(${resistedDelta * 4}deg)`;
    indicator.style.opacity = String(progress);

    // Stop the browser's native bounce/refresh from competing.
    if (rawDelta > 4 && e.cancelable) e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    const rawDelta = currentY - startY;
    const resistedDelta = Math.min(rawDelta * DRAG_RESISTANCE, MAX_PULL_PX);

    if (resistedDelta < TRIGGER_PX) {
      reset();
      return;
    }

    // Triggered — pin the spinner at the trigger height and start spinning.
    _isRefreshing = true;
    indicator.style.transition = 'transform 200ms var(--ease-out)';
    indicator.style.transform = `translateX(-50%) translateY(${TRIGGER_PX}px) rotate(0deg)`;
    indicator.style.opacity = '1';
    setTimeout(() => { indicator.style.transition = ''; }, 200);
    indicator.classList.add('ptr-spinning');

    try {
      await _onRefresh?.();
    } catch (e) {
      console.warn('[ptr] refresh threw', e);
    } finally {
      // Brief hold so the spin animation feels intentional, then snap back.
      setTimeout(() => {
        reset();
        _isRefreshing = false;
      }, 350);
    }
  }, { passive: true });

  // Cancel pull state if the touch is interrupted (e.g., notification).
  document.addEventListener('touchcancel', () => {
    if (!pulling) return;
    pulling = false;
    reset();
  }, { passive: true });
}
