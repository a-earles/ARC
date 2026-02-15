import { CONFIG } from './config.js';

// Ring buffer for flick-spin tracking (avoids push/shift GC pressure)
const RING_SIZE = 20;
const flickRing = new Array(RING_SIZE);
for (let i = 0; i < RING_SIZE; i++) {
  flickRing[i] = { dx: 0, dy: 0, time: 0 };
}
let flickHead = 0;
let flickCount = 0;

const state = {
  keys: {},
  throwTriggered: false,
  throwPower: CONFIG.THROW_SPEED,
  blocking: false,
  cleanCatchTriggered: false,  // E key pressed this frame
  dashTriggered: false,         // Shift key pressed this frame
  jumpTriggered: false,         // Space key pressed this frame
  lookDeltaX: 0,
  lookDeltaY: 0,
};

let suppressNextClick = false;

export function initInput(canvas) {
  // Keyboard
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    state.keys[key] = true;

    // Clean Catch — E key (single press)
    if (key === 'e') {
      state.cleanCatchTriggered = true;
    }

    // Dash — Shift key (single press)
    if (key === 'shift') {
      state.dashTriggered = true;
    }

    // Jump — Space key (single press)
    if (key === ' ') {
      state.jumpTriggered = true;
    }
  });
  window.addEventListener('keyup', (e) => {
    state.keys[e.key.toLowerCase()] = false;
  });

  // Pointer lock
  canvas.addEventListener('click', () => {
    if (!document.pointerLockElement) {
      canvas.requestPointerLock({ unadjustedMovement: true }).catch(() => {
        canvas.requestPointerLock();
      });
      suppressNextClick = true;
    }
  });

  // Mouse look + flick tracking
  document.addEventListener('mousemove', (e) => {
    if (!document.pointerLockElement) return;
    state.lookDeltaX += e.movementX;
    state.lookDeltaY += e.movementY;

    // Track deltas for flick-spin detection (ring buffer — zero allocations)
    const now = performance.now();

    // Prune old entries from the tail (oldest) of the ring buffer
    const cutoff = now - 200;
    while (flickCount > 0) {
      const tailIdx = (flickHead - flickCount + RING_SIZE) % RING_SIZE;
      if (flickRing[tailIdx].time < cutoff) {
        flickCount--;
      } else {
        break;
      }
    }

    // Write new entry at head
    const entry = flickRing[flickHead];
    entry.dx = e.movementX;
    entry.dy = e.movementY;
    entry.time = now;
    flickHead = (flickHead + 1) % RING_SIZE;
    if (flickCount < RING_SIZE) {
      flickCount++;
    }
  });

  // Left click = throw
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      if (!document.pointerLockElement) return;
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      state.throwTriggered = true;
    }
    if (e.button === 2) {
      state.blocking = true;
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
      state.blocking = false;
    }
  });

  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement) {
      suppressNextClick = false;
      state.blocking = false;
    }
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// Get the lateral mouse delta over the last FLICK_SAMPLE_MS — for flick-spin
export function getFlickDelta() {
  const cutoff = performance.now() - CONFIG.FLICK_SAMPLE_MS;
  let totalDx = 0;
  for (let i = 0; i < flickCount; i++) {
    const idx = (flickHead - 1 - i + RING_SIZE) % RING_SIZE;
    const entry = flickRing[idx];
    if (entry.time >= cutoff) {
      totalDx += entry.dx;
    }
  }
  return totalDx;
}

export function tickInput() {}

export function getInputState() {
  return state;
}

export function updateInput() {
  state.throwTriggered = false;
  state.cleanCatchTriggered = false;
  state.dashTriggered = false;
  state.jumpTriggered = false;
  state.lookDeltaX = 0;
  state.lookDeltaY = 0;
}
