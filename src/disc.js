import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const DISC_RADIUS = 0.3;
const DISC_THICKNESS = 0.04;
const TRAIL_LENGTH = 40;

export function createDisc(scene, physics) {
  const state = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    rotation: new THREE.Euler(),
    isHeld: true,
    bounceCount: 0,
  };

  // --- Physics body ---
  const body = new CANNON.Body({
    mass: 0.5,
    shape: new CANNON.Sphere(DISC_RADIUS),
    material: physics.discMat,
    linearDamping: 0.01,
    angularDamping: 0.1,
  });
  body.position.set(0, 1.5, 28);
  physics.world.addBody(body);

  // --- Visual: Outer ring (the main disc shape) ---
  const ringGeo = new THREE.TorusGeometry(DISC_RADIUS, DISC_THICKNESS / 2, 6, 32);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x00ddff,
    emissive: 0x0088aa,
    emissiveIntensity: 0.6,
    roughness: 0.3,
    metalness: 0.9,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  scene.add(ringMesh);

  // --- Visual: Inner disc face ---
  const innerGeo = new THREE.CircleGeometry(DISC_RADIUS * 0.85, 32);
  const innerMat = new THREE.MeshStandardMaterial({
    color: 0x001a22,
    emissive: 0x002233,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    roughness: 0.4,
    metalness: 0.8,
  });
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  ringMesh.add(innerMesh);

  // --- Visual: Center dot ---
  const centerGeo = new THREE.CircleGeometry(DISC_RADIUS * 0.15, 12);
  const centerMat = new THREE.MeshBasicMaterial({
    color: 0x00ccff,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
  });
  const centerMesh = new THREE.Mesh(centerGeo, centerMat);
  centerMesh.position.z = 0.001;
  ringMesh.add(centerMesh);

  // --- Point light (subtle — not blinding) ---
  const discLight = new THREE.PointLight(0x00ccff, 0.4, 5);
  ringMesh.add(discLight);

  // --- Trail ---
  const trailPositions = new Float32Array(TRAIL_LENGTH * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  const trailMat = new THREE.LineBasicMaterial({
    color: 0x00bbff,
    transparent: true,
    opacity: 0.4,
  });
  const trail = new THREE.Line(trailGeo, trailMat);
  scene.add(trail);

  const trailPoints = [];

  return { state, body, ringMesh, ringMat, discLight, trail, trailGeo, trailPoints, trailPositions };
}

export function updateDisc(disc, gameState, dt) {
  const { state, ringMesh, ringMat, discLight, trail, trailGeo, trailPoints, trailPositions } = disc;

  if (state.isHeld) {
    // Position disc at lower-right of view, like holding it at hip/hand
    const camYaw = gameState.cameraYaw || 0;
    const camPitch = gameState.cameraPitch || 0;

    // Offset: right 0.25, down 0.35, forward 0.5 from camera
    const offset = new THREE.Vector3(0.25, -0.35, -0.5);
    offset.applyEuler(new THREE.Euler(camPitch * 0.2, camYaw, 0, 'YXZ'));
    ringMesh.position.copy(gameState.playerPos).add(offset);

    // Orient disc flat, facing forward
    ringMesh.rotation.set(Math.PI / 2, camYaw, 0, 'YXZ');

    // Subtle bob
    ringMesh.position.y += Math.sin(performance.now() * 0.003) * 0.01;

    // Dim when held
    discLight.intensity = 0.15;
    ringMat.emissiveIntensity = 0.3;

    // Show blocking pose if active
    if (gameState.blocking) {
      // Raise disc to center-forward, like a shield
      const shieldOffset = new THREE.Vector3(0, -0.05, -0.6);
      shieldOffset.applyEuler(new THREE.Euler(camPitch * 0.5, camYaw, 0, 'YXZ'));
      ringMesh.position.copy(gameState.playerPos).add(shieldOffset);
      // Tilt disc to face incoming direction
      ringMesh.rotation.set(camPitch + Math.PI / 2, camYaw, 0, 'YXZ');
      discLight.intensity = 0.4;
      ringMat.emissiveIntensity = 0.8;
    }

    trailPoints.length = 0;
  } else {
    // Follow physics
    ringMesh.position.copy(state.position);

    const speed = state.velocity.length();
    if (speed > 0.5) {
      const dir = state.velocity.clone().normalize();
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.rotation.y += speed * dt * 0.3;
      ringMesh.rotation.z = Math.atan2(dir.x, dir.z);
    }

    // Glow scales with speed but stays tasteful
    const t = THREE.MathUtils.clamp(speed / 40, 0, 1);
    discLight.intensity = 0.3 + t * 0.8;
    ringMat.emissiveIntensity = 0.4 + t * 0.6;

    // Trail
    trailPoints.push(state.position.clone());
    if (trailPoints.length > TRAIL_LENGTH) trailPoints.shift();

    for (let i = 0; i < TRAIL_LENGTH; i++) {
      if (i < trailPoints.length) {
        const p = trailPoints[i];
        trailPositions[i * 3] = p.x;
        trailPositions[i * 3 + 1] = p.y;
        trailPositions[i * 3 + 2] = p.z;
      } else {
        const last = trailPoints.length > 0 ? trailPoints[trailPoints.length - 1] : state.position;
        trailPositions[i * 3] = last.x;
        trailPositions[i * 3 + 1] = last.y;
        trailPositions[i * 3 + 2] = last.z;
      }
    }
    trailGeo.attributes.position.needsUpdate = true;
    trail.material.opacity = THREE.MathUtils.clamp(speed / 20, 0.05, 0.4);
  }

  trail.visible = !state.isHeld && trailPoints.length > 1;
}
