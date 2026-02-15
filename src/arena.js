import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { ARENA_DIMS } from './physics.js';
import { CONFIG } from './config.js';

// Initialize RectAreaLight support
RectAreaLightUniformsLib.init();

export function createArena(scene) {
  const { length, width, height } = ARENA_DIMS;
  const halfZ = length / 2;

  // --- Color palette ---
  const FRAME_COLOR = 0x1a1a1a;       // Dark structural frames
  const PANEL_COLOR = 0xcccccc;        // Light grey wall panels
  const FLOOR_COLOR = 0x1a1a1e;        // Dark reflective floor
  const CEIL_COLOR = 0x222225;          // Dark ceiling
  const BLUE_TINT = new THREE.Color(0x00bbdd);  // Player color
  const RED_TINT = new THREE.Color(0xdd3300);    // Opponent color

  // =============================================
  // LIGHTING — bright, industrial, clear
  // =============================================

  // Overall ambient — brighter than before
  const ambient = new THREE.AmbientLight(0xaaaaaa, 0.6);
  scene.add(ambient);

  // Hemisphere light for natural fill (sky=cool grey, ground=warm grey)
  const hemi = new THREE.HemisphereLight(0xc0c8d0, 0x404040, 0.5);
  scene.add(hemi);

  // Overhead rectangular light fixtures along the corridor
  for (let z = -halfZ + 4; z <= halfZ - 4; z += 8) {
    const fixtureLight = new THREE.RectAreaLight(0xffffff, 2.0, 3, 1.5);
    fixtureLight.position.set(0, height - 0.1, z);
    fixtureLight.lookAt(0, 0, z); // Point straight down
    scene.add(fixtureLight);

    // Visible fixture panel on ceiling
    const fixGeo = new THREE.PlaneGeometry(3, 1.5);
    const fixMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    const fixMesh = new THREE.Mesh(fixGeo, fixMat);
    fixMesh.position.set(0, height - 0.02, z);
    fixMesh.rotation.x = Math.PI / 2;
    scene.add(fixMesh);
  }

  // Subtle player-color ambient lights near each end (the key tinting effect)
  // Blue end (+Z, player side) — multiple lights for smooth gradient
  for (let i = 0; i < 3; i++) {
    const z = halfZ - 3 - i * 6;
    const intensity = 0.4 - i * 0.12; // Fades toward center
    const bl = new THREE.PointLight(0x00bbdd, intensity, 20);
    bl.position.set(0, height * 0.6, z);
    scene.add(bl);
  }

  // Red end (-Z, opponent side)
  for (let i = 0; i < 3; i++) {
    const z = -halfZ + 3 + i * 6;
    const intensity = 0.4 - i * 0.12;
    const rl = new THREE.PointLight(0xdd3300, intensity, 20);
    rl.position.set(0, height * 0.6, z);
    scene.add(rl);
  }

  // =============================================
  // FLOOR — dark, slightly reflective, with panel lines
  // =============================================
  const floorGeo = new THREE.PlaneGeometry(width, length);
  const floorMat = new THREE.MeshStandardMaterial({
    color: FLOOR_COLOR,
    roughness: 0.3,
    metalness: 0.4,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);

  // Floor panel lines — dark grey lines creating large floor tiles
  const floorLineGroup = new THREE.Group();
  const floorLineMat = new THREE.LineBasicMaterial({
    color: 0x333338,
    transparent: true,
    opacity: 0.6,
  });

  // Major floor lines along Z (lengthwise)
  const floorPanelWidth = 2.5;
  for (let x = -width / 2; x <= width / 2; x += floorPanelWidth) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.005, -halfZ),
      new THREE.Vector3(x, 0.005, halfZ),
    ]);
    floorLineGroup.add(new THREE.Line(geo, floorLineMat));
  }

  // Major floor lines along X (widthwise)
  const floorPanelLength = 4;
  for (let z = -halfZ; z <= halfZ; z += floorPanelLength) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-width / 2, 0.005, z),
      new THREE.Vector3(width / 2, 0.005, z),
    ]);
    floorLineGroup.add(new THREE.Line(geo, floorLineMat));
  }
  scene.add(floorLineGroup);

  // Center divider — thick dark line across the floor
  const centerStripGeo = new THREE.PlaneGeometry(width, 0.3);
  const centerStripMat = new THREE.MeshBasicMaterial({
    color: 0x444444,
    side: THREE.DoubleSide,
  });
  const centerStrip = new THREE.Mesh(centerStripGeo, centerStripMat);
  centerStrip.rotation.x = -Math.PI / 2;
  centerStrip.position.set(0, 0.006, 0);
  scene.add(centerStrip);

  // =============================================
  // PLAYER MOVEMENT ZONES — floor outlines showing playable area
  // =============================================
  const boundsDepth = CONFIG.PLAYER_BOUNDS_DEPTH;

  // Player zone (blue, +Z side): from back wall to boundsDepth forward
  const playerZoneZMin = halfZ - boundsDepth;
  const playerZoneZMax = halfZ;
  buildFloorZone(scene, -width / 2, width / 2, playerZoneZMin, playerZoneZMax, BLUE_TINT);

  // Opponent zone (red, -Z side): from back wall to boundsDepth forward
  const oppZoneZMin = -halfZ;
  const oppZoneZMax = -halfZ + boundsDepth;
  buildFloorZone(scene, -width / 2, width / 2, oppZoneZMin, oppZoneZMax, RED_TINT);

  // =============================================
  // CEILING — dark with visible structure
  // =============================================
  const ceilGeo = new THREE.PlaneGeometry(width, length);
  const ceilMat = new THREE.MeshStandardMaterial({
    color: CEIL_COLOR,
    roughness: 0.8,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
  const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  scene.add(ceiling);

  // Ceiling structural frame lines
  const ceilLineMat = new THREE.LineBasicMaterial({ color: FRAME_COLOR, transparent: true, opacity: 0.5 });
  for (let x = -width / 2; x <= width / 2; x += floorPanelWidth) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, height - 0.01, -halfZ),
      new THREE.Vector3(x, height - 0.01, halfZ),
    ]);
    scene.add(new THREE.Line(geo, ceilLineMat));
  }
  for (let z = -halfZ; z <= halfZ; z += floorPanelLength) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-width / 2, height - 0.01, z),
      new THREE.Vector3(width / 2, height - 0.01, z),
    ]);
    scene.add(new THREE.Line(geo, ceilLineMat));
  }

  // =============================================
  // WALLS — light grey panels with dark structural frames
  // =============================================

  // Wall panel material — light, slightly transparent glass-like
  const wallPanelMat = new THREE.MeshStandardMaterial({
    color: PANEL_COLOR,
    transparent: true,
    opacity: 0.25,
    roughness: 0.2,
    metalness: 0.3,
    side: THREE.DoubleSide,
  });

  // Build paneled walls with structural frames
  buildWall(scene, 'left', -width / 2, width, height, length, halfZ, wallPanelMat, FRAME_COLOR);
  buildWall(scene, 'right', width / 2, width, height, length, halfZ, wallPanelMat, FRAME_COLOR);
  buildWall(scene, 'back', -halfZ, width, height, length, halfZ, wallPanelMat, FRAME_COLOR);
  buildWall(scene, 'front', halfZ, width, height, length, halfZ, wallPanelMat, FRAME_COLOR);

  // =============================================
  // STRUCTURAL EDGE FRAMES — dark lines at all box edges
  // =============================================
  const frameMat = new THREE.LineBasicMaterial({ color: FRAME_COLOR, linewidth: 1 });

  // All 12 edges of the box
  const boxEdges = [
    // Floor edges
    [[-width / 2, 0, -halfZ], [-width / 2, 0, halfZ]],
    [[width / 2, 0, -halfZ], [width / 2, 0, halfZ]],
    [[-width / 2, 0, -halfZ], [width / 2, 0, -halfZ]],
    [[-width / 2, 0, halfZ], [width / 2, 0, halfZ]],
    // Ceiling edges
    [[-width / 2, height, -halfZ], [-width / 2, height, halfZ]],
    [[width / 2, height, -halfZ], [width / 2, height, halfZ]],
    [[-width / 2, height, -halfZ], [width / 2, height, -halfZ]],
    [[-width / 2, height, halfZ], [width / 2, height, halfZ]],
    // Vertical edges
    [[-width / 2, 0, -halfZ], [-width / 2, height, -halfZ]],
    [[width / 2, 0, -halfZ], [width / 2, height, -halfZ]],
    [[-width / 2, 0, halfZ], [-width / 2, height, halfZ]],
    [[width / 2, 0, halfZ], [width / 2, height, halfZ]],
  ];

  boxEdges.forEach(pts => {
    const geo = new THREE.BufferGeometry().setFromPoints(
      pts.map(p => new THREE.Vector3(...p))
    );
    scene.add(new THREE.Line(geo, frameMat));
  });

  // =============================================
  // FLASH EFFECTS — pre-allocated pool (no scene.add/remove per bounce)
  // =============================================
  const FLASH_POOL_SIZE = 6;
  const flashPool = [];
  for (let i = 0; i < FLASH_POOL_SIZE; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 6);
    light.visible = false;
    scene.add(light);
    flashPool.push({ light, life: 0, active: false });
  }
  let flashPoolIndex = 0;

  function flashEdge(pos) {
    // Steal the next slot in the pool (round-robin)
    const slot = flashPool[flashPoolIndex];
    flashPoolIndex = (flashPoolIndex + 1) % FLASH_POOL_SIZE;

    const color = pos.z < 0 ? 0xff6633 : 0x33ccff;
    slot.light.color.setHex(color);
    slot.light.position.set(pos.x, pos.y, pos.z);
    slot.light.intensity = 2;
    slot.light.visible = true;
    slot.life = 0.25;
    slot.active = true;
  }

  function update(dt) {
    // Decay flash lights
    for (let i = 0; i < FLASH_POOL_SIZE; i++) {
      const f = flashPool[i];
      if (!f.active) continue;
      f.life -= dt;
      f.light.intensity = Math.max(0, f.life / 0.25) * 2;
      if (f.life <= 0) {
        f.light.visible = false;
        f.active = false;
      }
    }
  }

  return { update, flashEdge };
}

// =============================================
// Wall builder — creates paneled wall with structural grid
// =============================================
function buildWall(scene, side, position, arenaWidth, arenaHeight, arenaLength, halfZ, panelMat, frameColor) {
  const panelH = 2;  // Panel height
  const panelW = 4;  // Panel width along wall

  const frameMat = new THREE.LineBasicMaterial({
    color: frameColor,
    transparent: true,
    opacity: 0.7,
  });

  if (side === 'left' || side === 'right') {
    const x = position;
    const sign = side === 'left' ? 1 : -1;
    const wallLength = arenaLength;

    // Full wall panel
    const wallGeo = new THREE.PlaneGeometry(wallLength, arenaHeight);
    const wallMesh = new THREE.Mesh(wallGeo, panelMat.clone());
    wallMesh.rotation.y = side === 'left' ? Math.PI / 2 : -Math.PI / 2;
    wallMesh.position.set(x, arenaHeight / 2, 0);
    scene.add(wallMesh);

    // Horizontal frame lines
    const xOff = x + sign * 0.02;
    for (let y = 0; y <= arenaHeight; y += panelH) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xOff, y, -halfZ),
        new THREE.Vector3(xOff, y, halfZ),
      ]);
      scene.add(new THREE.Line(geo, frameMat));
    }

    // Vertical frame lines
    for (let z = -halfZ; z <= halfZ; z += panelW) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xOff, 0, z),
        new THREE.Vector3(xOff, arenaHeight, z),
      ]);
      scene.add(new THREE.Line(geo, frameMat));
    }

  } else if (side === 'back' || side === 'front') {
    const z = position;

    // Full wall panel
    const wallGeo = new THREE.PlaneGeometry(arenaWidth, arenaHeight);
    const wallMesh = new THREE.Mesh(wallGeo, panelMat.clone());
    wallMesh.position.set(0, arenaHeight / 2, z);
    if (side === 'front') wallMesh.rotation.y = Math.PI;
    scene.add(wallMesh);

    const zOff = z + (side === 'back' ? 0.02 : -0.02);

    // Horizontal frame lines
    for (let y = 0; y <= arenaHeight; y += panelH) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-arenaWidth / 2, y, zOff),
        new THREE.Vector3(arenaWidth / 2, y, zOff),
      ]);
      scene.add(new THREE.Line(geo, frameMat));
    }

    // Vertical frame lines
    for (let x = -arenaWidth / 2; x <= arenaWidth / 2; x += panelW) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0, zOff),
        new THREE.Vector3(x, arenaHeight, zOff),
      ]);
      scene.add(new THREE.Line(geo, frameMat));
    }
  }
}

// =============================================
// Floor zone builder — outlined rectangle showing player movement area
// =============================================
function buildFloorZone(scene, xMin, xMax, zMin, zMax, color) {
  const y = 0.008; // Slightly above floor

  // --- Outline rectangle ---
  const outlineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(xMin, y, zMin),
    new THREE.Vector3(xMax, y, zMin),
    new THREE.Vector3(xMax, y, zMax),
    new THREE.Vector3(xMin, y, zMax),
    new THREE.Vector3(xMin, y, zMin),
  ]);
  const outlineMat = new THREE.LineBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.4,
  });
  scene.add(new THREE.Line(outlineGeo, outlineMat));

  // --- Subtle filled area ---
  const fillWidth = xMax - xMin;
  const fillDepth = zMax - zMin;
  const fillGeo = new THREE.PlaneGeometry(fillWidth, fillDepth);
  const fillMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.03,
    side: THREE.DoubleSide,
  });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.set((xMin + xMax) / 2, y - 0.002, (zMin + zMax) / 2);
  scene.add(fill);

  // --- Corner markers (small L-shapes at each corner for extra clarity) ---
  const cornerLen = 0.8;
  const cornerMat = new THREE.LineBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.6,
  });

  const corners = [
    [xMin, zMin, 1, 1],   // bottom-left
    [xMax, zMin, -1, 1],  // bottom-right
    [xMin, zMax, 1, -1],  // top-left
    [xMax, zMax, -1, -1], // top-right
  ];

  for (const [cx, cz, dx, dz] of corners) {
    const cGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(cx + dx * cornerLen, y + 0.001, cz),
      new THREE.Vector3(cx, y + 0.001, cz),
      new THREE.Vector3(cx, y + 0.001, cz + dz * cornerLen),
    ]);
    scene.add(new THREE.Line(cGeo, cornerMat));
  }
}
