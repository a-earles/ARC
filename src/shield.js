import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from './config.js';
import { COLLISION_GROUPS } from './physics.js';

// Pre-allocated reusable objects to avoid per-frame GC pressure
const _shieldForward = new THREE.Vector3();
const _shieldEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _shieldPos = new THREE.Vector3();
const _shieldQuat = new THREE.Quaternion();
const _reflectNormal = new THREE.Vector3();
const _reflectVel = new THREE.Vector3();
const _reflectResult = new THREE.Vector3();

export function createShield(scene, physics, team) {
  const isPlayer = team === 'player';
  const color = isPlayer ? 0x00ddff : 0xff4400;
  const emissive = isPlayer ? 0x0066aa : 0xaa2200;

  // Visual — flat plane with subtle curve
  const geo = new THREE.PlaneGeometry(CONFIG.SHIELD_WIDTH, CONFIG.SHIELD_HEIGHT, 4, 4);
  // Bend vertices slightly for a subtle curve
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const bendAmount = 0.15;
    pos.setZ(i, bendAmount * (x * x) / ((CONFIG.SHIELD_WIDTH / 2) ** 2));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: color,
    emissive: emissive,
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    roughness: 0.1,
    metalness: 0.5,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  scene.add(mesh);

  // Edge glow line
  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const edges = new THREE.LineSegments(edgeGeo, edgeMat);
  mesh.add(edges);

  // Physics — kinematic body for collision detection
  const collisionGroup = isPlayer ? COLLISION_GROUPS.PLAYER_SHIELD : COLLISION_GROUPS.OPPONENT_SHIELD;
  const collisionMask = isPlayer ? COLLISION_GROUPS.OPPONENT_ORB : COLLISION_GROUPS.PLAYER_ORB;

  const body = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.KINEMATIC,
    shape: new CANNON.Box(new CANNON.Vec3(CONFIG.SHIELD_WIDTH / 2, CONFIG.SHIELD_HEIGHT / 2, 0.4)),
    collisionFilterGroup: collisionGroup,
    collisionFilterMask: collisionMask,
  });
  physics.world.addBody(body);

  // Reflection event queue — processed by main.js each frame
  const reflections = [];
  body.addEventListener('collide', (event) => {
    reflections.push({
      orbBody: event.body,
      timestamp: performance.now(),
      contact: event.contact,
    });
  });

  const state = {
    active: false,
    raiseTime: 0,   // when shield was first raised (for parry window)
    flashTimer: 0,   // for parry visual feedback
  };

  return { mesh, mat, edges, edgeMat, body, reflections, state, team };
}

// Update shield position and visibility based on holder state
export function updateShield(shield, holderPos, yaw, pitch, isBlocking, isArmed) {
  const { mesh, body, state } = shield;
  const shouldBeActive = isBlocking && isArmed;

  if (shouldBeActive && !state.active) {
    // Just raised the shield — record time for parry window
    state.raiseTime = performance.now();
  }

  state.active = shouldBeActive;
  mesh.visible = shouldBeActive;

  if (shouldBeActive) {
    // Position shield in front of holder (zero allocations)
    _shieldForward.set(0, 0, -1);
    _shieldEuler.set(pitch, yaw, 0);
    _shieldForward.applyEuler(_shieldEuler);

    _shieldPos.copy(holderPos).addScaledVector(_shieldForward, CONFIG.SHIELD_OFFSET);
    mesh.position.copy(_shieldPos);
    mesh.rotation.set(pitch, yaw, 0, 'YXZ');

    // Sync physics body
    body.position.set(_shieldPos.x, _shieldPos.y, _shieldPos.z);
    _shieldEuler.set(pitch, yaw, 0);
    _shieldQuat.setFromEuler(_shieldEuler);
    body.quaternion.set(_shieldQuat.x, _shieldQuat.y, _shieldQuat.z, _shieldQuat.w);

    // Flash feedback from parry
    if (state.flashTimer > 0) {
      state.flashTimer -= 1 / 60; // approximate
      shield.mat.emissiveIntensity = 0.8;
      shield.mat.opacity = 0.35;
    } else {
      shield.mat.emissiveIntensity = 0.4;
      shield.mat.opacity = 0.15;
    }
  } else {
    // Move physics body far away when inactive
    body.position.set(0, -100, 0);
  }
}

// Process shield reflection — returns reflection data or null
// aimDirection: optional Vector3 — if provided, orb redirects toward aim (player shield)
//               if null/undefined, uses standard physics reflection (opponent shield)
export function processReflection(shield, orbState, orbBody, aimDirection) {
  if (shield.reflections.length === 0) return null;

  // Take the first reflection event
  const event = shield.reflections.shift();

  // Check if this collision is for the orb we're tracking
  if (event.orbBody !== orbBody) {
    return null;
  }

  // Current velocity
  _reflectVel.set(orbBody.velocity.x, orbBody.velocity.y, orbBody.velocity.z);
  const speed = _reflectVel.length();

  // Is this a perfect parry?
  const timeSinceRaise = event.timestamp - shield.state.raiseTime;
  const isParry = timeSinceRaise <= CONFIG.PARRY_WINDOW_MS;
  const mult = isParry ? CONFIG.PARRY_SPEED_MULT : CONFIG.REFLECT_SPEED_MULT;

  if (aimDirection) {
    // Player shield: redirect toward crosshair aim direction
    _reflectResult.copy(aimDirection).normalize().multiplyScalar(speed * mult);
  } else {
    // Opponent shield: standard physics reflection v' = v - 2(v·n)n
    const yaw = shield.mesh.rotation.y;
    const pitch = shield.mesh.rotation.x;
    _reflectNormal.set(0, 0, -1);
    _shieldEuler.set(pitch, yaw, 0);
    _reflectNormal.applyEuler(_shieldEuler);

    const dot = _reflectVel.dot(_reflectNormal);
    _reflectResult.copy(_reflectNormal).multiplyScalar(-2 * dot).add(_reflectVel);
    _reflectResult.normalize().multiplyScalar(speed * mult);
  }

  // Set orb velocity
  orbBody.velocity.set(_reflectResult.x, _reflectResult.y, _reflectResult.z);
  orbState.velocity.set(_reflectResult.x, _reflectResult.y, _reflectResult.z);

  // Visual feedback
  if (isParry) {
    shield.state.flashTimer = 0.3;
  }

  return { isParry, speed: speed * mult };
}
