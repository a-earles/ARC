import * as THREE from 'three';
import { CONFIG } from './config.js';

const OPPONENT_HEIGHT = CONFIG.PLAYER_EYE_HEIGHT;
const HALF_ARENA = CONFIG.ARENA_LENGTH / 2;
const HALF_WIDTH = CONFIG.ARENA_WIDTH / 2;

// Movement bounds (mirror of player bounds on -Z side)
const OPP_BOUNDS_X_MIN = -HALF_WIDTH + 0.5;
const OPP_BOUNDS_X_MAX = HALF_WIDTH - 0.5;
const OPP_BOUNDS_Z_MIN = -HALF_ARENA + 1;
const OPP_BOUNDS_Z_MAX = -HALF_ARENA + CONFIG.PLAYER_BOUNDS_DEPTH;

const OPP_MOVE_SPEED = 5.0;
const OPP_DASH_SPEED = 20.0;
const OPP_DASH_DURATION = 0.15;

// Pre-allocated reusable objects
const _oppTmpVec = new THREE.Vector3();
const _oppTmpVec2 = new THREE.Vector3();
const _oppTmpDir = new THREE.Vector3();

// Tuning — single difficulty that plays like a real opponent
const AIM_NOISE_DEG = 5;
const THROW_INTERVAL_MIN = 1.5;
const THROW_INTERVAL_MAX = 3.5;
const BANK_SHOT_CHANCE = 0.3;
const STRIKE_SHOT_CHANCE = 0.15;
const DASH_CHANCE_PER_FRAME = 0.06;

// Shield AI tuning
const BLOCK_CHANCE = 0.55;          // chance to decide to block vs dodge when threat detected
const BLOCK_REACTION_MIN = 0.15;    // minimum reaction delay (seconds)
const BLOCK_REACTION_MAX = 0.4;     // maximum reaction delay
const BLOCK_HOLD_MIN = 0.3;         // minimum time to hold shield up
const BLOCK_HOLD_MAX = 0.8;         // maximum time to hold shield up
const BLOCK_MISS_CHANCE = 0.2;      // chance to "miss" and not block at all

export function createOpponent(scene) {
  const spawnPos = new THREE.Vector3(0, OPPONENT_HEIGHT, -HALF_ARENA + 3);

  const state = {
    position: spawnPos.clone(),
    alive: true,
    dissolving: false,
    dissolveTimer: 0,
    respawnTimer: 0,
    armed: true,
    yaw: 0,

    // Simple throw timer — counts UP, throws when it exceeds threshold
    throwTimer: 0,
    throwInterval: randomThrowInterval(),

    // Movement
    moveTarget: new THREE.Vector3(0, OPPONENT_HEIGHT, -HALF_ARENA + 3),

    // Incoming threat tracking
    threatDetected: false,
    threatPosition: new THREE.Vector3(),
    dodgeDir: 0,

    // Dash
    dashCooldown: 0,
    dashTimer: 0,
    dashActive: false,
    dashVelocity: new THREE.Vector3(),

    // Shield / blocking
    blocking: false,
    blockReactionTimer: 0,   // delay before raising shield
    blockDuration: 0,        // how long to hold shield up
  };

  // --- Visual body ---
  const bodyGroup = new THREE.Group();

  const torsoGeo = new THREE.CylinderGeometry(0.25, 0.3, 1.0, 8);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xff3300,
    emissive: 0x661100,
    emissiveIntensity: 0.3,
    roughness: 0.4,
    metalness: 0.7,
  });
  const torso = new THREE.Mesh(torsoGeo, bodyMat);
  bodyGroup.add(torso);

  const headGeo = new THREE.SphereGeometry(0.18, 8, 8);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xff4400,
    emissive: 0x882200,
    emissiveIntensity: 0.4,
    roughness: 0.3,
    metalness: 0.8,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 0.65;
  bodyGroup.add(head);

  const visorGeo = new THREE.BoxGeometry(0.25, 0.04, 0.1);
  const visorMat = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    transparent: true,
    opacity: 0.9,
  });
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, 0.67, 0.12);
  bodyGroup.add(visor);

  const glowLight = new THREE.PointLight(0xff4400, 0.5, 6);
  glowLight.position.y = 0.3;
  bodyGroup.add(glowLight);

  bodyGroup.position.copy(spawnPos);
  bodyGroup.position.y -= OPPONENT_HEIGHT - 0.5;
  scene.add(bodyGroup);

  return {
    state, bodyGroup, bodyMat, headMat, visorMat, glowLight, scene,
  };
}

function randomThrowInterval() {
  return THROW_INTERVAL_MIN + Math.random() * (THROW_INTERVAL_MAX - THROW_INTERVAL_MIN);
}

// =============================================
// MAIN UPDATE
// =============================================
export function updateOpponent(opponent, playerOrb, oppOrb, playerPos, dt, audio, particles) {
  const { state, bodyGroup, glowLight } = opponent;

  // --- Dissolve animation ---
  if (state.dissolving) {
    state.dissolveTimer += dt;
    const progress = Math.min(state.dissolveTimer / CONFIG.DISSOLVE_DURATION, 1);
    const scale = Math.max(0, 1 - progress);
    bodyGroup.scale.set(scale, scale, scale);
    glowLight.intensity = 0.5 * scale;

    if (progress >= 1) {
      state.dissolving = false;
      state.alive = false;
      bodyGroup.visible = false;
      state.respawnTimer = 0;
    }
    return;
  }

  // --- Respawn ---
  if (!state.alive) {
    state.respawnTimer += dt;
    if (state.respawnTimer >= CONFIG.RESPAWN_DELAY) {
      respawnOpponent(opponent, oppOrb);
    }
    return;
  }

  // --- Tick dash cooldown ---
  if (state.dashCooldown > 0) {
    state.dashCooldown -= dt;
    if (state.dashCooldown < 0) state.dashCooldown = 0;
  }

  // --- Dash movement (overrides normal movement) ---
  if (state.dashActive) {
    state.dashTimer -= dt;
    state.position.addScaledVector(state.dashVelocity, dt);
    clampPosition(state);
    if (state.dashTimer <= 0) {
      state.dashActive = false;
    }
    updateVisualPosition(state, bodyGroup);
    // Don't return — still process throwing during dash
  }

  // --- Face toward player (smooth rotation for human-like feel) ---
  const targetYaw = Math.atan2(playerPos.x - state.position.x, playerPos.z - state.position.z);
  let yawDiff = targetYaw - state.yaw;
  // Normalize to [-PI, PI]
  while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
  while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
  state.yaw += yawDiff * Math.min(1, 8 * dt); // smooth turn at ~8 rad/s

  // --- Threat detection + dodge ---
  if (!state.dashActive) {
    detectThreat(state, playerOrb);
    decideMoveTarget(state, oppOrb, playerPos);
    moveTowardTarget(state, dt);

    if (state.threatDetected && state.dodgeDir !== 0) {
      maybeAIDash(state, audio);
    }
  }

  // --- Shield / blocking AI ---
  updateBlocking(state, playerOrb, dt);

  // --- THROW (simple count-up timer) ---
  if (state.armed && oppOrb.state.isHeld) {
    state.throwTimer += dt;
    if (state.throwTimer >= state.throwInterval) {
      doThrow(state, oppOrb, playerPos, audio);
    }
  }

  // --- CATCH own orb (with grace period so it doesn't catch on throw frame) ---
  if (!state.armed && !oppOrb.state.isHeld) {
    const timeSinceThrow = performance.now() - oppOrb.state.throwTime;
    if (timeSinceThrow > CONFIG.CATCH_GRACE_PERIOD_MS) {
      const distToOrb = state.position.distanceTo(oppOrb.state.position);
      if (distToOrb < CONFIG.OPP_CATCH_RADIUS) {
        doCatch(state, oppOrb);
      }
    }
  }

  if (!state.dashActive) {
    updateVisualPosition(state, bodyGroup);
  }
}

// =============================================
// THROW
// =============================================
function doThrow(state, oppOrb, playerPos, audio) {
  state.throwTimer = 0;
  state.throwInterval = randomThrowInterval();
  state.armed = false;

  // Pick throw type
  const roll = Math.random();
  let dir;
  if (roll < BANK_SHOT_CHANCE) {
    dir = aimBankShot(state, playerPos);
  } else if (roll < BANK_SHOT_CHANCE + STRIKE_SHOT_CHANCE) {
    dir = aimStrikeShot(state);
  } else {
    dir = aimDirect(state, playerPos);
  }

  const speed = CONFIG.THROW_SPEED * (1 + oppOrb.state.strikeStacks * CONFIG.STRIKE_SPEED_SCALE);

  // Spawn orb in front of opponent
  _oppTmpVec.copy(state.position).addScaledVector(dir, 1.5);
  _oppTmpVec.y -= 0.2;

  oppOrb.state.isHeld = false;
  oppOrb.state.position.copy(_oppTmpVec);
  oppOrb.state.velocity.copy(dir).multiplyScalar(speed);
  oppOrb.state.throwTime = performance.now();
  oppOrb.state.recalling = false;
  oppOrb.state.stallTimer = 0;
  oppOrb.state.returning = false;
  oppOrb.state.returnTimer = 0;
  oppOrb.state.owner = 'opponent';

  oppOrb.body.linearDamping = 0.01;
  oppOrb.body.position.set(_oppTmpVec.x, _oppTmpVec.y, _oppTmpVec.z);
  oppOrb.body.velocity.set(
    oppOrb.state.velocity.x,
    oppOrb.state.velocity.y,
    oppOrb.state.velocity.z
  );
  oppOrb.body.angularVelocity.set(0, speed * 0.5, 0);

  audio.play('throw');
}

function aimDirect(state, playerPos) {
  const noiseRad = AIM_NOISE_DEG * Math.PI / 180;
  _oppTmpDir.subVectors(playerPos, state.position).normalize();
  _oppTmpDir.x += (Math.random() - 0.5) * noiseRad;
  _oppTmpDir.y += (Math.random() - 0.5) * noiseRad * 0.5;
  return _oppTmpDir.normalize();
}

function aimBankShot(state, playerPos) {
  const noiseRad = AIM_NOISE_DEG * Math.PI / 180;
  const wallSide = Math.random() > 0.5 ? 1 : -1;
  const wallX = wallSide * HALF_WIDTH;
  const mirroredX = 2 * wallX - playerPos.x;
  _oppTmpVec2.set(mirroredX, playerPos.y, playerPos.z);
  _oppTmpDir.subVectors(_oppTmpVec2, state.position).normalize();
  _oppTmpDir.x += (Math.random() - 0.5) * noiseRad * 1.2;
  _oppTmpDir.y += (Math.random() - 0.5) * noiseRad * 0.3;
  return _oppTmpDir.normalize();
}

function aimStrikeShot(state) {
  const noiseRad = AIM_NOISE_DEG * Math.PI / 180;
  _oppTmpVec2.set(0, CONFIG.STRIKE_ZONE_CENTER_Y, HALF_ARENA);
  _oppTmpDir.subVectors(_oppTmpVec2, state.position).normalize();
  _oppTmpDir.x += (Math.random() - 0.5) * noiseRad * 0.8;
  _oppTmpDir.y += (Math.random() - 0.5) * noiseRad * 0.4;
  return _oppTmpDir.normalize();
}

// =============================================
// CATCH
// =============================================
function doCatch(state, oppOrb) {
  state.armed = true;
  state.throwTimer = 0;
  state.throwInterval = randomThrowInterval();

  oppOrb.state.isHeld = true;
  oppOrb.state.velocity.set(0, 0, 0);
  oppOrb.state.recalling = false;
  oppOrb.state.stallTimer = 0;

  oppOrb.body.velocity.set(0, 0, 0);
  oppOrb.body.angularVelocity.set(0, 0, 0);
  oppOrb.body.linearDamping = 0.01;
}

// =============================================
// THREAT DETECTION
// =============================================
function detectThreat(state, playerOrb) {
  state.threatDetected = false;
  state.dodgeDir = 0;

  const orbState = playerOrb.state;
  if (orbState.isHeld || orbState.recalling) return;

  const speed = orbState.velocity.length();
  if (speed < 5) return;

  // Is the orb moving toward opponent's half?
  if (orbState.velocity.z > -2) return;

  // Predict where it'll be at opponent's Z
  const dz = state.position.z - orbState.position.z;
  if (dz > 0) return;
  const timeToArrive = Math.abs(dz / orbState.velocity.z);
  if (timeToArrive > 2.0) return;

  const predictedX = orbState.position.x + orbState.velocity.x * timeToArrive;

  state.threatDetected = true;
  state.threatPosition.set(predictedX, orbState.position.y, state.position.z);

  const distToImpact = Math.abs(state.position.x - predictedX);
  if (distToImpact < 3.0) {
    state.dodgeDir = predictedX > state.position.x ? -1 : 1;
  }
}

// =============================================
// MOVEMENT
// =============================================
function decideMoveTarget(state, oppOrb, playerPos) {
  const target = state.moveTarget;

  if (state.threatDetected && state.dodgeDir !== 0) {
    // Dodge laterally
    target.x = state.position.x + state.dodgeDir * 3.0;
    target.z = state.position.z;
  } else if (!state.armed && !oppOrb.state.isHeld) {
    // Move toward own orb to catch it
    target.x = oppOrb.state.position.x;
    target.z = THREE.MathUtils.clamp(
      oppOrb.state.position.z,
      OPP_BOUNDS_Z_MIN,
      OPP_BOUNDS_Z_MAX
    );
  } else {
    // Idle armed — loosely track player X with some drift
    target.x = playerPos.x * 0.3 + Math.sin(performance.now() * 0.0008) * 1.5;
    target.z = -HALF_ARENA + 3;
  }

  target.x = THREE.MathUtils.clamp(target.x, OPP_BOUNDS_X_MIN, OPP_BOUNDS_X_MAX);
  target.z = THREE.MathUtils.clamp(target.z, OPP_BOUNDS_Z_MIN, OPP_BOUNDS_Z_MAX);
}

function moveTowardTarget(state, dt) {
  const dx = state.moveTarget.x - state.position.x;
  const dz = state.moveTarget.z - state.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 0.1) return;

  const speed = state.threatDetected ? OPP_MOVE_SPEED * 1.5 : OPP_MOVE_SPEED;
  const step = Math.min(speed * dt, dist);

  state.position.x += (dx / dist) * step;
  state.position.z += (dz / dist) * step;
  clampPosition(state);
}

function clampPosition(state) {
  state.position.x = THREE.MathUtils.clamp(state.position.x, OPP_BOUNDS_X_MIN, OPP_BOUNDS_X_MAX);
  state.position.z = THREE.MathUtils.clamp(state.position.z, OPP_BOUNDS_Z_MIN, OPP_BOUNDS_Z_MAX);
}

function updateVisualPosition(state, bodyGroup) {
  bodyGroup.position.set(state.position.x, state.position.y - OPPONENT_HEIGHT + 0.5, state.position.z);
  bodyGroup.rotation.y = state.yaw;
  // Lean forward slightly when moving for natural feel
  const moveSpeed = state.dashActive ? 1.0 : 0;
  bodyGroup.rotation.x = moveSpeed * 0.08;
}

// =============================================
// AI DASH
// =============================================
function maybeAIDash(state, audio) {
  if (state.dashCooldown > 0) return;
  if (state.dashActive) return;
  if (Math.random() > DASH_CHANCE_PER_FRAME) return;

  _oppTmpVec.set(state.dodgeDir, 0, 0).normalize();
  state.dashActive = true;
  state.dashTimer = OPP_DASH_DURATION;
  state.dashVelocity.copy(_oppTmpVec).multiplyScalar(OPP_DASH_SPEED);
  state.dashCooldown = CONFIG.DASH_COOLDOWN_S;
  audio.play('dash');
}

// =============================================
// SHIELD / BLOCKING AI
// =============================================
function updateBlocking(state, playerOrb, dt) {
  // Can only block when armed (holding own orb)
  if (!state.armed) {
    state.blocking = false;
    state.blockReactionTimer = 0;
    state.blockDuration = 0;
    return;
  }

  // If currently blocking, count down duration
  if (state.blocking) {
    state.blockDuration -= dt;
    if (state.blockDuration <= 0) {
      state.blocking = false;
    }
    return;
  }

  // Check if player orb is incoming
  const orbState = playerOrb.state;
  if (orbState.isHeld || orbState.recalling) {
    state.blockReactionTimer = 0;
    return;
  }

  const speed = orbState.velocity.length();
  if (speed < 5) return;

  // Is the orb moving toward opponent?
  if (orbState.velocity.z > -2) return;

  const dz = state.position.z - orbState.position.z;
  if (dz > 0) return;
  const timeToArrive = Math.abs(dz / orbState.velocity.z);

  // Only react when orb is getting close (within ~1 second)
  if (timeToArrive > 1.0) {
    state.blockReactionTimer = 0;
    return;
  }

  // Predict lateral position
  const predictedX = orbState.position.x + orbState.velocity.x * timeToArrive;
  const lateralDist = Math.abs(state.position.x - predictedX);

  // Only try to block if the orb is roughly coming at us
  if (lateralDist > 2.5) return;

  // Start reaction timer if not already started
  if (state.blockReactionTimer <= 0) {
    // Decide whether to block or just dodge
    if (Math.random() < BLOCK_MISS_CHANCE) return; // sometimes just don't react
    if (Math.random() > BLOCK_CHANCE) return;       // sometimes choose dodge instead

    state.blockReactionTimer = BLOCK_REACTION_MIN + Math.random() * (BLOCK_REACTION_MAX - BLOCK_REACTION_MIN);
  }

  // Count down reaction time
  state.blockReactionTimer -= dt;
  if (state.blockReactionTimer <= 0) {
    state.blocking = true;
    state.blockDuration = BLOCK_HOLD_MIN + Math.random() * (BLOCK_HOLD_MAX - BLOCK_HOLD_MIN);
    state.blockReactionTimer = 0;
  }
}

// =============================================
// DISSOLVE / RESPAWN
// =============================================
export function dissolveOpponent(opponent, particles, audio) {
  const { state, bodyGroup } = opponent;
  if (!state.alive || state.dissolving) return;

  state.dissolving = true;
  state.dissolveTimer = 0;

  _oppTmpVec.set(bodyGroup.position.x, bodyGroup.position.y + 0.5, bodyGroup.position.z);

  // Reduced burst counts for performance
  for (let i = 0; i < 3; i++) {
    _oppTmpVec2.set(
      _oppTmpVec.x + (Math.random() - 0.5) * 0.6,
      _oppTmpVec.y + Math.random() * 1.2,
      _oppTmpVec.z + (Math.random() - 0.5) * 0.4
    );
    particles.burst(_oppTmpVec2, 0xff4400, 15);
  }
  particles.burst(_oppTmpVec, 0xff8800, 12);
  _oppTmpVec2.set(_oppTmpVec.x, _oppTmpVec.y + 0.8, _oppTmpVec.z);
  particles.burst(_oppTmpVec2, 0xff2200, 8);

  audio.play('score');
}

function respawnOpponent(opponent, oppOrb) {
  const { state, bodyGroup, glowLight } = opponent;
  _oppTmpVec.set(0, OPPONENT_HEIGHT, -HALF_ARENA + 3);

  state.alive = true;
  state.dissolving = false;
  state.dissolveTimer = 0;
  state.respawnTimer = 0;
  state.position.copy(_oppTmpVec);
  state.armed = true;
  state.throwTimer = 0;
  state.throwInterval = randomThrowInterval();
  state.moveTarget.copy(_oppTmpVec);
  state.threatDetected = false;
  state.dodgeDir = 0;
  state.dashActive = false;
  state.dashCooldown = 0;
  state.blocking = false;
  state.blockReactionTimer = 0;
  state.blockDuration = 0;

  bodyGroup.visible = true;
  bodyGroup.scale.set(1, 1, 1);
  glowLight.intensity = 0.5;

  if (oppOrb) {
    oppOrb.state.isHeld = true;
    oppOrb.state.velocity.set(0, 0, 0);
    oppOrb.state.position.copy(_oppTmpVec);
    oppOrb.state.recalling = false;
    oppOrb.state.stallTimer = 0;
    oppOrb.state.returning = false;
    oppOrb.state.returnTimer = 0;
    oppOrb.state.owner = 'opponent';
    oppOrb.state.lastDeflectedBy = null;
    oppOrb.body.velocity.set(0, 0, 0);
    oppOrb.body.angularVelocity.set(0, 0, 0);
    oppOrb.body.linearDamping = 0.01;
  }
}
