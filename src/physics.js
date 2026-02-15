import * as CANNON from 'cannon-es';
import { CONFIG } from './config.js';

// Pre-allocated for bounce detection callback
const _bounceCpw = new CANNON.Vec3();

// --- Collision group bitmasks ---
export const COLLISION_GROUPS = {
  WALLS:           1,
  PLAYER_ORB:      2,
  OPPONENT_ORB:    4,
  PLAYER_BODY:     8,
  OPPONENT_BODY:   16,
  PLAYER_SHIELD:   32,
  OPPONENT_SHIELD: 64,
};

// Re-export for backward compat
export const ARENA_DIMS = {
  length: CONFIG.ARENA_LENGTH,
  width:  CONFIG.ARENA_WIDTH,
  height: CONFIG.ARENA_HEIGHT,
};

export function createPhysicsWorld() {
  const world = new CANNON.World();
  world.gravity.set(0, -CONFIG.GRAVITY, 0);
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 10;

  // Materials
  const wallMat = new CANNON.Material('wall');
  const discMat = new CANNON.Material('disc');
  const contact = new CANNON.ContactMaterial(wallMat, discMat, {
    restitution: CONFIG.RESTITUTION,
    friction: CONFIG.FRICTION,
  });
  world.addContactMaterial(contact);

  const { ARENA_LENGTH: length, ARENA_WIDTH: width, ARENA_HEIGHT: height, WALL_THICKNESS: wt } = CONFIG;

  // Floor
  const floor = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(width / 2 + wt, wt / 2, length / 2 + wt)),
    position: new CANNON.Vec3(0, -wt / 2, 0),
    material: wallMat,
  });
  world.addBody(floor);

  // Ceiling
  const ceiling = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(width / 2 + wt, wt / 2, length / 2 + wt)),
    position: new CANNON.Vec3(0, height + wt / 2, 0),
    material: wallMat,
  });
  world.addBody(ceiling);

  // Left wall
  const leftWall = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(wt / 2, height / 2 + wt, length / 2 + wt)),
    position: new CANNON.Vec3(-width / 2 - wt / 2, height / 2, 0),
    material: wallMat,
  });
  world.addBody(leftWall);

  // Right wall
  const rightWall = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(wt / 2, height / 2 + wt, length / 2 + wt)),
    position: new CANNON.Vec3(width / 2 + wt / 2, height / 2, 0),
    material: wallMat,
  });
  world.addBody(rightWall);

  // Back wall (opponent end, -Z)
  const backWall = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(width / 2 + wt, height / 2 + wt, wt / 2)),
    position: new CANNON.Vec3(0, height / 2, -length / 2 - wt / 2),
    material: wallMat,
  });
  world.addBody(backWall);

  // Front wall (player end, +Z)
  const frontWall = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(width / 2 + wt, height / 2 + wt, wt / 2)),
    position: new CANNON.Vec3(0, height / 2, length / 2 + wt / 2),
    material: wallMat,
  });
  world.addBody(frontWall);

  const walls = [floor, ceiling, leftWall, rightWall, backWall, frontWall];

  const bounceQueue = [];

  return { world, wallMat, discMat, walls, bounceQueue, _lastBounceTime: {} };
}

export function setupBounceDetection(physics, orbBody) {
  const { walls, bounceQueue } = physics;
  const wallSet = new Set(walls);
  const bodyId = orbBody.id;

  if (!physics._lastBounceTime[bodyId]) {
    physics._lastBounceTime[bodyId] = 0;
  }

  orbBody.addEventListener('collide', (event) => {
    const other = event.body;
    if (!wallSet.has(other)) return;

    const now = performance.now();
    if (now - physics._lastBounceTime[bodyId] < 80) return;
    physics._lastBounceTime[bodyId] = now;

    const contact = event.contact;
    if (contact.bi === orbBody) {
      _bounceCpw.copy(contact.ri).vadd(contact.bi.position, _bounceCpw);
    } else {
      _bounceCpw.copy(contact.rj).vadd(contact.bj.position, _bounceCpw);
    }

    const normal = contact.ni;
    const sign = contact.bi === orbBody ? 1 : -1;

    bounceQueue.push({
      pos: { x: _bounceCpw.x, y: _bounceCpw.y, z: _bounceCpw.z },
      normal: { x: normal.x * sign, y: normal.y * sign, z: normal.z * sign },
      bodyId: bodyId,
    });
  });
}

// Step the physics world once per frame with sub-stepping for fast orbs
export function stepPhysics(physics, maxSpeed, dt) {
  const { world } = physics;
  const subSteps = maxSpeed > 30 ? 3 : maxSpeed > 15 ? 2 : 1;
  const subDt = dt / subSteps;
  for (let i = 0; i < subSteps; i++) {
    world.step(subDt);
  }
}

// Sync an orb's state from its physics body + clamp + process bounces
export function syncOrbPhysics(physics, orb, onBounce) {
  if (orb.state.isHeld) return;

  const { bounceQueue } = physics;
  const { ARENA_LENGTH: length, ARENA_WIDTH: width, ARENA_HEIGHT: height } = CONFIG;

  const bp = orb.body.position;
  const bv = orb.body.velocity;

  // Hard clamp position inside arena bounds
  const margin = 0.3;
  bp.x = Math.max(-width / 2 + margin, Math.min(width / 2 - margin, bp.x));
  bp.y = Math.max(margin, Math.min(height - margin, bp.y));
  bp.z = Math.max(-length / 2 + margin, Math.min(length / 2 - margin, bp.z));

  orb.state.position.set(bp.x, bp.y, bp.z);
  orb.state.velocity.set(bv.x, bv.y, bv.z);

  // Minimal air drag
  orb.body.velocity.scale(CONFIG.AIR_DRAG, orb.body.velocity);

  // Process bounce events for this orb's body (swap-and-pop instead of splice)
  const bodyId = orb.body.id;
  let bqLen = bounceQueue.length;
  for (let i = bqLen - 1; i >= 0; i--) {
    const bounce = bounceQueue[i];
    if (bounce.bodyId === bodyId) {
      if (orb.state.velocity.length() > 2) {
        onBounce(bounce.pos, bounce.normal);
      }
      // Swap with last element and pop
      bqLen--;
      if (i < bqLen) bounceQueue[i] = bounceQueue[bqLen];
      bounceQueue.length = bqLen;
    }
  }
}

// Legacy aliases
export const syncDiscPhysics = syncOrbPhysics;

export function updatePhysics(physics, disc, dt, onBounce) {
  if (disc.state.isHeld) return;
  stepPhysics(physics, disc.state.velocity.length(), dt);
  syncOrbPhysics(physics, disc, onBounce);
}
