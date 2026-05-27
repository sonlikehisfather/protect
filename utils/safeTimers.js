'use strict';


const TIMER_MAX_CHUNK_MS = 2_000_000_000;


function safeSetTimeout(callback, delayMs) {
  let cleared   = false;
  let active    = null;
  let remaining = Math.max(0, Number(delayMs) || 0);

  const tick = () => {
    if (cleared) return;

    const wait = Math.min(remaining, TIMER_MAX_CHUNK_MS);

    active = setTimeout(() => {
      active = null;
      if (cleared) return;

      remaining -= wait;

      if (remaining > 0) {
        tick();
      } else {
        callback();
      }
    }, wait);


    if (typeof active?.unref === 'function') {
      active.unref();
    }
  };

  tick();

  return {
    clear() {
      cleared = true;
      if (active) {
        clearTimeout(active);
        active = null;
      }
    },
  };
}

module.exports = { safeSetTimeout };
