// Procedural audio using Web Audio API — no external files needed

export function createAudio() {
  let ctx = null;
  let contextResumed = false;

  function ensureContext() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!contextResumed && ctx.state === 'suspended') {
      contextResumed = true; // prevent re-entry
      ctx.resume().then(() => {}).catch(() => { contextResumed = false; });
    }
    return ctx;
  }

  function play(type) {
    try {
      const ac = ensureContext();
      switch (type) {
        case 'throw': playThrow(ac); break;
        case 'bounce': playBounce(ac); break;
        case 'catch': playCatch(ac); break;
        case 'cleanCatch': playCleanCatch(ac); break;
        case 'deflect': playDeflect(ac); break;
        case 'parry': playParry(ac); break;
        case 'score': playScore(ac); break;
        case 'strike': playStrike(ac); break;
        case 'dash': playDash(ac); break;
        case 'hit': playHit(ac); break;
        case 'jump': playJump(ac); break;
        case 'shieldUp': playShieldUp(ac); break;
        case 'shieldDown': playShieldDown(ac); break;
        case 'roundWin': playRoundWin(ac); break;
        case 'roundLose': playRoundLose(ac); break;
        case 'countdown': playCountdown(ac); break;
        case 'go': playGo(ac); break;
      }
    } catch (e) {
      // Audio not available
    }
  }

  function playThrow(ac) {
    const now = ac.currentTime;

    // Whoosh — filtered noise
    const bufferSize = ac.sampleRate * 0.3;
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ac.createBufferSource();
    noise.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(500, now + 0.3);
    filter.Q.value = 2;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    noise.connect(filter).connect(gain).connect(ac.destination);
    noise.start(now);
    noise.stop(now + 0.3);

    // Tonal fwip
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.15);
    const oscGain = ac.createGain();
    oscGain.gain.setValueAtTime(0.15, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(oscGain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  function playBounce(ac) {
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.08);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.1);

    const click = ac.createOscillator();
    click.type = 'sine';
    click.frequency.value = 1200;
    const clickGain = ac.createGain();
    clickGain.gain.setValueAtTime(0.15, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    click.connect(clickGain).connect(ac.destination);
    click.start(now);
    click.stop(now + 0.03);
  }

  function playCatch(ac) {
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  function playCleanCatch(ac) {
    const now = ac.currentTime;
    // Bright ascending chime
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.12);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.3);

    // Sparkle harmonic
    const osc2 = ac.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(800, now + 0.05);
    osc2.frequency.exponentialRampToValueAtTime(1600, now + 0.15);
    const gain2 = ac.createGain();
    gain2.gain.setValueAtTime(0.12, now + 0.05);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc2.connect(gain2).connect(ac.destination);
    osc2.start(now + 0.05);
    osc2.stop(now + 0.25);

    // High sparkle
    const osc3 = ac.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(2400, now + 0.08);
    const gain3 = ac.createGain();
    gain3.gain.setValueAtTime(0.08, now + 0.08);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc3.connect(gain3).connect(ac.destination);
    osc3.start(now + 0.08);
    osc3.stop(now + 0.2);
  }

  function playDeflect(ac) {
    const now = ac.currentTime;
    // Metallic clang
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.12);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.15);

    // Ring-out
    const ring = ac.createOscillator();
    ring.type = 'sine';
    ring.frequency.value = 1600;
    const ringGain = ac.createGain();
    ringGain.gain.setValueAtTime(0.1, now);
    ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    ring.connect(ringGain).connect(ac.destination);
    ring.start(now);
    ring.stop(now + 0.3);
  }

  function playParry(ac) {
    const now = ac.currentTime;
    // Louder power-clang with harmonic ring
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1000, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.15);

    // Harmonic ring — two tones
    [1200, 1800].forEach((freq, i) => {
      const ring = ac.createOscillator();
      ring.type = 'sine';
      ring.frequency.value = freq;
      const ringGain = ac.createGain();
      ringGain.gain.setValueAtTime(0.12 - i * 0.03, now);
      ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      ring.connect(ringGain).connect(ac.destination);
      ring.start(now);
      ring.stop(now + 0.5);
    });

    // Impact sub-bass
    const sub = ac.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(80, now);
    sub.frequency.exponentialRampToValueAtTime(40, now + 0.15);
    const subGain = ac.createGain();
    subGain.gain.setValueAtTime(0.2, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    sub.connect(subGain).connect(ac.destination);
    sub.start(now);
    sub.stop(now + 0.15);
  }

  function playScore(ac) {
    const now = ac.currentTime;
    [0, 0.08, 0.16].forEach((delay, i) => {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      const baseFreq = 400 + i * 200;
      osc.frequency.setValueAtTime(baseFreq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + delay + 0.15);
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.15, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.3);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.3);
    });
  }

  function playStrike(ac) {
    const now = ac.currentTime;
    // Deep resonant boom
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.4);

    // Warning tone
    const warn = ac.createOscillator();
    warn.type = 'sawtooth';
    warn.frequency.setValueAtTime(200, now + 0.05);
    warn.frequency.exponentialRampToValueAtTime(400, now + 0.25);
    const warnGain = ac.createGain();
    warnGain.gain.setValueAtTime(0.1, now + 0.05);
    warnGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    warn.connect(warnGain).connect(ac.destination);
    warn.start(now + 0.05);
    warn.stop(now + 0.35);
  }

  function playDash(ac) {
    const now = ac.currentTime;
    // Quick air whoosh
    const bufferSize = ac.sampleRate * 0.15;
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = Math.sin((i / bufferSize) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const noise = ac.createBufferSource();
    noise.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1000;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    noise.connect(filter).connect(gain).connect(ac.destination);
    noise.start(now);
    noise.stop(now + 0.15);
  }

  function playHit(ac) {
    const now = ac.currentTime;
    // Impact thud
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.2);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.25);

    // Noise burst
    const bufferSize = ac.sampleRate * 0.1;
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ac.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ac.createGain();
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    noise.connect(noiseGain).connect(ac.destination);
    noise.start(now);
    noise.stop(now + 0.1);
  }

  function playJump(ac) {
    const now = ac.currentTime;
    // Quick upward sweep
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.15);

    // Soft air puff
    const bufferSize = ac.sampleRate * 0.08;
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize) * 0.5;
    }
    const noise = ac.createBufferSource();
    noise.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2000;
    const nGain = ac.createGain();
    nGain.gain.setValueAtTime(0.1, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    noise.connect(filter).connect(nGain).connect(ac.destination);
    noise.start(now);
    noise.stop(now + 0.08);
  }

  function playShieldUp(ac) {
    const now = ac.currentTime;
    // Energy activation hum
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(500, now + 0.1);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.03, now + 0.12);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.12);

    // High shimmer
    const osc2 = ac.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1200, now);
    osc2.frequency.exponentialRampToValueAtTime(1800, now + 0.06);
    const gain2 = ac.createGain();
    gain2.gain.setValueAtTime(0.06, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc2.connect(gain2).connect(ac.destination);
    osc2.start(now);
    osc2.stop(now + 0.1);
  }

  function playShieldDown(ac) {
    const now = ac.currentTime;
    // Descending deactivation
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.08);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  function playRoundWin(ac) {
    const now = ac.currentTime;
    // Ascending victory fanfare — 3 notes
    [0, 0.12, 0.24].forEach((delay, i) => {
      const freq = [523, 659, 784][i]; // C5, E5, G5
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.15, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.4);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.4);

      // Harmonic overtone
      const osc2 = ac.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = freq * 2;
      const gain2 = ac.createGain();
      gain2.gain.setValueAtTime(0.06, now + delay);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.3);
      osc2.connect(gain2).connect(ac.destination);
      osc2.start(now + delay);
      osc2.stop(now + delay + 0.3);
    });
  }

  function playRoundLose(ac) {
    const now = ac.currentTime;
    // Descending two-note — minor feel
    [0, 0.15].forEach((delay, i) => {
      const freq = [400, 300][i];
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.8, now + delay + 0.3);
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.12, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.4);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.4);
    });
  }

  function playCountdown(ac) {
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  function playGo(ac) {
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 880;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  // One-shot gesture listener to resume AudioContext early
  const resumeOnGesture = () => {
    ensureContext();
    window.removeEventListener('click', resumeOnGesture);
    window.removeEventListener('keydown', resumeOnGesture);
  };
  window.addEventListener('click', resumeOnGesture);
  window.addEventListener('keydown', resumeOnGesture);

  return { play };
}
