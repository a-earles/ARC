import * as THREE from 'three';
import { CONFIG } from './config.js';

// Strike Zone: a body-sized CIRCLE on each back wall.
// Inspired by Sparc VR — the circle is roughly the player's size,
// so the player can actively block it with their body/shield.

export function createStrikeZones(scene) {
  const halfZ = CONFIG.ARENA_LENGTH / 2;
  const radius = CONFIG.STRIKE_ZONE_RADIUS;
  const centerY = CONFIG.STRIKE_ZONE_CENTER_Y;

  // Player strike zone: circle on +Z back wall
  const playerZone = createCircleZoneVisual(scene, halfZ, centerY, radius, 0x00ddff, 1);

  // Opponent strike zone: circle on -Z back wall
  const oppZone = createCircleZoneVisual(scene, -halfZ, centerY, radius, 0xff4400, -1);

  const zones = {
    player: {
      visual: playerZone,
      centerX: 0,
      centerY: centerY,
      zWall: halfZ,
      radius: radius,
      depth: CONFIG.STRIKE_ZONE_DEPTH,
      lastTriggerTime: 0,
      flashTimer: 0,
    },
    opponent: {
      visual: oppZone,
      centerX: 0,
      centerY: centerY,
      zWall: -halfZ,
      radius: radius,
      depth: CONFIG.STRIKE_ZONE_DEPTH,
      lastTriggerTime: 0,
      flashTimer: 0,
    },
  };

  return zones;
}

function createCircleZoneVisual(scene, zPos, centerY, radius, color, facing) {
  const group = new THREE.Group();

  // --- Circle ring on the back wall ---
  const ringGeo = new THREE.RingGeometry(radius - 0.03, radius + 0.03, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(0, centerY, zPos + facing * 0.05);
  if (facing > 0) ring.rotation.y = Math.PI;
  scene.add(ring);

  // --- Subtle filled circle (very faint) ---
  const fillGeo = new THREE.CircleGeometry(radius, 64);
  const fillMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.06,
    side: THREE.DoubleSide,
  });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.position.set(0, centerY, zPos + facing * 0.04);
  if (facing > 0) fill.rotation.y = Math.PI;
  scene.add(fill);

  // --- Floor marker circle (like in Sparc) ---
  const floorRingGeo = new THREE.RingGeometry(radius - 0.02, radius + 0.02, 64);
  const floorRingMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
  });
  const floorRing = new THREE.Mesh(floorRingGeo, floorRingMat);
  floorRing.rotation.x = -Math.PI / 2;
  // Position on the floor, slightly behind the player's area
  const floorZ = zPos - facing * 2;
  floorRing.position.set(0, 0.01, floorZ);
  scene.add(floorRing);

  // Subtle floor fill
  const floorFillGeo = new THREE.CircleGeometry(radius, 64);
  const floorFillMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.04,
    side: THREE.DoubleSide,
  });
  const floorFill = new THREE.Mesh(floorFillGeo, floorFillMat);
  floorFill.rotation.x = -Math.PI / 2;
  floorFill.position.set(0, 0.005, floorZ);
  scene.add(floorFill);

  return { ring, ringMat, fill, fillMat, floorRing, floorRingMat, floorFill, floorFillMat };
}

// Check if an orb is inside a strike zone — circular detection
export function checkStrikeZone(zones, zoneName, orbState) {
  const zone = zones[zoneName];
  if (!zone) return false;

  const pos = orbState.position;
  const speed = orbState.velocity.length();

  if (speed < CONFIG.STRIKE_MIN_ORB_SPEED) return false;
  if (orbState.isHeld || orbState.recalling) return false;

  const now = performance.now();
  if (now - zone.lastTriggerTime < 1000) return false;

  // Z range check — is the orb within the strike zone depth?
  const zMin = zone.zWall < 0 ? zone.zWall : zone.zWall - zone.depth;
  const zMax = zone.zWall < 0 ? zone.zWall + zone.depth : zone.zWall;
  if (pos.z < zMin || pos.z > zMax) return false;

  // Circular XY check — distance from circle center
  const dx = pos.x - zone.centerX;
  const dy = pos.y - zone.centerY;
  const distSq = dx * dx + dy * dy;

  if (distSq <= zone.radius * zone.radius) {
    zone.lastTriggerTime = now;
    zone.flashTimer = 0.3;
    return true;
  }

  return false;
}

// Update strike zone visuals (pulse + flash)
// Direct property access instead of iterator loop to avoid allocation
export function updateStrikeZones(zones, dt) {
  _updateSingleZone(zones.player, dt);
  _updateSingleZone(zones.opponent, dt);
}

function _updateSingleZone(zone, dt) {
  const v = zone.visual;

  if (zone.flashTimer > 0) {
    zone.flashTimer -= dt;
    const t = zone.flashTimer / 0.3;
    // Flash bright
    v.ringMat.opacity = 0.35 + 0.5 * t;
    v.fillMat.opacity = 0.06 + 0.25 * t;
    v.floorRingMat.opacity = 0.15 + 0.3 * t;
  } else {
    // Gentle pulse
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.002);
    v.ringMat.opacity = 0.25 + 0.1 * pulse;
    v.fillMat.opacity = 0.04 + 0.03 * pulse;
    v.floorRingMat.opacity = 0.1 + 0.05 * pulse;
  }
}
