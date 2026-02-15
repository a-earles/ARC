import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CONFIG } from './config.js';
import { createArena } from './arena.js';
import { createOrb, positionHeldOrbFirstPerson, positionHeldOrbThirdPerson, updateOrbFlight } from './orb.js';
import { createPhysicsWorld, setupBounceDetection, stepPhysics, syncOrbPhysics, ARENA_DIMS } from './physics.js';
import { createShield, updateShield, processReflection } from './shield.js';
import { createStrikeZones, checkStrikeZone, updateStrikeZones } from './strikeZone.js';
import { initInput, getInputState, updateInput, tickInput, getFlickDelta } from './input.js';
import { createAudio } from './audio.js';
import { createParticles, updateParticles } from './particles.js';
import { createOpponent, updateOpponent, dissolveOpponent } from './opponent.js';
import { createNetwork } from './network.js';

// =============================================
// MULTIPLAYER DETECTION
// =============================================
const urlParams = new URLSearchParams(window.location.search);
const singlePlayerMode = urlParams.has('sp');
const network = singlePlayerMode ? null : createNetwork();

// =============================================
// RENDERER
// =============================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// =============================================
// SCENE
// =============================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.SCENE_BG);
scene.fog = new THREE.FogExp2(CONFIG.SCENE_BG, CONFIG.FOG_DENSITY);

// =============================================
// CAMERA
// =============================================
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, CONFIG.PLAYER_EYE_HEIGHT, CONFIG.ARENA_LENGTH / 2 - 2);

// =============================================
// POST-PROCESSING
// =============================================
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2)),
  CONFIG.BLOOM_STRENGTH, CONFIG.BLOOM_RADIUS, CONFIG.BLOOM_THRESHOLD
);
composer.addPass(bloomPass);

// =============================================
// PHYSICS
// =============================================
const physics = createPhysicsWorld();

// =============================================
// ARENA
// =============================================
const arena = createArena(scene);

// =============================================
// ORBS — both players get one
// =============================================
const playerOrb = createOrb(scene, physics, 'player');
const opponentOrb = createOrb(scene, physics, 'opponent');
setupBounceDetection(physics, playerOrb.body);
setupBounceDetection(physics, opponentOrb.body);

// =============================================
// SHIELDS
// =============================================
const playerShield = createShield(scene, physics, 'player');
const opponentShield = createShield(scene, physics, 'opponent');

// =============================================
// STRIKE ZONES
// =============================================
const strikeZones = createStrikeZones(scene);

// =============================================
// OPPONENT
// =============================================
const opponent = createOpponent(scene);

// =============================================
// PARTICLES
// =============================================
const particles = createParticles(scene);

// =============================================
// AUDIO
// =============================================
const audio = createAudio();

// =============================================
// INPUT
// =============================================
initInput(renderer.domElement);

// =============================================
// GAME STATE
// =============================================
const PLAYER_SPAWN = new THREE.Vector3(0, CONFIG.PLAYER_EYE_HEIGHT, CONFIG.ARENA_LENGTH / 2 - 2);

const gameState = {
  // Scores
  playerScore: 0,
  opponentScore: 0,

  // Match structure
  round: 1,
  playerRounds: 0,
  opponentRounds: 0,
  // Phases: 'countdown', 'playing', 'scoring', 'between-rounds', 'match-over'
  matchPhase: 'countdown',
  countdownTimer: 3.0,
  countdownLast: 4,  // track which number was last shown
  resetTimer: 0,

  // Player state
  playerPos: PLAYER_SPAWN.clone(),
  playerArmed: true,
  blocking: false,
  cameraYaw: 0,
  cameraPitch: 0,

  // Dash
  dashCooldown: 0,
  dashTimer: 0,
  dashDirection: new THREE.Vector3(),
  dashActive: false,

  // Clean catch boost
  cleanCatchBoostTimer: 0,

  // Stats
  throws: 0,
  catches: 0,

  // Throw tracking
  throwTime: 0,
  firstThrow: false,

  // Strike stacks
  playerStrikes: 0,
  opponentStrikes: 0,

  // Recall
  discRecalling: false,

  // Crouch
  crouching: false,

  // Jump / Double Jump
  playerVelY: 0,
  jumpCount: 0,
  onGround: true,

  // Shield energy
  shieldEnergy: 1.0,

  // Hit debounce
  lastPlayerHitTime: 0,
  lastOppHitTime: 0,

  // Hit flash effect
  hitFlashTimer: 0,

  // Camera shake
  shakeX: 0,
  shakeY: 0,
  shakeTimer: 0,

  // Parry flash
  parryFlashTimer: 0,

  // Title screen
  started: false,

  // Multiplayer
  multiplayerActive: false,
};

const playerVelocity = new THREE.Vector3();

// Pre-allocated temp vectors to reduce GC pressure
const _tmpVec = new THREE.Vector3();
const _tmpVec2 = new THREE.Vector3();
const _tmpVec3 = new THREE.Vector3();
const _tmpVec4 = new THREE.Vector3();
const _tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _aimDir = new THREE.Vector3();

// =============================================
// CAMERA SHAKE HELPER
// =============================================
function applyCameraShake() {
  if (gameState.shakeTimer > 0) {
    const intensity = gameState.shakeTimer > 0.15 ? 0.05 : 0.03;
    gameState.shakeX = (Math.random() - 0.5) * 2 * intensity;
    gameState.shakeY = (Math.random() - 0.5) * 2 * intensity;
    camera.position.x += gameState.shakeX;
    camera.position.y += gameState.shakeY;
  }
}

// =============================================
// HUD ELEMENTS
// =============================================
const hudScore = document.getElementById('hud-score');
const hudRound = document.getElementById('hud-round');
const hudStatus = document.getElementById('hud-status');
const hudStrikes = document.getElementById('hud-strikes');
const instructions = document.getElementById('instructions');
const hitFlash = document.getElementById('hit-flash');
const parryFlash = document.getElementById('parry-flash');
const dashCircle = document.getElementById('dash-circle');
const gameOverlay = document.getElementById('game-overlay');
const overlayText = document.getElementById('overlay-text');
const overlaySubtext = document.getElementById('overlay-subtext');
const playAgainBtn = document.getElementById('play-again-btn');

const shieldBar = document.getElementById('shield-bar');
const fpsCounter = document.getElementById('fps-counter');
const DASH_CIRCUMFERENCE = 94.25; // 2 * PI * 15
let fpsFrameCount = 0;
let fpsLastTime = performance.now();

function updateHUD() {
  if (hudScore) hudScore.textContent = `${gameState.playerScore}  -  ${gameState.opponentScore}`;
  if (hudRound) {
    const pRounds = '\u25CF'.repeat(gameState.playerRounds) + '\u25CB'.repeat(CONFIG.ROUNDS_TO_WIN - gameState.playerRounds);
    const oRounds = '\u25CF'.repeat(gameState.opponentRounds) + '\u25CB'.repeat(CONFIG.ROUNDS_TO_WIN - gameState.opponentRounds);
    hudRound.textContent = `${pRounds}  ROUND ${gameState.round}  ${oRounds}`;
  }
  if (hudStatus) {
    let status = 'ARMED';
    if (gameState.dashActive) status = 'DASH';
    else if (!gameState.onGround) status = 'AIRBORNE';
    else if (gameState.blocking) status = 'BLOCKING';
    else if (gameState.crouching) status = 'CROUCHING';
    else if (!gameState.playerArmed) {
      if (playerOrb.state.returning) status = 'RETURNING';
      else if (gameState.discRecalling) status = 'RECALLING';
      else status = 'IN FLIGHT';
    }
    hudStatus.textContent = status;
  }
  if (hudStrikes) {
    const pStrike = '\u25CF'.repeat(gameState.playerStrikes) + '\u25CB'.repeat(CONFIG.STRIKE_MAX_STACKS - gameState.playerStrikes);
    const oStrike = '\u25CF'.repeat(gameState.opponentStrikes) + '\u25CB'.repeat(CONFIG.STRIKE_MAX_STACKS - gameState.opponentStrikes);
    hudStrikes.innerHTML = `<span style="color:rgba(0,200,255,0.7)">${pStrike}</span>  STRIKE  <span style="color:rgba(255,80,0,0.7)">${oStrike}</span>`;
  }
}

function updateDashRing() {
  if (!dashCircle) return;
  if (gameState.dashCooldown > 0) {
    const progress = 1 - (gameState.dashCooldown / CONFIG.DASH_COOLDOWN_S);
    dashCircle.setAttribute('stroke-dashoffset', String(DASH_CIRCUMFERENCE * (1 - progress)));
    dashCircle.style.stroke = 'rgba(0, 220, 255, 0.35)';
  } else {
    dashCircle.setAttribute('stroke-dashoffset', '0');
    dashCircle.style.stroke = 'rgba(0, 220, 255, 0.5)';
  }
}

// =============================================
// OVERLAY MANAGEMENT
// =============================================
function showOverlay(text, subtext, showButton) {
  if (overlayText) overlayText.textContent = text;
  if (overlaySubtext) overlaySubtext.textContent = subtext || '';
  if (playAgainBtn) playAgainBtn.style.display = showButton ? 'block' : 'none';
  if (gameOverlay) {
    gameOverlay.classList.add('visible');
    if (showButton) gameOverlay.classList.add('clickable');
    else gameOverlay.classList.remove('clickable');
  }
}

function hideOverlay() {
  if (gameOverlay) {
    gameOverlay.classList.remove('visible', 'clickable');
  }
}

// Play Again button
if (playAgainBtn) {
  playAgainBtn.addEventListener('click', () => {
    resetMatch();
  });
}

// =============================================
// MATCH FLOW
// =============================================
function startCountdown() {
  gameState.matchPhase = 'countdown';
  gameState.countdownTimer = 3.0;
  gameState.countdownLast = 4;
  showOverlay('3', `ROUND ${gameState.round}`);
}

function beginPlaying() {
  gameState.matchPhase = 'playing';
  hideOverlay();
}

function scorePoint(scorer) {
  if (scorer === 'player') {
    gameState.playerScore++;
  } else {
    gameState.opponentScore++;
  }
  updateHUD();

  // Score particle burst at the hit location
  const burstColor = scorer === 'player' ? 0x00ffff : 0xff4400;
  const burstPos = scorer === 'player' ? opponent.state.position : gameState.playerPos;
  _tmpVec.copy(burstPos);
  particles.burst(_tmpVec, burstColor, 20);
  _tmpVec.y += 0.5;
  particles.burst(_tmpVec, 0xffffff, 8);

  // Score pop animation
  if (hudScore) {
    hudScore.classList.remove('pop');
    void hudScore.offsetWidth;
    hudScore.classList.add('pop');
    hudScore.addEventListener('animationend', () => {
      hudScore.classList.remove('pop');
    }, { once: true });
  }

  // Check for round win
  if (gameState.playerScore >= CONFIG.POINTS_TO_WIN || gameState.opponentScore >= CONFIG.POINTS_TO_WIN) {
    const roundWinner = gameState.playerScore >= CONFIG.POINTS_TO_WIN ? 'player' : 'opponent';
    if (roundWinner === 'player') gameState.playerRounds++;
    else gameState.opponentRounds++;

    // Check for match win
    if (gameState.playerRounds >= CONFIG.ROUNDS_TO_WIN || gameState.opponentRounds >= CONFIG.ROUNDS_TO_WIN) {
      gameState.matchPhase = 'match-over';
      const matchWinner = gameState.playerRounds >= CONFIG.ROUNDS_TO_WIN ? 'YOU WIN' : 'DEFEAT';
      audio.play(gameState.playerRounds >= CONFIG.ROUNDS_TO_WIN ? 'roundWin' : 'roundLose');
      showOverlay(matchWinner, `ROUNDS  ${gameState.playerRounds} - ${gameState.opponentRounds}`, true);
      return;
    }

    // Between rounds
    gameState.matchPhase = 'between-rounds';
    gameState.resetTimer = 2.5;
    const roundLabel = roundWinner === 'player' ? 'ROUND WON' : 'ROUND LOST';
    audio.play(roundWinner === 'player' ? 'roundWin' : 'roundLose');
    showOverlay(roundLabel, `${gameState.playerScore} - ${gameState.opponentScore}`);
    return;
  }

  // Normal score — brief reset
  gameState.matchPhase = 'scoring';
  gameState.resetTimer = CONFIG.RESET_DELAY_S;
}

function resetPositions() {
  // Reset player
  gameState.playerPos.copy(PLAYER_SPAWN);
  gameState.cameraYaw = 0;
  gameState.cameraPitch = 0;
  gameState.playerArmed = true;
  gameState.blocking = false;
  gameState.dashActive = false;
  gameState.dashCooldown = 0;
  gameState.dashTimer = 0;
  gameState.cleanCatchBoostTimer = 0;
  gameState.discRecalling = false;
  gameState.shieldEnergy = CONFIG.SHIELD_ENERGY_MAX;
  gameState.crouching = false;
  gameState.playerVelY = 0;
  gameState.jumpCount = 0;
  gameState.onGround = true;
  playerVelocity.set(0, 0, 0);

  // Reset player orb
  playerOrb.state.isHeld = true;
  playerOrb.state.velocity.set(0, 0, 0);
  playerOrb.state.position.copy(PLAYER_SPAWN);
  playerOrb.state.recalling = false;
  playerOrb.state.stallTimer = 0;
  playerOrb.state.returning = false;
  playerOrb.state.returnTimer = 0;
  playerOrb.state.owner = 'player';
  playerOrb.state.lastDeflectedBy = null;
  playerOrb.state.curveAccel.set(0, 0, 0);
  playerOrb.state.curveTimer = 0;
  playerOrb.body.velocity.set(0, 0, 0);
  playerOrb.body.angularVelocity.set(0, 0, 0);
  playerOrb.body.position.set(PLAYER_SPAWN.x, PLAYER_SPAWN.y, PLAYER_SPAWN.z);
  playerOrb.body.linearDamping = 0.01;

  // Reset opponent
  opponent.state.alive = true;
  opponent.state.dissolving = false;
  opponent.state.dissolveTimer = 0;
  opponent.state.respawnTimer = 0;
  opponent.state.position.set(0, CONFIG.PLAYER_EYE_HEIGHT, -CONFIG.ARENA_LENGTH / 2 + 3);
  opponent.state.armed = true;
  opponent.state.throwTimer = 0;
  // Reset AI-specific state
  opponent.state.throwTimer = 0;
  opponent.state.throwInterval = 1.5 + Math.random() * 2.0;
  opponent.state.threatDetected = false;
  opponent.state.dodgeDir = 0;
  opponent.state.dashActive = false;
  opponent.state.dashCooldown = 0;
  opponent.state.blocking = false;
  opponent.state.blockReactionTimer = 0;
  opponent.state.blockDuration = 0;
  opponent.bodyGroup.visible = true;
  opponent.bodyGroup.scale.set(1, 1, 1);
  opponent.glowLight.intensity = 0.5;

  // Reset opponent orb
  opponentOrb.state.isHeld = true;
  opponentOrb.state.velocity.set(0, 0, 0);
  opponentOrb.state.position.copy(opponent.state.position);
  opponentOrb.state.recalling = false;
  opponentOrb.state.stallTimer = 0;
  opponentOrb.state.returning = false;
  opponentOrb.state.returnTimer = 0;
  opponentOrb.state.owner = 'opponent';
  opponentOrb.state.lastDeflectedBy = null;
  opponentOrb.state.curveAccel.set(0, 0, 0);
  opponentOrb.state.curveTimer = 0;
  opponentOrb.body.velocity.set(0, 0, 0);
  opponentOrb.body.angularVelocity.set(0, 0, 0);
  opponentOrb.body.position.set(opponent.state.position.x, opponent.state.position.y, opponent.state.position.z);
  opponentOrb.body.linearDamping = 0.01;

  // Reset strike stacks
  gameState.playerStrikes = 0;
  gameState.opponentStrikes = 0;
  playerOrb.state.strikeStacks = 0;
  opponentOrb.state.strikeStacks = 0;

  // Shields off
  playerShield.state.active = false;
  playerShield.mesh.visible = false;
  playerShield.body.position.set(0, -100, 0);
  playerShield.reflections.length = 0;

  opponentShield.state.active = false;
  opponentShield.mesh.visible = false;
  opponentShield.body.position.set(0, -100, 0);
  opponentShield.reflections.length = 0;

  camera.position.copy(PLAYER_SPAWN);
  camera.rotation.set(0, 0, 0);
}

function nextRound() {
  gameState.round++;
  gameState.playerScore = 0;
  gameState.opponentScore = 0;
  resetPositions();
  startCountdown();
  updateHUD();
}

function resetMatch() {
  gameState.round = 1;
  gameState.playerRounds = 0;
  gameState.opponentRounds = 0;
  gameState.playerScore = 0;
  gameState.opponentScore = 0;
  gameState.throws = 0;
  gameState.catches = 0;
  gameState.firstThrow = false;
  resetPositions();
  hideOverlay();
  updateHUD();
  startCountdown();
  if (instructions) instructions.style.opacity = '1';
}

// =============================================
// MOUSE LOOK
// =============================================
function updateMouseLook(input) {
  gameState.cameraYaw -= input.lookDeltaX * CONFIG.MOUSE_SENSITIVITY;
  gameState.cameraPitch -= input.lookDeltaY * CONFIG.MOUSE_SENSITIVITY;
  gameState.cameraPitch = THREE.MathUtils.clamp(gameState.cameraPitch, -Math.PI / 3, Math.PI / 3);
}

// =============================================
// PLAYER MOVEMENT
// =============================================
const PLAYER_BOUNDS_X = CONFIG.ARENA_WIDTH / 2 - 0.5;
const PLAYER_BOUNDS_Z_MIN = CONFIG.ARENA_LENGTH / 2 - CONFIG.PLAYER_BOUNDS_DEPTH;
const PLAYER_BOUNDS_Z_MAX = CONFIG.ARENA_LENGTH / 2 - 1;

function updatePlayer(dt, input) {
  // --- Crouch (hold C or Ctrl — ground only) ---
  const wantsCrouch = (input.keys.c || input.keys.control) && gameState.onGround;
  gameState.crouching = wantsCrouch;

  // --- Jump / Double Jump ---
  if (input.jumpTriggered && gameState.jumpCount < CONFIG.MAX_JUMPS && !gameState.dashActive) {
    if (gameState.crouching) gameState.crouching = false;
    if (gameState.blocking) gameState.blocking = false; // jump cancels block
    gameState.playerVelY = (gameState.jumpCount === 0) ? CONFIG.JUMP_VELOCITY : CONFIG.DOUBLE_JUMP_VELOCITY;
    gameState.jumpCount++;
    gameState.onGround = false;
    audio.play('jump');
  }

  // During dash, movement is overridden
  if (gameState.dashActive) {
    gameState.dashTimer -= dt;
    const dashSpeed = CONFIG.DASH_DISTANCE / CONFIG.DASH_DURATION_S;
    playerVelocity.copy(gameState.dashDirection).multiplyScalar(dashSpeed);

    if (gameState.dashTimer <= 0) {
      gameState.dashActive = false;
      playerVelocity.set(0, 0, 0);
    }

    gameState.playerPos.x += playerVelocity.x * dt;
    gameState.playerPos.z += playerVelocity.z * dt;
    gameState.playerPos.x = THREE.MathUtils.clamp(gameState.playerPos.x, -PLAYER_BOUNDS_X, PLAYER_BOUNDS_X);
    gameState.playerPos.z = THREE.MathUtils.clamp(gameState.playerPos.z, PLAYER_BOUNDS_Z_MIN, PLAYER_BOUNDS_Z_MAX);

    // Vertical movement continues during dash
    updateVerticalMovement(dt);
    camera.position.copy(gameState.playerPos);
    applyCameraShake();
    camera.rotation.order = 'YXZ';
    camera.rotation.y = gameState.cameraYaw;
    camera.rotation.x = gameState.cameraPitch;
    return;
  }

  const sinYaw = Math.sin(gameState.cameraYaw);
  const cosYaw = Math.cos(gameState.cameraYaw);
  const fwdX = -sinYaw;
  const fwdZ = -cosYaw;
  const rightX = cosYaw;
  const rightZ = -sinYaw;

  let wishX = 0, wishZ = 0;
  if (input.keys.w || input.keys.arrowup) { wishX += fwdX; wishZ += fwdZ; }
  if (input.keys.s || input.keys.arrowdown) { wishX -= fwdX; wishZ -= fwdZ; }
  if (input.keys.d || input.keys.arrowright) { wishX += rightX; wishZ += rightZ; }
  if (input.keys.a || input.keys.arrowleft) { wishX -= rightX; wishZ -= rightZ; }

  let speedMult = gameState.blocking ? CONFIG.BLOCK_SPEED_PENALTY : 1.0;
  if (gameState.cleanCatchBoostTimer > 0) speedMult *= (1 + CONFIG.CLEAN_CATCH_SPEED_BOOST);
  if (gameState.crouching) speedMult *= CONFIG.CROUCH_MOVE_PENALTY;
  if (!gameState.onGround) speedMult *= CONFIG.AIR_MOVE_PENALTY;

  const wishLen = Math.sqrt(wishX * wishX + wishZ * wishZ);
  if (wishLen > 0.01) {
    const invLen = 1 / wishLen;
    wishX *= invLen;
    wishZ *= invLen;
    playerVelocity.x += wishX * CONFIG.MOVE_ACCEL * dt;
    playerVelocity.z += wishZ * CONFIG.MOVE_ACCEL * dt;
    const speed = playerVelocity.length();
    const maxSpeed = CONFIG.MOVE_MAX_SPEED * speedMult;
    if (speed > maxSpeed) {
      playerVelocity.multiplyScalar(maxSpeed / speed);
    }
  } else {
    const speed = playerVelocity.length();
    if (speed > 0.1) {
      const decel = Math.min(CONFIG.MOVE_DECEL * dt, speed);
      const scale = (speed - decel) / speed;
      playerVelocity.multiplyScalar(scale);
    } else {
      playerVelocity.set(0, 0, 0);
    }
  }

  gameState.playerPos.x += playerVelocity.x * dt;
  gameState.playerPos.z += playerVelocity.z * dt;
  gameState.playerPos.x = THREE.MathUtils.clamp(gameState.playerPos.x, -PLAYER_BOUNDS_X, PLAYER_BOUNDS_X);
  gameState.playerPos.z = THREE.MathUtils.clamp(gameState.playerPos.z, PLAYER_BOUNDS_Z_MIN, PLAYER_BOUNDS_Z_MAX);

  // Vertical movement (jump gravity + crouch transition)
  updateVerticalMovement(dt);

  camera.position.copy(gameState.playerPos);
  applyCameraShake();
  camera.rotation.order = 'YXZ';
  camera.rotation.y = gameState.cameraYaw;
  camera.rotation.x = gameState.cameraPitch;
}

function updateVerticalMovement(dt) {
  const targetEyeHeight = gameState.crouching ? CONFIG.CROUCH_EYE_HEIGHT : CONFIG.PLAYER_EYE_HEIGHT;

  if (!gameState.onGround) {
    // Airborne — apply gravity
    gameState.playerVelY -= CONFIG.PLAYER_GRAVITY * dt;
    gameState.playerPos.y += gameState.playerVelY * dt;

    // Ceiling clamp
    if (gameState.playerPos.y > CONFIG.ARENA_HEIGHT - 0.3) {
      gameState.playerPos.y = CONFIG.ARENA_HEIGHT - 0.3;
      gameState.playerVelY = 0;
    }

    // Ground detection
    if (gameState.playerPos.y <= targetEyeHeight) {
      gameState.playerPos.y = targetEyeHeight;
      gameState.playerVelY = 0;
      gameState.onGround = true;
      gameState.jumpCount = 0;
    }
  } else {
    // On ground — smooth crouch/stand transition
    const diff = targetEyeHeight - gameState.playerPos.y;
    if (Math.abs(diff) > 0.01) {
      gameState.playerPos.y += diff * CONFIG.CROUCH_TRANSITION_SPEED * dt;
    } else {
      gameState.playerPos.y = targetEyeHeight;
    }
  }
}

// =============================================
// DASH
// =============================================
function handleDash(input, dt) {
  // Tick cooldown
  if (gameState.dashCooldown > 0) {
    gameState.dashCooldown -= dt;
    if (gameState.dashCooldown < 0) gameState.dashCooldown = 0;
  }

  // Tick clean catch boost
  if (gameState.cleanCatchBoostTimer > 0) {
    gameState.cleanCatchBoostTimer -= dt;
    if (gameState.cleanCatchBoostTimer < 0) gameState.cleanCatchBoostTimer = 0;
  }

  if (!input.dashTriggered) return;
  if (gameState.dashCooldown > 0) return;
  if (gameState.dashActive) return;
  if (!gameState.onGround) return;

  // Determine dash direction — lateral strafe direction, or forward if no strafe input
  const fwdX = -Math.sin(gameState.cameraYaw);
  const fwdZ = -Math.cos(gameState.cameraYaw);
  const rgtX = -fwdZ;
  const rgtZ = fwdX;

  let dashX = 0, dashZ = 0;
  if (input.keys.a || input.keys.arrowleft) { dashX -= rgtX; dashZ -= rgtZ; }
  if (input.keys.d || input.keys.arrowright) { dashX += rgtX; dashZ += rgtZ; }
  if (input.keys.w || input.keys.arrowup) { dashX += fwdX; dashZ += fwdZ; }
  if (input.keys.s || input.keys.arrowdown) { dashX -= fwdX; dashZ -= fwdZ; }

  // Default to forward if no movement keys
  if (dashX * dashX + dashZ * dashZ < 0.01) { dashX = fwdX; dashZ = fwdZ; }
  const dashLen = Math.sqrt(dashX * dashX + dashZ * dashZ);
  dashX /= dashLen; dashZ /= dashLen;

  gameState.dashActive = true;
  gameState.dashTimer = CONFIG.DASH_DURATION_S;
  gameState.dashDirection.set(dashX, 0, dashZ);
  gameState.dashCooldown = CONFIG.DASH_COOLDOWN_S;

  // Dash cancels block
  gameState.blocking = false;

  audio.play('dash');
  updateHUD();
}

// =============================================
// THROW LOGIC
// =============================================
function handleThrow(input) {
  if (!gameState.playerArmed || gameState.blocking) return;
  if (!input.throwTriggered) return;
  if (gameState.dashActive) return;

  if (!gameState.firstThrow) {
    gameState.firstThrow = true;
    if (instructions) instructions.style.opacity = '0';
  }

  const throwSpeed = CONFIG.THROW_SPEED * (1 + playerOrb.state.strikeStacks * CONFIG.STRIKE_SPEED_SCALE);

  _tmpVec.set(0, 0, -1);
  _tmpEuler.set(gameState.cameraPitch, gameState.cameraYaw, 0);
  _tmpVec.applyEuler(_tmpEuler);
  _tmpVec.normalize();

  _tmpVec2.copy(_tmpVec).multiplyScalar(1.5);
  _tmpVec2.y -= 0.2;

  const ds = playerOrb.state;
  ds.isHeld = false;
  ds.position.copy(gameState.playerPos).add(_tmpVec2);
  ds.velocity.copy(_tmpVec).multiplyScalar(throwSpeed);
  ds.velocity.x += playerVelocity.x * 0.5;
  ds.velocity.y += playerVelocity.y * 0.5;
  ds.velocity.z += playerVelocity.z * 0.5;
  ds.throwTime = performance.now();
  ds.recalling = false;
  ds.stallTimer = 0;
  ds.returning = false;
  ds.returnTimer = 0;

  playerOrb.body.linearDamping = 0.01;
  playerOrb.body.position.set(ds.position.x, ds.position.y, ds.position.z);
  playerOrb.body.velocity.set(ds.velocity.x, ds.velocity.y, ds.velocity.z);
  playerOrb.body.angularVelocity.set(0, throwSpeed * 0.5, 0);

  // Flick-spin curve
  const flickDx = getFlickDelta();
  if (Math.abs(flickDx) > CONFIG.FLICK_THRESHOLD_PX) {
    _tmpVec3.set(-Math.sin(gameState.cameraYaw + Math.PI / 2), 0, -Math.cos(gameState.cameraYaw + Math.PI / 2));
    const curveMag = Math.sign(flickDx) * CONFIG.FLICK_CURVE_ACCEL;
    ds.curveAccel.copy(_tmpVec3).multiplyScalar(curveMag);
    ds.curveTimer = CONFIG.FLICK_CURVE_DURATION_S;
  } else {
    ds.curveAccel.set(0, 0, 0);
    ds.curveTimer = 0;
  }

  gameState.playerArmed = false;
  gameState.discRecalling = false;
  gameState.throwTime = performance.now();
  gameState.throws++;
  updateHUD();
  audio.play('throw');

  if (network && network.isConnected()) {
    network.sendEvent({
      name: 'throw',
      orbX: ds.position.x, orbY: ds.position.y, orbZ: ds.position.z,
      orbVx: ds.velocity.x, orbVy: ds.velocity.y, orbVz: ds.velocity.z,
    });
  }
}

// =============================================
// BLOCK / SHIELD
// =============================================
function handleBlock(input, dt) {
  if (gameState.dashActive) {
    gameState.blocking = false;
    return;
  }

  const wasBlocking = gameState.blocking;
  const wantsBlock = input.blocking && gameState.playerArmed && gameState.onGround;

  if (wantsBlock && gameState.shieldEnergy > CONFIG.SHIELD_MIN_ACTIVATE) {
    gameState.blocking = true;
    if (!wasBlocking) audio.play('shieldUp');
    gameState.shieldEnergy -= CONFIG.SHIELD_DRAIN_RATE * dt;
    if (gameState.shieldEnergy <= 0) {
      gameState.shieldEnergy = 0;
      gameState.blocking = false; // force drop
    }
  } else {
    gameState.blocking = false;
  }

  // Play shield down sound on transition
  if (wasBlocking && !gameState.blocking) audio.play('shieldDown');

  // Recharge when not blocking
  if (!gameState.blocking) {
    gameState.shieldEnergy = Math.min(
      CONFIG.SHIELD_ENERGY_MAX,
      gameState.shieldEnergy + CONFIG.SHIELD_RECHARGE_RATE * dt
    );
  }

  // Update HUD bar
  if (shieldBar) {
    const pct = (gameState.shieldEnergy / CONFIG.SHIELD_ENERGY_MAX) * 100;
    shieldBar.style.width = pct + '%';
    if (gameState.shieldEnergy < CONFIG.SHIELD_MIN_ACTIVATE) {
      shieldBar.style.background = 'rgba(255, 60, 0, 0.6)';
    } else {
      shieldBar.style.background = 'rgba(0, 200, 255, 0.5)';
    }
  }
}

// =============================================
// SHIELD REFLECTION
// =============================================
function handleShieldReflections() {
  // Compute camera forward for aimed redirect
  _aimDir.set(0, 0, -1);
  _tmpEuler.set(gameState.cameraPitch, gameState.cameraYaw, 0);
  _aimDir.applyEuler(_tmpEuler);

  // Drain queue — processReflection already shifts one event per call
  while (playerShield.reflections.length > 0) {
    const result = processReflection(playerShield, opponentOrb.state, opponentOrb.body, _aimDir);
    if (result) {
      opponentOrb.state.owner = 'player';
      opponentOrb.state.lastDeflectedBy = 'player';

      // In multiplayer, notify opponent their orb was deflected
      if (gameState.multiplayerActive && network) {
        network.sendEvent({
          name: 'my_shield_deflected_your_orb',
          orbVx: opponentOrb.state.velocity.x,
          orbVy: opponentOrb.state.velocity.y,
          orbVz: opponentOrb.state.velocity.z,
          isParry: result.isParry,
        });
      }

      if (result.isParry) {
        audio.play('parry');
        particles.burst(playerShield.mesh.position, 0x00ffff, 15);
        gameState.cameraPitch += 0.02;
        gameState.parryFlashTimer = 0.1;
        if (parryFlash) parryFlash.style.opacity = '0.15';
      } else {
        audio.play('deflect');
        particles.burst(playerShield.mesh.position, 0x00ddff, 8);
      }
    }
    // processReflection already shifted, do NOT shift again
  }
}

// =============================================
// OPPONENT SHIELD REFLECTION
// =============================================
function handleOpponentShieldReflections() {
  while (opponentShield.reflections.length > 0) {
    const result = processReflection(opponentShield, playerOrb.state, playerOrb.body);
    if (result) {
      playerOrb.state.owner = 'opponent';
      playerOrb.state.lastDeflectedBy = 'opponent';

      if (result.isParry) {
        audio.play('parry');
        particles.burst(opponentShield.mesh.position, 0xff4400, 15);
      } else {
        audio.play('deflect');
        particles.burst(opponentShield.mesh.position, 0xff4400, 8);
      }
    }
  }
}

// =============================================
// RECALL LOGIC — per-orb
// =============================================
function handleRecall(orb, holderPos, dt) {
  const ds = orb.state;
  if (ds.isHeld) {
    ds.stallTimer = 0;
    ds.recalling = false;
    return;
  }

  const timeSinceThrow = (performance.now() - ds.throwTime) / 1000;

  if (!ds.recalling && timeSinceThrow > CONFIG.RECALL_MAX_TIME) {
    startRecall(orb);
  }

  if (ds.recalling) {
    // Use temp vector to avoid allocations
    _tmpVec.copy(holderPos).sub(ds.position);
    const dist = _tmpVec.length();
    if (dist < 0.3) return;

    _tmpVec.normalize();
    const speed = Math.min(CONFIG.RECALL_SPEED, CONFIG.RECALL_SPEED * (dist / 5) + 4);
    ds.position.x += _tmpVec.x * speed * dt;
    ds.position.y += _tmpVec.y * speed * dt;
    ds.position.z += _tmpVec.z * speed * dt;
    ds.position.y += (holderPos.y - ds.position.y) * 4 * dt;

    orb.body.position.set(ds.position.x, ds.position.y, ds.position.z);
    orb.body.velocity.set(0, 0, 0);
    ds.velocity.set(_tmpVec.x * speed, _tmpVec.y * speed, _tmpVec.z * speed);
    return;
  }

  const speed = ds.velocity.length();
  if (speed < CONFIG.STALL_SPEED) {
    ds.stallTimer += dt;
    if (ds.stallTimer >= CONFIG.RECALL_DELAY) {
      startRecall(orb);
    }
  } else {
    ds.stallTimer = 0;
  }
}

function startRecall(orb) {
  orb.state.recalling = true;
  orb.state.returning = false;
  orb.state.returnTimer = 0;
  orb.body.linearDamping = 0.99;
  updateHUD();
}

// =============================================
// CATCH LOGIC
// =============================================
function handlePlayerCatch(input) {
  if (gameState.playerArmed) return;

  const ds = playerOrb.state;
  const timeSinceThrow = performance.now() - ds.throwTime;
  if (timeSinceThrow < CONFIG.CATCH_GRACE_PERIOD_MS) return;

  const dist = ds.position.distanceTo(gameState.playerPos);
  if (dist > CONFIG.CATCH_RADIUS) return;

  // Facing check
  _tmpVec.set(0, 0, -1);
  _tmpEuler.set(gameState.cameraPitch, gameState.cameraYaw, 0);
  _tmpVec.applyEuler(_tmpEuler);
  _tmpVec2.copy(ds.position).sub(gameState.playerPos).normalize();
  const facingDot = _tmpVec.dot(_tmpVec2);

  if (facingDot < CONFIG.CATCH_FACING_DOT && !ds.recalling) return;
  if (gameState.blocking) return;

  const isClean = input.cleanCatchTriggered;
  catchPlayerOrb(isClean);
}

function catchPlayerOrb(isClean) {
  playerOrb.state.isHeld = true;
  playerOrb.state.velocity.set(0, 0, 0);
  playerOrb.state.recalling = false;
  playerOrb.state.stallTimer = 0;
  playerOrb.state.returning = false;
  playerOrb.state.returnTimer = 0;
  playerOrb.state.owner = 'player';
  playerOrb.state.lastDeflectedBy = null;

  playerOrb.body.position.set(gameState.playerPos.x, gameState.playerPos.y, gameState.playerPos.z);
  playerOrb.body.velocity.set(0, 0, 0);
  playerOrb.body.angularVelocity.set(0, 0, 0);
  playerOrb.body.linearDamping = 0.01;
  flushBounceQueue(playerOrb);

  gameState.playerArmed = true;
  gameState.discRecalling = false;
  gameState.catches++;
  updateHUD();

  if (isClean) {
    audio.play('cleanCatch');
    particles.burst(playerOrb.state.position, 0x00ffff, 25);
    // Speed boost
    gameState.cleanCatchBoostTimer = CONFIG.CLEAN_CATCH_BOOST_DURATION;
  } else {
    audio.play('catch');
    particles.burst(playerOrb.state.position, 0x00ffff, 10);
  }
}

// =============================================
// HIT DETECTION — ownership-aware
// =============================================
function handleHits() {
  const now = performance.now();

  // --- Player orb hitting opponent (SINGLE PLAYER ONLY) ---
  // In multiplayer, the remote player detects hits on themselves
  if (!gameState.multiplayerActive) {
    if (!playerOrb.state.isHeld && !playerOrb.state.recalling && !playerOrb.state.returning) {
      if (opponent.state.alive && !opponent.state.dissolving) {
        const timeSinceThrow = now - playerOrb.state.throwTime;
        if (timeSinceThrow > CONFIG.HIT_GRACE_PERIOD_MS) {
          if (now - gameState.lastOppHitTime > CONFIG.SCORE_DEBOUNCE_MS) {
            const speed = playerOrb.state.velocity.length();
            if (speed > CONFIG.SCORE_MIN_SPEED) {
              const dist = playerOrb.state.position.distanceTo(opponent.state.position);
              if (dist < CONFIG.OPP_HIT_RADIUS) {
                gameState.lastOppHitTime = now;
                const scorer = playerOrb.state.owner === 'player' ? 'player' : 'opponent';
                playerOrb.state.strikeStacks = 0;
                dissolveOpponent(opponent, particles, audio);
                startRecall(playerOrb);
                gameState.shakeTimer = 0.15;
                scorePoint(scorer);
              }
            }
          }
        }
      }
    }

    // --- Opponent orb (reflected by parry) hitting opponent ---
    if (!opponentOrb.state.isHeld && !opponentOrb.state.recalling && !opponentOrb.state.returning) {
      if (opponent.state.alive && !opponent.state.dissolving) {
        if (opponentOrb.state.owner === 'player') {
          if (now - gameState.lastOppHitTime > CONFIG.SCORE_DEBOUNCE_MS) {
            const speed = opponentOrb.state.velocity.length();
            if (speed > CONFIG.SCORE_MIN_SPEED) {
              const dist = opponentOrb.state.position.distanceTo(opponent.state.position);
              if (dist < CONFIG.OPP_HIT_RADIUS) {
                gameState.lastOppHitTime = now;
                opponentOrb.state.strikeStacks = 0;
                dissolveOpponent(opponent, particles, audio);
                gameState.shakeTimer = 0.15;
                scorePoint('player');
              }
            }
          }
        }
      }
    }
  }

  // --- Opponent orb hitting player (BOTH MODES) ---
  if (!opponentOrb.state.isHeld && !opponentOrb.state.recalling && !opponentOrb.state.returning) {
    const timeSinceThrow = now - opponentOrb.state.throwTime;
    // In multiplayer, skip throwTime grace (orb is positioned from network, throwTime isn't synced)
    const graceOk = gameState.multiplayerActive || timeSinceThrow > CONFIG.HIT_GRACE_PERIOD_MS;
    if (graceOk) {
      if (now - gameState.lastPlayerHitTime > CONFIG.SCORE_DEBOUNCE_MS) {
        // In multiplayer, skip owner check (opponent orb is always opponent's)
        const ownerOk = gameState.multiplayerActive || opponentOrb.state.owner === 'opponent';
        if (ownerOk) {
          const speed = opponentOrb.state.velocity.length();
          if (speed > CONFIG.SCORE_MIN_SPEED) {
            const dist = opponentOrb.state.position.distanceTo(gameState.playerPos);
            if (dist < CONFIG.OPP_HIT_RADIUS) {
              gameState.lastPlayerHitTime = now;
              opponentOrb.state.strikeStacks = 0;
              audio.play('hit');
              gameState.hitFlashTimer = 0.2;
              if (hitFlash) hitFlash.style.opacity = '0.6';
              gameState.shakeTimer = 0.2;

              if (gameState.multiplayerActive && network) {
                // Tell server we got hit — server handles scoring
                network.sendEvent({ name: 'i_got_hit' });
              } else {
                startRecall(opponentOrb);
                scorePoint('opponent');
              }
            }
          }
        }
      }
    }
  }
}

// =============================================
// STRIKE ZONE CHECKS
// =============================================
function handleStrikeZones() {
  if (!playerOrb.state.isHeld && !playerOrb.state.recalling && !playerOrb.state.returning) {
    if (checkStrikeZone(strikeZones, 'opponent', playerOrb.state)) {
      if (gameState.playerStrikes < CONFIG.STRIKE_MAX_STACKS) {
        gameState.playerStrikes++;
        playerOrb.state.strikeStacks = gameState.playerStrikes;
        audio.play('strike');
        updateHUD();
      }
    }
  }

  if (!gameState.multiplayerActive) {
    if (!opponentOrb.state.isHeld && !opponentOrb.state.recalling && !opponentOrb.state.returning) {
      if (opponentOrb.state.owner === 'opponent') {
        if (checkStrikeZone(strikeZones, 'player', opponentOrb.state)) {
          if (gameState.opponentStrikes < CONFIG.STRIKE_MAX_STACKS) {
            gameState.opponentStrikes++;
            opponentOrb.state.strikeStacks = gameState.opponentStrikes;
            audio.play('strike');
            updateHUD();
          }
        }
      }
    }
  }
}

// =============================================
// BOUNCE HANDLERS — per-orb for back-wall detection
// =============================================
function onPlayerOrbBounce(pos, normal) {
  audio.play('bounce');
  _tmpVec4.set(pos.x, pos.y, pos.z);
  particles.burst(_tmpVec4, 0x00ffff, 10);
  arena.flashEdge(pos);

  // Detect opponent's back wall (-Z wall — stored normal points into wall, so z < 0)
  if (normal.z < -0.5 && !playerOrb.state.returning && !playerOrb.state.isHeld) {
    playerOrb.state.returning = true;
    playerOrb.state.returnTimer = 0;
    // Normalize velocity to controlled return speed (preserve direction for natural arc)
    const speed = playerOrb.state.velocity.length();
    if (speed > 0.01) {
      playerOrb.state.velocity.multiplyScalar(CONFIG.RETURN_INITIAL_SPEED / speed);
    }
    // Clear flick curve so it doesn't interfere with return steering
    playerOrb.state.curveTimer = 0;
    playerOrb.state.curveAccel.set(0, 0, 0);
    // Park physics body outside arena — manual flight takes over
    playerOrb.body.position.set(0, -50, 0);
    playerOrb.body.velocity.set(0, 0, 0);
  }
}

function onOpponentOrbBounce(pos, normal) {
  audio.play('bounce');
  _tmpVec4.set(pos.x, pos.y, pos.z);
  particles.burst(_tmpVec4, 0xff4400, 10);
  arena.flashEdge(pos);

  // Detect player's back wall (+Z wall — stored normal points into wall, so z > 0)
  if (normal.z > 0.5 && !opponentOrb.state.returning && !opponentOrb.state.isHeld) {
    opponentOrb.state.returning = true;
    opponentOrb.state.returnTimer = 0;
    // Normalize velocity to controlled return speed (preserve direction for natural arc)
    const speed = opponentOrb.state.velocity.length();
    if (speed > 0.01) {
      opponentOrb.state.velocity.multiplyScalar(CONFIG.RETURN_INITIAL_SPEED / speed);
    }
    // Clear flick curve so it doesn't interfere with return steering
    opponentOrb.state.curveTimer = 0;
    opponentOrb.state.curveAccel.set(0, 0, 0);
    // Park physics body outside arena — manual flight takes over
    opponentOrb.body.position.set(0, -50, 0);
    opponentOrb.body.velocity.set(0, 0, 0);
  }
}

// =============================================
// BOUNCE QUEUE FLUSH — clear stale entries when catching an orb
// =============================================
function flushBounceQueue(orb) {
  const bq = physics.bounceQueue;
  const bodyId = orb.body.id;
  for (let i = bq.length - 1; i >= 0; i--) {
    if (bq[i].bodyId === bodyId) {
      const last = bq.length - 1;
      if (i < last) bq[i] = bq[last];
      bq.length = last;
    }
  }
}

// =============================================
// AUTO-RETURN ARC — steers orb back to owner after back wall bounce
// =============================================
function handleOrbReturn(orb, ownerPos, dt) {
  const ds = orb.state;
  if (!ds.returning || ds.isHeld) return false;

  ds.returnTimer += dt;

  // Direction to owner
  const dx = ownerPos.x - ds.position.x;
  const dy = ownerPos.y - ds.position.y;
  const dz = ownerPos.z - ds.position.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Auto-catch when close enough
  if (dist < CONFIG.RETURN_CATCH_DIST) return true;

  // Normalized direction
  const invDist = 1 / Math.max(dist, 0.01);

  // Steering force — ramps up for gentle initial curve, then stronger homing
  const steer = Math.min(CONFIG.RETURN_STEER_MAX,
    CONFIG.RETURN_STEER_BASE + ds.returnTimer * CONFIG.RETURN_STEER_RAMP);

  ds.velocity.x += dx * invDist * steer * dt;
  ds.velocity.y += dy * invDist * steer * dt;
  ds.velocity.z += dz * invDist * steer * dt;

  // Counteract gravity for floatier arc
  ds.velocity.y += CONFIG.GRAVITY * CONFIG.RETURN_GRAVITY_COUNTER * dt;

  // Clamp speed within [min, max] range
  const speed = ds.velocity.length();
  if (speed > CONFIG.RETURN_SPEED_MAX) {
    ds.velocity.multiplyScalar(CONFIG.RETURN_SPEED_MAX / speed);
  } else if (speed < CONFIG.RETURN_SPEED_MIN && speed > 0.01) {
    ds.velocity.multiplyScalar(CONFIG.RETURN_SPEED_MIN / speed);
  }

  // Manual position integration (physics is bypassed — body parked at y=-50)
  ds.position.x += ds.velocity.x * dt;
  ds.position.y += ds.velocity.y * dt;
  ds.position.z += ds.velocity.z * dt;

  // Clamp inside arena bounds — reflect velocity off walls for natural containment
  const halfW = CONFIG.ARENA_WIDTH / 2 - 0.3;
  const halfZ = CONFIG.ARENA_LENGTH / 2 - 0.3;
  const minY = 0.3;
  const maxY = CONFIG.ARENA_HEIGHT - 0.3;

  if (ds.position.x < -halfW) { ds.position.x = -halfW; ds.velocity.x = Math.abs(ds.velocity.x); }
  if (ds.position.x > halfW)  { ds.position.x = halfW;  ds.velocity.x = -Math.abs(ds.velocity.x); }
  if (ds.position.y < minY)   { ds.position.y = minY;   ds.velocity.y = Math.abs(ds.velocity.y); }
  if (ds.position.y > maxY)   { ds.position.y = maxY;   ds.velocity.y = -Math.abs(ds.velocity.y); }
  if (ds.position.z < -halfZ) { ds.position.z = -halfZ; ds.velocity.z = Math.abs(ds.velocity.z); }
  if (ds.position.z > halfZ)  { ds.position.z = halfZ;  ds.velocity.z = -Math.abs(ds.velocity.z); }

  return false;
}

// =============================================
// COUNTDOWN / MATCH PHASE UPDATES
// =============================================
function updateCountdown(dt) {
  gameState.countdownTimer -= dt;

  const timeLeft = Math.ceil(gameState.countdownTimer);
  if (timeLeft !== gameState.countdownLast && timeLeft > 0) {
    gameState.countdownLast = timeLeft;
    if (overlayText) overlayText.textContent = String(timeLeft);
    audio.play('countdown');
  }

  if (gameState.countdownTimer <= 0) {
    if (overlayText) overlayText.textContent = 'GO';
    audio.play('go');
    // Brief "GO" display, then start
    setTimeout(() => {
      beginPlaying();
    }, 400);
    gameState.matchPhase = 'go-flash';
  }
}

function updateScoringPhase(dt) {
  gameState.resetTimer -= dt;
  if (gameState.resetTimer <= 0) {
    resetPositions();
    gameState.matchPhase = 'playing';
    updateHUD();
  }
}

function updateBetweenRounds(dt) {
  gameState.resetTimer -= dt;
  if (gameState.resetTimer <= 0) {
    nextRound();
  }
}

// =============================================
// MULTIPLAYER — NETWORK OPPONENT STATE
// =============================================
let latestOpponentData = null;

function applyNetworkOpponentState(data, dt) {
  const lerpFactor = Math.min(1, 15 * dt);

  // Interpolate position
  opponent.state.position.x += (data.px - opponent.state.position.x) * lerpFactor;
  opponent.state.position.y += (data.py - opponent.state.position.y) * lerpFactor;
  opponent.state.position.z += (data.pz - opponent.state.position.z) * lerpFactor;

  // Smooth yaw interpolation
  let yawDiff = data.yaw - opponent.state.yaw;
  while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
  while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
  opponent.state.yaw += yawDiff * lerpFactor;

  // Discrete states
  opponent.state.blocking = data.blocking;
  opponent.state.armed = data.armed;
  opponent.state.dashActive = data.dashActive;

  // Update visual model
  opponent.bodyGroup.position.set(
    opponent.state.position.x,
    opponent.state.position.y - CONFIG.PLAYER_EYE_HEIGHT + 0.5,
    opponent.state.position.z
  );
  opponent.bodyGroup.rotation.y = opponent.state.yaw;
  opponent.bodyGroup.visible = true;
}

function applyNetworkOpponentOrb(data, dt) {
  const ds = opponentOrb.state;
  ds.isHeld = data.orbHeld;
  ds.strikeStacks = data.orbStrikeStacks;
  ds.returning = data.orbReturning;

  if (!ds.isHeld) {
    // Interpolate orb position for smooth visuals
    const lerpFactor = Math.min(1, 20 * dt);
    ds.position.x += (data.orbX - ds.position.x) * lerpFactor;
    ds.position.y += (data.orbY - ds.position.y) * lerpFactor;
    ds.position.z += (data.orbZ - ds.position.z) * lerpFactor;
    ds.velocity.set(data.orbVx, data.orbVy, data.orbVz);

    // Sync physics body position for shield collision detection
    opponentOrb.body.position.set(ds.position.x, ds.position.y, ds.position.z);
    opponentOrb.body.velocity.set(ds.velocity.x, ds.velocity.y, ds.velocity.z);
  }

  // Update opponent strike stacks for HUD
  gameState.opponentStrikes = data.orbStrikeStacks;
}

// =============================================
// GAME LOOP
// =============================================
const clock = new THREE.Clock();
const FIXED_DT = 1 / 60;
let accumulator = 0;

function gameLoop() {
  requestAnimationFrame(gameLoop);

  const dt = Math.min(clock.getDelta(), 0.1);

  // FPS counter — update every 500ms
  fpsFrameCount++;
  const fpsNow = performance.now();
  if (fpsNow - fpsLastTime >= 500) {
    const fps = Math.round(fpsFrameCount / ((fpsNow - fpsLastTime) / 1000));
    if (fpsCounter) fpsCounter.textContent = fps + ' FPS';
    fpsFrameCount = 0;
    fpsLastTime = fpsNow;
  }

  tickInput();
  const input = getInputState();

  // --- Match phase logic ---
  if (gameState.matchPhase === 'title') {
    updateInput();
    composer.render();
    return;
  }

  if (gameState.matchPhase === 'countdown') {
    updateMouseLook(input);
    updateCountdown(dt);
    updateInput();
    composer.render();
    return;
  }

  if (gameState.matchPhase === 'go-flash') {
    updateMouseLook(input);
    updateInput();
    composer.render();
    return;
  }

  if (gameState.matchPhase === 'scoring') {
    // Allow free movement during score delay
    updateMouseLook(input);
    handleDash(input, dt);
    updatePlayer(dt, input);
    updateScoringPhase(dt);
    updateParticles(particles, dt);
    arena.update(dt);

    // Continue rendering orbs in flight
    if (!playerOrb.state.isHeld) updateOrbFlight(playerOrb, dt);
    if (!opponentOrb.state.isHeld) updateOrbFlight(opponentOrb, dt);

    // Opponent dissolve/respawn still ticks
    if (!gameState.multiplayerActive) {
      updateOpponent(opponent, playerOrb, opponentOrb, gameState.playerPos, dt, audio, particles);
    }

    // Hit flash decay
    if (gameState.hitFlashTimer > 0) {
      gameState.hitFlashTimer -= dt;
      if (hitFlash) {
        hitFlash.style.opacity = String(Math.max(0, gameState.hitFlashTimer / 0.2) * 0.6);
        if (gameState.hitFlashTimer <= 0) hitFlash.style.opacity = '0';
      }
    }

    // Camera shake decay
    if (gameState.shakeTimer > 0) gameState.shakeTimer -= dt;

    // Parry flash decay
    if (gameState.parryFlashTimer > 0) {
      gameState.parryFlashTimer -= dt;
      if (parryFlash) {
        parryFlash.style.opacity = String(Math.max(0, gameState.parryFlashTimer / 0.1) * 0.15);
        if (gameState.parryFlashTimer <= 0) parryFlash.style.opacity = '0';
      }
    }

    updateDashRing();
    updateInput();
    composer.render();
    return;
  }

  if (gameState.matchPhase === 'between-rounds') {
    updateMouseLook(input);
    handleDash(input, dt);
    updatePlayer(dt, input);
    updateBetweenRounds(dt);
    updateParticles(particles, dt);
    arena.update(dt);
    updateDashRing();
    updateInput();
    composer.render();
    return;
  }

  if (gameState.matchPhase === 'match-over') {
    updateInput();
    composer.render();
    return;
  }

  // --- Normal gameplay (matchPhase === 'playing') ---

  // Input processing
  updateMouseLook(input);
  handleBlock(input, dt);
  handleDash(input, dt);
  updatePlayer(dt, input);
  handleThrow(input);

  // Send state to server (multiplayer)
  if (network && network.isConnected()) {
    network.sendState({
      px: gameState.playerPos.x,
      py: gameState.playerPos.y,
      pz: gameState.playerPos.z,
      yaw: gameState.cameraYaw,
      pitch: gameState.cameraPitch,
      blocking: gameState.blocking,
      crouching: gameState.crouching,
      dashActive: gameState.dashActive,
      armed: gameState.playerArmed,
      orbHeld: playerOrb.state.isHeld,
      orbX: playerOrb.state.position.x,
      orbY: playerOrb.state.position.y,
      orbZ: playerOrb.state.position.z,
      orbVx: playerOrb.state.velocity.x,
      orbVy: playerOrb.state.velocity.y,
      orbVz: playerOrb.state.velocity.z,
      orbReturning: playerOrb.state.returning,
      orbStrikeStacks: playerOrb.state.strikeStacks,
    });
  }

  // Update shields BEFORE physics so collision detection sees correct positions
  updateShield(playerShield, gameState.playerPos, gameState.cameraYaw, gameState.cameraPitch, gameState.blocking, gameState.playerArmed);
  updateShield(opponentShield, opponent.state.position, opponent.state.yaw, 0, opponent.state.blocking, opponent.state.armed);

  // Physics
  accumulator += dt;
  while (accumulator >= FIXED_DT) {
    let maxSpeed = 0;
    if (!playerOrb.state.isHeld && !playerOrb.state.recalling && !playerOrb.state.returning) {
      maxSpeed = Math.max(maxSpeed, playerOrb.state.velocity.length());
    }
    if (!gameState.multiplayerActive && !opponentOrb.state.isHeld && !opponentOrb.state.recalling && !opponentOrb.state.returning) {
      maxSpeed = Math.max(maxSpeed, opponentOrb.state.velocity.length());
    }

    if (maxSpeed > 0) {
      stepPhysics(physics, maxSpeed, FIXED_DT);
    }

    if (!playerOrb.state.recalling && !playerOrb.state.returning) {
      syncOrbPhysics(physics, playerOrb, onPlayerOrbBounce);
    }
    if (!gameState.multiplayerActive && !opponentOrb.state.recalling && !opponentOrb.state.returning) {
      syncOrbPhysics(physics, opponentOrb, onOpponentOrbBounce);
    }

    accumulator -= FIXED_DT;
  }

  // Process shield reflections AFTER physics
  handleShieldReflections();
  if (!gameState.multiplayerActive) {
    handleOpponentShieldReflections();
  }

  // Auto-return arc (back wall bounce → homing arc → auto-catch)
  if (handleOrbReturn(playerOrb, gameState.playerPos, dt)) {
    // Auto-catch player orb
    playerOrb.state.returning = false;
    playerOrb.state.returnTimer = 0;
    catchPlayerOrb(false);
  }
  if (!gameState.multiplayerActive) {
    if (handleOrbReturn(opponentOrb, opponent.state.position, dt)) {
      // Auto-catch opponent orb
      opponentOrb.state.isHeld = true;
      opponentOrb.state.velocity.set(0, 0, 0);
      opponentOrb.state.returning = false;
      opponentOrb.state.returnTimer = 0;
      opponentOrb.state.recalling = false;
      opponentOrb.state.stallTimer = 0;
      opponentOrb.body.position.set(opponent.state.position.x, opponent.state.position.y, opponent.state.position.z);
      opponentOrb.body.velocity.set(0, 0, 0);
      opponentOrb.body.angularVelocity.set(0, 0, 0);
      flushBounceQueue(opponentOrb);
      opponent.state.armed = true;
    }
  }

  // Recall (skip if orb is already in auto-return arc)
  if (!playerOrb.state.returning) handleRecall(playerOrb, gameState.playerPos, dt);
  if (!gameState.multiplayerActive && !opponentOrb.state.returning) {
    handleRecall(opponentOrb, opponent.state.position, dt);
  }
  gameState.discRecalling = playerOrb.state.recalling;

  // Orb visuals
  if (playerOrb.state.isHeld) {
    positionHeldOrbFirstPerson(playerOrb, gameState.playerPos, gameState.cameraYaw, gameState.cameraPitch, gameState.blocking);
  } else {
    updateOrbFlight(playerOrb, dt);
  }

  if (opponentOrb.state.isHeld && opponent.state.alive) {
    positionHeldOrbThirdPerson(opponentOrb, opponent.state.position, opponent.state.yaw);
  } else if (!opponentOrb.state.isHeld) {
    updateOrbFlight(opponentOrb, dt);
  } else {
    opponentOrb.mesh.visible = false;
    opponentOrb.trail.visible = false;
  }

  // Strike stack 3 — energy particles emanating from orbs at max power
  if (!playerOrb.state.isHeld && playerOrb.state.strikeStacks >= 3) {
    if (Math.random() < 0.3) {
      _tmpVec.copy(playerOrb.state.position);
      _tmpVec.x += (Math.random() - 0.5) * 0.5;
      _tmpVec.y += (Math.random() - 0.5) * 0.5;
      _tmpVec.z += (Math.random() - 0.5) * 0.5;
      particles.burst(_tmpVec, 0x88eeff, 1);
    }
  }
  if (!opponentOrb.state.isHeld && opponentOrb.state.strikeStacks >= 3) {
    if (Math.random() < 0.3) {
      _tmpVec.copy(opponentOrb.state.position);
      _tmpVec.x += (Math.random() - 0.5) * 0.5;
      _tmpVec.y += (Math.random() - 0.5) * 0.5;
      _tmpVec.z += (Math.random() - 0.5) * 0.5;
      particles.burst(_tmpVec, 0xff8844, 1);
    }
  }

  // Catch
  handlePlayerCatch(input);

  // Hits
  handleHits();

  // Strike zones
  handleStrikeZones();
  updateStrikeZones(strikeZones, dt);

  // Opponent
  if (gameState.multiplayerActive) {
    if (latestOpponentData) {
      applyNetworkOpponentState(latestOpponentData, dt);
      applyNetworkOpponentOrb(latestOpponentData, dt);
    }
  } else {
    updateOpponent(opponent, playerOrb, opponentOrb, gameState.playerPos, dt, audio, particles);
  }

  // Particles
  updateParticles(particles, dt);

  // Arena
  arena.update(dt);

  // Hit flash decay
  if (gameState.hitFlashTimer > 0) {
    gameState.hitFlashTimer -= dt;
    if (hitFlash) {
      hitFlash.style.opacity = String(Math.max(0, gameState.hitFlashTimer / 0.2) * 0.6);
      if (gameState.hitFlashTimer <= 0) hitFlash.style.opacity = '0';
    }
  }

  // Camera shake decay
  if (gameState.shakeTimer > 0) gameState.shakeTimer -= dt;

  // Parry flash decay
  if (gameState.parryFlashTimer > 0) {
    gameState.parryFlashTimer -= dt;
    if (parryFlash) {
      parryFlash.style.opacity = String(Math.max(0, gameState.parryFlashTimer / 0.1) * 0.15);
      if (gameState.parryFlashTimer <= 0) parryFlash.style.opacity = '0';
    }
  }

  // Dash cooldown ring
  updateDashRing();

  // Clear input
  updateInput();

  // Render
  composer.render();
}

// =============================================
// RESIZE
// =============================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// =============================================
// START
// =============================================
updateHUD();

// =============================================
// SHADER WARMUP — pre-compile all materials to prevent first-use jitter
// =============================================
{
  // Temporarily make hidden objects visible so their shaders compile
  const hiddenMeshes = [];
  scene.traverse((obj) => {
    if (obj.isMesh && !obj.visible) {
      obj.visible = true;
      hiddenMeshes.push(obj);
    }
  });
  renderer.compile(scene, camera);
  composer.render(); // warmup post-processing pipeline (bloom shaders)
  hiddenMeshes.forEach(obj => { obj.visible = false; });
}

// =============================================
// NETWORK UI ELEMENTS
// =============================================
const netStatus = document.getElementById('net-status');
const netIndicator = document.getElementById('net-indicator');
const netText = document.getElementById('net-text');

function updateNetworkUI(status) {
  if (!netStatus) return;
  netStatus.style.display = 'block';
  switch (status) {
    case 'connecting':
      netIndicator.style.background = '#aa8800';
      netText.textContent = 'CONNECTING';
      break;
    case 'queued':
      netIndicator.style.background = '#aa8800';
      netText.textContent = 'IN QUEUE';
      break;
    case 'matched':
      netIndicator.style.background = '#00cc66';
      netText.textContent = 'CONNECTED';
      break;
    case 'disconnected':
      netIndicator.style.background = '#cc3300';
      netText.textContent = 'DISCONNECTED';
      break;
  }
}

// =============================================
// NETWORK CALLBACKS (multiplayer)
// =============================================
if (network) {
  network.callbacks.onConnected = () => {
    updateNetworkUI('queued');
  };

  network.callbacks.onDisconnected = () => {
    updateNetworkUI('disconnected');
    gameState.multiplayerActive = false;
    showOverlay('DISCONNECTED', 'RECONNECTING...');
    // Try to reconnect after 3s
    setTimeout(() => {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = import.meta.env.VITE_WS_URL || `${wsProtocol}//${window.location.host}`;
      network.connect(wsUrl);
    }, 3000);
  };

  network.callbacks.onQueueUpdate = (position, total) => {
    updateNetworkUI('queued');
    if (position === 1 && total === 1) {
      showOverlay('ARC', 'WAITING FOR OPPONENT...');
    } else {
      showOverlay('ARC', `IN QUEUE — POSITION ${position}`);
    }
  };

  network.callbacks.onMatchFound = (slot) => {
    updateNetworkUI('matched');
    gameState.multiplayerActive = true;
    gameState.started = true;
    hideOverlay();
    if (instructions) instructions.style.opacity = '1';
    // Request pointer lock
    renderer.domElement.requestPointerLock({ unadjustedMovement: true }).catch(() => {
      renderer.domElement.requestPointerLock();
    });
  };

  network.callbacks.onCountdown = (timer) => {
    gameState.matchPhase = 'countdown';
    gameState.countdownTimer = timer;
    showOverlay(String(timer), `ROUND ${gameState.round}`);
    audio.play('countdown');
  };

  network.callbacks.onGo = () => {
    showOverlay('GO', '');
    audio.play('go');
    setTimeout(() => {
      gameState.matchPhase = 'playing';
      hideOverlay();
    }, 400);
  };

  network.callbacks.onResume = () => {
    gameState.matchPhase = 'playing';
  };

  network.callbacks.onOpponentState = (mirrored) => {
    latestOpponentData = mirrored;
  };

  network.callbacks.onOpponentEvent = (event) => {
    if (event.name === 'i_got_hit') {
      // Opponent reports being hit — play dissolve on our screen
      dissolveOpponent(opponent, particles, audio);
      startRecall(playerOrb);
      gameState.shakeTimer = 0.15;
    } else if (event.name === 'my_shield_deflected_your_orb') {
      // Our orb was deflected by opponent's shield
      // Event velocity is already mirrored by network.js
      playerOrb.state.velocity.set(event.orbVx, event.orbVy, event.orbVz);
      playerOrb.body.velocity.set(event.orbVx, event.orbVy, event.orbVz);
      playerOrb.state.owner = 'opponent';
      playerOrb.state.lastDeflectedBy = 'opponent';
      audio.play(event.isParry ? 'parry' : 'deflect');
    }
  };

  network.callbacks.onScoreUpdate = (msg) => {
    const mySlot = network.getSlot();
    gameState.playerScore = mySlot === 0 ? msg.p1 : msg.p2;
    gameState.opponentScore = mySlot === 0 ? msg.p2 : msg.p1;
    gameState.playerRounds = mySlot === 0 ? msg.rounds_p1 : msg.rounds_p2;
    gameState.opponentRounds = mySlot === 0 ? msg.rounds_p2 : msg.rounds_p1;
    gameState.round = msg.round;
    updateHUD();

    // Score pop animation
    if (hudScore) {
      hudScore.classList.remove('pop');
      void hudScore.offsetWidth;
      hudScore.classList.add('pop');
    }
  };

  network.callbacks.onRoundEnd = (msg) => {
    const mySlot = network.getSlot();
    const iWon = (msg.winner === 'p1' && mySlot === 0) || (msg.winner === 'p2' && mySlot === 1);
    gameState.playerRounds = mySlot === 0 ? msg.rounds_p1 : msg.rounds_p2;
    gameState.opponentRounds = mySlot === 0 ? msg.rounds_p2 : msg.rounds_p1;
    gameState.matchPhase = 'between-rounds';
    showOverlay(iWon ? 'ROUND WON' : 'ROUND LOST',
      `${gameState.playerScore} - ${gameState.opponentScore}`);
    audio.play(iWon ? 'roundWin' : 'roundLose');
    updateHUD();
  };

  network.callbacks.onMatchEnd = (msg) => {
    const mySlot = network.getSlot();
    const iWon = (msg.winner === 'p1' && mySlot === 0) || (msg.winner === 'p2' && mySlot === 1);
    gameState.playerRounds = mySlot === 0 ? msg.rounds_p1 : msg.rounds_p2;
    gameState.opponentRounds = mySlot === 0 ? msg.rounds_p2 : msg.rounds_p1;
    gameState.matchPhase = 'match-over';
    showOverlay(iWon ? 'YOU WIN' : 'DEFEAT',
      `ROUNDS  ${gameState.playerRounds} - ${gameState.opponentRounds}`);
    audio.play(iWon ? 'roundWin' : 'roundLose');
    updateHUD();
    // After 3s, server handles winner-stays-on
    // The client will receive either 'matched' or 'queued' message
  };

  network.callbacks.onResetPositions = () => {
    resetPositions();
    updateHUD();
  };

  network.callbacks.onOpponentDisconnected = () => {
    gameState.multiplayerActive = false;
    latestOpponentData = null;
    showOverlay('OPPONENT LEFT', 'RETURNING TO QUEUE...');
    // Server will send a 'queued' message shortly
  };
}

// =============================================
// START
// =============================================
gameState.matchPhase = 'title';

if (network) {
  // Multiplayer — connect to server
  showOverlay('ARC', 'CONNECTING...');
  if (instructions) instructions.style.opacity = '0';
  updateNetworkUI('connecting');
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = import.meta.env.VITE_WS_URL || `${wsProtocol}//${window.location.host}`;
  network.connect(wsUrl);
} else {
  // Single player — original flow
  showOverlay('ARC', 'CLICK TO START');
  if (instructions) instructions.style.opacity = '0';

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement && !gameState.started) {
      gameState.started = true;
      if (instructions) instructions.style.opacity = '1';
      startCountdown();
    }
  });
}

gameLoop();
