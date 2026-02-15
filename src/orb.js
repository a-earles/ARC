import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from './config.js';
import { COLLISION_GROUPS } from './physics.js';

const TRAIL_LENGTH = 30;

// Pre-allocated reusable objects to avoid per-frame GC pressure
const _heldOffset = new THREE.Vector3();
const _heldEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _thirdPersonOffset = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

const TEAM_COLORS = {
  player: {
    primary: 0x00ddff,
    emissive: 0x0088aa,
    trail: 0x00bbff,
  },
  opponent: {
    primary: 0xff4400,
    emissive: 0xaa2200,
    trail: 0xff4400,
  },
};

export function createOrb(scene, physics, team) {
  const colors = TEAM_COLORS[team];
  const isPlayer = team === 'player';

  const state = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    isHeld: true,
    bounceCount: 0,
    owner: team,
    lastDeflectedBy: null,
    strikeStacks: 0,
    throwTime: 0,
    recalling: false,
    stallTimer: 0,
    returning: false,
    returnTimer: 0,
    curveAccel: new THREE.Vector3(),
    curveTimer: 0,
  };

  // Physics body with collision groups
  const collisionGroup = isPlayer ? COLLISION_GROUPS.PLAYER_ORB : COLLISION_GROUPS.OPPONENT_ORB;
  const collisionMask = isPlayer
    ? (COLLISION_GROUPS.WALLS | COLLISION_GROUPS.OPPONENT_SHIELD)
    : (COLLISION_GROUPS.WALLS | COLLISION_GROUPS.PLAYER_SHIELD);

  const body = new CANNON.Body({
    mass: 0.5,
    shape: new CANNON.Sphere(CONFIG.ORB_RADIUS),
    material: physics.discMat,
    linearDamping: 0.01,
    angularDamping: 0.1,
    collisionFilterGroup: collisionGroup,
    collisionFilterMask: collisionMask,
  });
  const spawnZ = isPlayer ? (CONFIG.ARENA_LENGTH / 2 - 2) : (-CONFIG.ARENA_LENGTH / 2 + 3);
  body.position.set(0, CONFIG.PLAYER_EYE_HEIGHT, spawnZ);
  physics.world.addBody(body);

  // Sphere mesh
  const sphereGeo = new THREE.SphereGeometry(CONFIG.ORB_RADIUS, 24, 16);
  const sphereMat = new THREE.MeshStandardMaterial({
    color: colors.primary,
    emissive: colors.emissive,
    emissiveIntensity: 0.3,
    roughness: 0.3,
    metalness: 0.7,
  });
  const mesh = new THREE.Mesh(sphereGeo, sphereMat);
  scene.add(mesh);

  // Glow light
  const orbLight = new THREE.PointLight(colors.primary, 0.4, 5);
  mesh.add(orbLight);

  // Energy aura — wireframe shell visible at max strike stacks
  const auraGeo = new THREE.IcosahedronGeometry(CONFIG.ORB_RADIUS * 2.5, 1);
  const auraMat = new THREE.MeshBasicMaterial({
    color: colors.primary,
    transparent: true,
    opacity: 0,
    wireframe: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const aura = new THREE.Mesh(auraGeo, auraMat);
  aura.visible = false;
  mesh.add(aura);

  // Trail with vertex colour fading
  const trailPositions = new Float32Array(TRAIL_LENGTH * 3);
  const trailColorArr = new Float32Array(TRAIL_LENGTH * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColorArr, 3));

  const trailMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const trail = new THREE.Line(trailGeo, trailMat);
  scene.add(trail);

  const trailPoints = [];

  return {
    state, body, mesh, sphereMat, orbLight, aura, auraMat,
    trail, trailGeo, trailPoints, trailPositions, trailColorArr,
    team, colors,
  };
}

// Position the orb in the player's hand (first-person held view)
export function positionHeldOrbFirstPerson(orb, playerPos, cameraYaw, cameraPitch, blocking) {
  const { mesh, sphereMat, orbLight, state, colors } = orb;

  if (blocking) {
    // Shield up — hide orb so player has clear view through the shield
    mesh.visible = false;
    orbLight.intensity = 0;
    orb.trailPoints.length = 0;
    orb.trail.visible = false;
    return;
  }

  // Normal held — lower right of view
  _heldOffset.set(0.25, -0.35, -0.5);
  _heldEuler.set(cameraPitch * 0.2, cameraYaw, 0);
  _heldOffset.applyEuler(_heldEuler);
  mesh.position.copy(playerPos).add(_heldOffset);
  mesh.position.y += Math.sin(performance.now() * 0.003) * 0.01;

  // Held orb stays base size — no strike scaling in first-person (too close to camera)
  mesh.scale.setScalar(1);
  mesh.visible = true;

  // Always hide aura when held — it's way too large at close range
  if (orb.aura) orb.aura.visible = false;

  // Subtle strike stack glow when held (emissive only, no size change)
  const stacks = state.strikeStacks;
  if (stacks > 0) {
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now * (0.003 + stacks * 0.001));
    sphereMat.emissiveIntensity = 0.2 + stacks * 0.15 * pulse;
    orbLight.intensity = 0.15 + stacks * 0.08 * pulse;
    // Gentle color shift
    if (orb.team === 'player') {
      const s = stacks / 3;
      sphereMat.emissive.setRGB(s * 0.2, 0.53 + s * 0.2, 0.67 + s * 0.2);
    } else {
      const s = stacks / 3;
      sphereMat.emissive.setRGB(0.67 + s * 0.2, 0.13 + s * 0.2, s * 0.1);
    }
  } else {
    orbLight.intensity = 0.15;
    sphereMat.emissiveIntensity = 0.2;
    sphereMat.emissive.setHex(colors.emissive);
  }

  orb.trailPoints.length = 0;
  orb.trail.visible = false;
}

// Position the orb at the opponent's hand (third-person)
export function positionHeldOrbThirdPerson(orb, holderPos, holderYaw) {
  const { mesh, sphereMat, orbLight, state } = orb;
  const strikeScale = 1 + state.strikeStacks * CONFIG.STRIKE_RADIUS_SCALE;

  // Offset to the opponent's right hand
  _thirdPersonOffset.set(0.35, 0, -0.3);
  _thirdPersonOffset.applyAxisAngle(_yAxis, holderYaw);
  mesh.position.copy(holderPos).add(_thirdPersonOffset);
  mesh.scale.setScalar(strikeScale);
  mesh.visible = true;
  orbLight.intensity = 0.2;
  sphereMat.emissiveIntensity = 0.3;

  orb.trailPoints.length = 0;
  orb.trail.visible = false;
}

// Update orb visuals when in flight
export function updateOrbFlight(orb, dt) {
  const { state, mesh, sphereMat, orbLight, trail, trailGeo, trailPoints, trailPositions, trailColorArr, colors } = orb;

  if (state.isHeld) return;

  const strikeScale = 1 + state.strikeStacks * CONFIG.STRIKE_RADIUS_SCALE;
  mesh.position.copy(state.position);
  mesh.scale.setScalar(strikeScale);
  mesh.visible = true;

  const speed = state.velocity.length();

  // Glow scales with speed
  const t = THREE.MathUtils.clamp(speed / 40, 0, 1);
  orbLight.intensity = 0.3 + t * 0.8;
  sphereMat.emissiveIntensity = 0.3 + t * 0.6;

  // Strike stack visual feedback — progressive energy buildup
  if (state.strikeStacks > 0) {
    const stacks = state.strikeStacks;
    const now = performance.now();

    if (stacks === 1) {
      // Stack 1: Gentle glow — soft, slow pulse
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
      sphereMat.emissiveIntensity = 0.3 + 0.3 * pulse;
      orbLight.intensity = 0.5 + 0.3 * pulse;
      orbLight.distance = 6;
    } else if (stacks === 2) {
      // Stack 2: Unstable glow — irregular multi-frequency pulsing
      const p1 = Math.sin(now * 0.006);
      const p2 = Math.sin(now * 0.013) * 0.5;
      const p3 = Math.sin(now * 0.029) * 0.3;
      const pulse = 0.5 + 0.5 * (p1 + p2 + p3) / 1.8;
      const flicker = 0.8 + 0.2 * Math.sin(now * 0.047);
      sphereMat.emissiveIntensity = (0.4 + 0.5 * pulse) * flicker;
      orbLight.intensity = (0.7 + 0.5 * pulse) * flicker;
      orbLight.distance = 8;
    } else {
      // Stack 3: Maximum energy — intense, chaotic, with aura
      const p1 = Math.sin(now * 0.008);
      const p2 = Math.sin(now * 0.019) * 0.6;
      const p3 = Math.sin(now * 0.041) * 0.4;
      const p4 = Math.sin(now * 0.067) * 0.2;
      const pulse = 0.5 + 0.5 * (p1 + p2 + p3 + p4) / 2.2;
      const flicker = 0.6 + 0.4 * Math.sin(now * 0.083);
      sphereMat.emissiveIntensity = (0.6 + 0.8 * pulse) * flicker;
      orbLight.intensity = (1.0 + 0.8 * pulse) * flicker;
      orbLight.distance = 10;

      // Scale vibration — the orb physically trembles
      const vibrate = 1.0 + 0.04 * Math.sin(now * 0.05);
      mesh.scale.setScalar(strikeScale * vibrate);
    }

    // Progressive color shift toward white-hot
    if (orb.team === 'player') {
      const shift = stacks / 3;
      sphereMat.color.setRGB(shift * 0.6, 0.87 + shift * 0.13, 1.0);
      sphereMat.emissive.setRGB(shift * 0.3, 0.53 + shift * 0.3, 0.67 + shift * 0.33);
    } else {
      const shift = stacks / 3;
      sphereMat.color.setRGB(1.0, 0.27 + shift * 0.5, shift * 0.3);
      sphereMat.emissive.setRGB(0.67 + shift * 0.33, 0.13 + shift * 0.4, shift * 0.2);
    }

    // Energy aura — wireframe shell at max stacks
    if (orb.aura) {
      if (stacks >= 3) {
        orb.aura.visible = true;
        orb.auraMat.opacity = 0.12 + 0.08 * Math.sin(now * 0.007);
        orb.aura.rotation.x += dt * 2.5;
        orb.aura.rotation.y += dt * 4;
      } else {
        orb.aura.visible = false;
      }
    }
  } else {
    // Reset to base colors when no stacks
    sphereMat.color.setHex(colors.primary);
    sphereMat.emissive.setHex(colors.emissive);
    if (orb.aura) orb.aura.visible = false;
  }

  // Apply flick curve force (skip during auto-return — steering handles velocity)
  if (state.curveTimer > 0 && !state.returning) {
    state.curveTimer -= dt;
    state.velocity.x += state.curveAccel.x * dt;
    state.velocity.y += state.curveAccel.y * dt;
    state.velocity.z += state.curveAccel.z * dt;
    orb.body.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z);
  }

  // Trail — position history with fading vertex colours
  // Reuse vectors in circular fashion to avoid allocations
  if (trailPoints.length < TRAIL_LENGTH) {
    trailPoints.push(state.position.clone());
  } else {
    // Recycle oldest vector
    const recycled = trailPoints.shift();
    recycled.copy(state.position);
    trailPoints.push(recycled);
  }

  // Use cached trail color (avoid new Color per frame)
  if (!orb._trailColor) orb._trailColor = new THREE.Color(colors.trail);
  const c = orb._trailColor;
  for (let i = 0; i < TRAIL_LENGTH; i++) {
    if (i < trailPoints.length) {
      const p = trailPoints[i];
      const alpha = i / trailPoints.length;
      trailPositions[i * 3] = p.x;
      trailPositions[i * 3 + 1] = p.y;
      trailPositions[i * 3 + 2] = p.z;
      trailColorArr[i * 3] = c.r * alpha;
      trailColorArr[i * 3 + 1] = c.g * alpha;
      trailColorArr[i * 3 + 2] = c.b * alpha;
    } else {
      const last = trailPoints.length > 0 ? trailPoints[trailPoints.length - 1] : state.position;
      trailPositions[i * 3] = last.x;
      trailPositions[i * 3 + 1] = last.y;
      trailPositions[i * 3 + 2] = last.z;
      trailColorArr[i * 3] = 0;
      trailColorArr[i * 3 + 1] = 0;
      trailColorArr[i * 3 + 2] = 0;
    }
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.color.needsUpdate = true;

  trail.visible = trailPoints.length > 1;
}
