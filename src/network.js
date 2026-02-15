// Client-side WebSocket networking for multiplayer

export function createNetwork() {
  let ws = null;
  let connected = false;
  let mySlot = -1;

  // Callbacks
  const callbacks = {
    onOpponentState: null,
    onOpponentEvent: null,
    onMatchFound: null,
    onCountdown: null,
    onGo: null,
    onResume: null,
    onScoreUpdate: null,
    onRoundEnd: null,
    onMatchEnd: null,
    onResetPositions: null,
    onOpponentDisconnected: null,
    onQueueUpdate: null,
    onConnected: null,
    onDisconnected: null,
  };

  // Send rate limiter: 20Hz (50ms interval)
  let lastSendTime = 0;
  const SEND_INTERVAL_MS = 50;

  function connect(url) {
    ws = new WebSocket(url);

    ws.onopen = () => {
      connected = true;
      if (callbacks.onConnected) callbacks.onConnected();
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'matched':
          mySlot = msg.slot;
          if (callbacks.onMatchFound) callbacks.onMatchFound(msg.slot);
          break;
        case 'queued':
          if (callbacks.onQueueUpdate) callbacks.onQueueUpdate(msg.position, msg.total);
          break;
        case 'countdown':
          if (callbacks.onCountdown) callbacks.onCountdown(msg.timer);
          break;
        case 'go':
          if (callbacks.onGo) callbacks.onGo();
          break;
        case 'resume':
          if (callbacks.onResume) callbacks.onResume();
          break;
        case 'opponent_state':
          if (callbacks.onOpponentState) callbacks.onOpponentState(mirrorState(msg.data));
          break;
        case 'opponent_event':
          if (callbacks.onOpponentEvent) callbacks.onOpponentEvent(mirrorEvent(msg.event));
          break;
        case 'score_update':
          if (callbacks.onScoreUpdate) callbacks.onScoreUpdate(msg);
          break;
        case 'round_end':
          if (callbacks.onRoundEnd) callbacks.onRoundEnd(msg);
          break;
        case 'match_end':
          if (callbacks.onMatchEnd) callbacks.onMatchEnd(msg);
          break;
        case 'reset_positions':
          if (callbacks.onResetPositions) callbacks.onResetPositions();
          break;
        case 'opponent_disconnected':
          if (callbacks.onOpponentDisconnected) callbacks.onOpponentDisconnected();
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
          break;
      }
    };

    ws.onclose = () => {
      connected = false;
      if (callbacks.onDisconnected) callbacks.onDisconnected();
    };

    ws.onerror = () => {
      // Will trigger onclose
    };
  }

  // Mirror opponent state from their +Z perspective to our -Z perspective
  function mirrorState(data) {
    return {
      px: data.px,
      py: data.py,
      pz: -data.pz,                   // Z inverted
      yaw: data.yaw + Math.PI,        // Rotate 180
      pitch: data.pitch,
      blocking: data.blocking,
      crouching: data.crouching,
      dashActive: data.dashActive,
      armed: data.armed,
      orbHeld: data.orbHeld,
      orbX: data.orbX,
      orbY: data.orbY,
      orbZ: -data.orbZ,               // Z inverted
      orbVx: data.orbVx,
      orbVy: data.orbVy,
      orbVz: -data.orbVz,             // Vz inverted
      orbReturning: data.orbReturning,
      orbStrikeStacks: data.orbStrikeStacks,
    };
  }

  // Mirror event data that contains coordinates
  function mirrorEvent(event) {
    const mirrored = { ...event };
    if ('orbVz' in mirrored) mirrored.orbVz = -mirrored.orbVz;
    if ('orbZ' in mirrored) mirrored.orbZ = -mirrored.orbZ;
    return mirrored;
  }

  // Send periodic state (rate-limited to 20Hz)
  function sendState(data) {
    if (!connected || !ws || ws.readyState !== 1) return;
    const now = performance.now();
    if (now - lastSendTime < SEND_INTERVAL_MS) return;
    lastSendTime = now;
    ws.send(JSON.stringify({ type: 'state', data }));
  }

  // Send discrete event (immediate)
  function sendEvent(event) {
    if (!connected || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'event', event }));
  }

  function disconnect() {
    if (ws) ws.close();
  }

  return {
    connect,
    sendState,
    sendEvent,
    disconnect,
    isConnected: () => connected,
    getSlot: () => mySlot,
    callbacks,
  };
}
