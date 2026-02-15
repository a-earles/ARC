// All gameplay tuning constants — single source of truth
// Every gameplay-affecting number lives here for fast iteration

export const CONFIG = {
  // --- Arena ---
  ARENA_LENGTH: 60,       // Z axis (long corridor)
  ARENA_WIDTH: 10,        // X axis
  ARENA_HEIGHT: 5.5,      // Y axis (tighter ceiling — double jump hits ceiling)

  // --- Orb / Projectile ---
  ORB_RADIUS: 0.3,
  THROW_SPEED: 45,

  // --- Physics ---
  GRAVITY: 3.0,
  RESTITUTION: 0.92,
  FRICTION: 0.05,
  WALL_THICKNESS: 1.0,
  AIR_DRAG: 0.9995,

  // --- Player Movement ---
  MOVE_ACCEL: 40,
  MOVE_DECEL: 25,
  MOVE_MAX_SPEED: 7,
  PLAYER_BOUNDS_DEPTH: 8.0,  // how far from back wall player can roam
  PLAYER_EYE_HEIGHT: 1.7,
  MOUSE_SENSITIVITY: 0.002,

  // --- Catching ---
  CATCH_RADIUS: 2.2,
  CATCH_FACING_DOT: 0.6,
  CATCH_GRACE_PERIOD_MS: 500,
  CLEAN_CATCH_WINDOW_MS: 180,
  CLEAN_CATCH_SPEED_BOOST: 0.10,    // +10% movement speed
  CLEAN_CATCH_BOOST_DURATION: 0.4,   // seconds

  // --- Shield / Block ---
  SHIELD_WIDTH: 1.2,
  SHIELD_HEIGHT: 1.5,
  SHIELD_OFFSET: 1.0,
  BLOCK_SPEED_PENALTY: 0.4,         // movement speed multiplier while blocking
  REFLECT_SPEED_MULT: 1.3,          // normal block reflection speed boost
  PARRY_SPEED_MULT: 1.6,            // perfect parry speed boost
  PARRY_WINDOW_MS: 150,             // ms after raising shield for perfect parry
  SHIELD_ENERGY_MAX: 1.0,           // full charge
  SHIELD_DRAIN_RATE: 0.35,          // energy per second while blocking (~2.85s full use)
  SHIELD_RECHARGE_RATE: 0.3,        // energy per second when not blocking (~3.3s full recharge)
  SHIELD_MIN_ACTIVATE: 0.15,        // minimum energy to raise shield

  // --- Strike Zone ---
  STRIKE_ZONE_RADIUS: 1.0,          // circle radius on back wall (body-sized)
  STRIKE_ZONE_CENTER_Y: 1.0,        // center height of the circle (chest level)
  STRIKE_ZONE_DEPTH: 2.0,           // depth trigger volume
  STRIKE_RADIUS_SCALE: 0.12,        // orb radius increase per stack
  STRIKE_SPEED_SCALE: 0.10,         // throw speed increase per stack
  STRIKE_MAX_STACKS: 3,
  STRIKE_MIN_ORB_SPEED: 5.0,        // min speed for strike to count

  // --- Dash ---
  DASH_DISTANCE: 3.0,
  DASH_DURATION_S: 0.15,
  DASH_COOLDOWN_S: 1.5,

  // --- Crouch ---
  CROUCH_EYE_HEIGHT: 0.9,          // eye height when crouching
  CROUCH_TRANSITION_SPEED: 12.0,   // smooth transition rate
  CROUCH_MOVE_PENALTY: 0.6,        // movement speed while crouching

  // --- Jump / Double Jump ---
  JUMP_VELOCITY: 7.0,              // upward velocity on first jump
  DOUBLE_JUMP_VELOCITY: 5.5,       // second jump (weaker — must time well)
  PLAYER_GRAVITY: 18.0,            // downward acceleration on player
  AIR_MOVE_PENALTY: 0.65,          // lateral speed while airborne
  MAX_JUMPS: 2,                    // 2 = double jump

  // --- Scoring ---
  SCORE_MIN_SPEED: 3.0,             // min orb speed to register a hit
  SCORE_DEBOUNCE_MS: 1000,
  HIT_GRACE_PERIOD_MS: 500,         // ms after throw before hit can register
  POINTS_TO_WIN: 7,
  ROUNDS_TO_WIN: 2,                 // best of 3
  RESET_DELAY_S: 1.2,

  // --- Recall ---
  RECALL_DELAY: 1.0,                // stall time before auto-recall
  RECALL_MAX_TIME: 6.0,             // force recall after this many seconds
  RECALL_SPEED: 16,
  STALL_SPEED: 2.5,

  // --- Auto-Return Arc (back wall bounce) ---
  RETURN_INITIAL_SPEED: 22,         // speed when return starts (normalized from bounce)
  RETURN_STEER_BASE: 35,            // initial steering force (aggressive homing)
  RETURN_STEER_RAMP: 50,            // steering increase per second (ramps fast)
  RETURN_STEER_MAX: 90,             // max steering force (very direct tracking)
  RETURN_SPEED_MIN: 18,             // minimum return speed
  RETURN_SPEED_MAX: 30,             // maximum return speed
  RETURN_GRAVITY_COUNTER: 0.95,     // fraction of gravity counteracted (nearly zero-g for direct line)
  RETURN_CATCH_DIST: 3.0,           // auto-catch distance

  // --- Flick Spin ---
  FLICK_SAMPLE_MS: 100,
  FLICK_THRESHOLD_PX: 150,
  FLICK_CURVE_ACCEL: 8.0,
  FLICK_CURVE_DURATION_S: 0.3,

  // --- Opponent (Phase 1 timer-based) ---
  OPP_THROW_INTERVAL: 4.0,          // seconds between throws
  OPP_AIM_NOISE_DEG: 6,             // degrees of random aim offset
  OPP_HIT_RADIUS: 1.5,              // hit detection radius
  OPP_CATCH_RADIUS: 2.5,            // catch radius for opponent

  // --- Dissolve / Respawn ---
  DISSOLVE_DURATION: 0.5,
  RESPAWN_DELAY: 3.0,

  // --- Visual ---
  BLOOM_STRENGTH: 0.4,
  BLOOM_RADIUS: 0.2,
  BLOOM_THRESHOLD: 0.6,
  SCENE_BG: 0x111115,
  FOG_DENSITY: 0.004,

  // --- AI Difficulty (Phase 4) ---
  AI_EASY: {
    reactionMs: 400,
    aimNoiseDeg: 12,
    bankShotFreq: 0.15,
    parryAccuracyMs: 200,
    dashUsage: 0.1,
    strikeAwareness: 0.2,
  },
  AI_MEDIUM: {
    reactionMs: 250,
    aimNoiseDeg: 6,
    bankShotFreq: 0.40,
    parryAccuracyMs: 100,
    dashUsage: 0.5,
    strikeAwareness: 0.6,
  },
  AI_HARD: {
    reactionMs: 120,
    aimNoiseDeg: 2,
    bankShotFreq: 0.70,
    parryAccuracyMs: 40,
    dashUsage: 0.8,
    strikeAwareness: 0.95,
  },
};
