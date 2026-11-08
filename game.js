/**
 * BOWLING 2600 DELUXE - Core Game Engine & Dual Renderer
 * Reverse-engineered directly from Atari 2600 Bowling.bin (Larry Kaplan, 1979).
 * Preserves 100% of the original rules, 6 game variations, difficulty A/B pin
 * deflection tables ($F7A6), ball deflection, chain-reaction pin collisions,
 * and 10-frame scoring while adding 60fps interpolated HD graphics and modern audio.
 */

(() => {
  // =========================================================================
  // 1. ROM DATA TABLES EXTRACTED FROM BOWLING.BIN ($F700-$F7FF)
  // =========================================================================

  // $F7B2: 6 Game Mode Bitmasks (Bit 7 = 2P, Bit 6 = Steerable, Bit 5 = Straight)
  const ROM_GAME_MODES = [
    { id: 1, byte: 0x00, players: 1, type: 'curve', name: 'JOGO 1 • 1P BOLA COM CURVA' },
    { id: 2, byte: 0x80, players: 2, type: 'curve', name: 'JOGO 2 • 2P BOLA COM CURVA' },
    { id: 3, byte: 0x40, players: 1, type: 'steer', name: 'JOGO 3 • 1P BOLA DIRIGÍVEL' },
    { id: 4, byte: 0xC0, players: 2, type: 'steer', name: 'JOGO 4 • 2P BOLA DIRIGÍVEL' },
    { id: 5, byte: 0x20, players: 1, type: 'straight', name: 'JOGO 5 • 1P BOLA RETA' },
    { id: 6, byte: 0xA0, players: 2, type: 'straight', name: 'JOGO 6 • 2P BOLA RETA' },
  ];

  // $F78A & $F794: Initial 10-Pin Positions
  // AF = vertical coordinate (0..33 from bottom to top of lane; 16 is center)
  // B9 = horizontal column at pin deck (7 = headpin, 5 = row 2, 3 = row 3, 1 = row 4)
  const ROM_PIN_INIT_AF = [0x10, 0x13, 0x0D, 0x16, 0x10, 0x0A, 0x19, 0x13, 0x0D, 0x07];
  const ROM_PIN_INIT_B9 = [0x07, 0x05, 0x05, 0x03, 0x03, 0x03, 0x01, 0x01, 0x01, 0x01];
  const PIN_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  // $F7A6: Pin Deflection Velocity Table (12 bytes)
  // Indexed by (D5 << 1) | difficultyBit, where D5 = AF[x] - A9 + 1 (0..5)
  // High nibble = dB9 (horizontal speed toward pit), Low nibble = signed 4-bit dAF (vertical speed)
  const ROM_PIN_VEL_TABLE = [
    0x0F, 0x1E, 0x1F, 0x3F, 0x2F, 0x10,
    0x10, 0x21, 0x31, 0x11, 0x12, 0x01
  ];

  // $F7ED, $F7F2, $F7F7: Bowler Approach Animation Offsets (Steps 0..4)
  const ROM_APPROACH_BOWLER_X = [0x08, 0x0C, 0x10, 0x14, 0x18];
  const ROM_APPROACH_BALL_DX  = [7, 8, -2, -2, 8];
  const ROM_APPROACH_BALL_DY  = [0x0B, 0x07, 0x02, 0x02, 0x00];

  // $F7B8, $F7C8, $F7D8: Original 12-scanline Bowler Sprite Bitmaps (bottom-to-top)
  const ROM_BOWLER_SPRITES = [
    // Sprite 0 ($F7B8): Stance / Celebration Frame A
    [0x38, 0x30, 0x30, 0x30, 0x38, 0x38, 0x3E, 0x3F, 0x39, 0x38, 0x10, 0x38, 0x3C, 0x38],
    // Sprite 1 ($F7C8): Backswing Frame
    [0x1B, 0x12, 0x12, 0x12, 0x16, 0x14, 0x9C, 0xDC, 0x5C, 0x7C, 0x3C, 0x1C, 0x08, 0x1C],
    // Sprite 2 ($F7D8): Release / Celebration Jump Frame B
    [0xC3, 0x82, 0x82, 0xC2, 0x66, 0x2C, 0x38, 0x38, 0x3B, 0x3E, 0x3C, 0x38, 0x10, 0x38]
  ];

  // =========================================================================
  // 2. GAME STATE & ENGINE
  // =========================================================================

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  const state = {
    gameModeIndex: 0,       // 0..5 (Games 1..6)
    difficulty: ['B', 'B'], // Per-player difficulty ('B' = Novice/Standard, 'A' = Pro/Expert)
    visualMode: 'modern',   // 'modern' | 'atari'
    frameCounter: 0,        // Emulates ROM $80 (60Hz tick counter)
    gameActive: true,       // Emulates ROM $81 ($FF when active, $00 when game over)
    currentPlayer: 0,       // Emulates ROM $8F (0 or 1)
    currentFrame: 1,        // 1..10 (plus bonus rolls in 10th frame)
    rollInFrame: 0,         // 0 = 1st ball, 1 = 2nd ball (or bonus balls in 10th)

    // Bowler & Ball state (matches ROM $8D, $A8, $A9, $9D, $9E, $90)
    bowlerState: 0,         // 0 = Positioning, 1..4 = Approach/Swing, 5 = Rolling, 6 = Resetting/PinSweep
    bowlerY: 14,            // ROM $A8 (1..28, 14 puts ball right at center 16)
    bowlerX: 0x08,          // ROM $9D
    ballX: 0x0F,            // ROM $9E (horizontal position from 0x0F to 0x8C = 140)
    ballY: 25,              // ROM $A9 (vertical position 0..33)
    lockedCurveDir: 0,      // ROM $90 (0 = none, 1 = UP, 2 = DOWN)
    activeSteerDir: 0,      // Live steer indicator for HUD/particles
    ballSpinAngle: 0,       // Visual rotation of the bowling ball
    ballTrail: [],          // Visual trail points

    // Pins state (10 pins, matching ROM $AF, $B9, $C3)
    pins: [],
    pinMoveRoundRobin: 9,   // Emulates ROM $AE (processes 4 pins per frame)
    standingBeforeRoll: 10,
    knockedTotalInSet: 0,   // Emulates ROM $A3 (0..10 pins down in current rack)
    isCelebration: false,   // All 10 pins down -> celebration flash & bowler jump
    celebrationPose: 0,

    // Visual effects
    particles: [],
    floatingTexts: [],
    laneFlashHue: 0,
    pinSweepProgress: 0,

    // Full 10-frame bowling scorecard per player
    players: [createPlayerScoreState(), createPlayerScoreState()],

    // Input state
    keys: { up: false, down: false, throwPressed: false }
  };

  function createPlayerScoreState() {
    const frames = [];
    for (let i = 0; i < 10; i++) {
      frames.push({
        rolls: [],          // Array of pin counts knocked down on each roll in this frame
        atariMarker: null,  // 'open' (01), 'spare' (02), 'strike' (03)
        cumulativeScore: null
      });
    }
    return {
      rollsFlat: [],        // All rolls in the game for exact standard bowling calculation
      frames,
      romScore: 0,          // Total score
      romBonusFlags: 0      // Mirrors ROM $9B ($80 = Strike, $40 = Spare, $C0 = Double Strike)
    };
  }

  function initPinsRack() {
    state.pins = [];
    for (let i = 0; i < 10; i++) {
      state.pins.push({
        id: i,
        number: PIN_NUMBERS[i],
        af: ROM_PIN_INIT_AF[i],       // Logical ROM vertical position (7..25)
        b9: ROM_PIN_INIT_B9[i],       // Logical ROM horizontal column (7, 5, 3, 1)
        c3: 0,                        // Logical ROM velocity byte ($C3,X)
        standing: true,
        cleared: false,               // Cleared after 1st ball if knocked down
        // Smooth visual interpolation coordinates
        visX: columnB9ToCanvasX(ROM_PIN_INIT_B9[i]),
        visY: rowAFToCanvasY(ROM_PIN_INIT_AF[i] + 0.5),
        visAngle: 0,
        visSpin: 0,
        hitFlash: 0
      });
    }
    state.knockedTotalInSet = 0;
    state.standingBeforeRoll = 10;
  }

  // =========================================================================
  // 3. COORDINATE MAPPING (ROM LOGICAL SPACE <-> HD CANVAS SPACE)
  // =========================================================================

  // Lane geometry on the 1120x580 canvas
  const LANE = {
    leftX: 48,
    foulLineX: 235,
    pinDeckStartX: 855,
    pinDeckEndX: 1015,
    pitX: 1045,
    topGutterY: 88,
    laneTopY: 124,
    laneBottomY: 488,
    bottomGutterY: 524
  };

  // Maps ROM bowler X ($9D: 0x08..0x18) to Canvas X on the approach area (left of foul line)
  function romBowlerXToCanvasX(romBowlerX) {
    // 0x08 (8) -> 115px, 0x18 (24) -> 208px (just behind foulLineX = 235px)
    const t = (romBowlerX - 0x08) / (0x18 - 0x08);
    return 115 + t * (208 - 115);
  }

  // Maps ROM ball X ($9E: 0x20..0x8C) to Canvas X along the lane
  function romBallXToCanvasX(romX) {
    // At release ($8D = 4 -> 5), ballX is 0x20 (32), which starts right at foulLineX (235px)
    // Collision region in ROM is $9E in [0x70..0x7F] (112..127) where D5 = ((9E - 0x70) >> 1) ^ 7 maps to B9 = 7..0
    if (romX < 0x20) {
      const tPre = (romX - 0x06) / (0x20 - 0x06);
      return 95 + tPre * (LANE.foulLineX - 95);
    }
    const t = (romX - 0x20) / (0x8C - 0x20);
    return LANE.foulLineX + t * (LANE.pitX - LANE.foulLineX);
  }

  // Maps ROM pin column B9 (7 = headpin, 5 = row2, 3 = row3, 1 = row4) to Canvas X
  // Note: in ROM ($F380), B9 matches ((9E - 0x70) >> 1) ^ 7, so 9E = 0x70 + ((7 - B9) * 2)
  function columnB9ToCanvasX(b9) {
    const eqRomX = 0x70 + (7 - b9) * 2 + 1;
    return romBallXToCanvasX(eqRomX);
  }

  // Maps ROM vertical coordinate (AF / A8 / A9 in 0..33, where 33 is top and 0 is bottom) to Canvas Y
  function rowAFToCanvasY(af) {
    // AF = 16.5 is the exact center of the lane!
    // AF = 1..32 is on the wood lane; AF <= 0 is bottom gutter; AF >= 33 is top gutter
    const normalized = 1 - (af / 33); // 0 at top (AF=33), 1 at bottom (AF=0)
    return LANE.laneTopY + normalized * (LANE.laneBottomY - LANE.laneTopY);
  }

  // Computes synchronized Bowler & Held-Ball canvas positions so the ball is held
  // right in the bowler's hand on the exact release line (bowlerY + 2).
  function getBowlerAndHeldBallCanvasPos() {
    const bowlerX = romBowlerXToCanvasX(state.bowlerX);
    const releaseLineY = rowAFToCanvasY(state.bowlerY + 2);

    // Offsets of the ball relative to the bowler's torso center for states 0..4
    let ballOffsetX = 22;
    let ballOffsetY = 0;

    if (state.bowlerState === 0) {
      // Stance: ball held closely in front of chest/hands, dead-on the release line
      ballOffsetX = 21;
      ballOffsetY = 0;
    } else if (state.bowlerState === 1) {
      // Step 1: pushaway slightly forward
      ballOffsetX = 23;
      ballOffsetY = 2;
    } else if (state.bowlerState === 2) {
      // Step 2: backswing behind hip (like ROM $F7F2 = -2)
      ballOffsetX = -19;
      ballOffsetY = 5;
    } else if (state.bowlerState === 3) {
      // Step 3: forward downswing near hip
      ballOffsetX = -5;
      ballOffsetY = 8;
    } else if (state.bowlerState === 4) {
      // Step 4: release right at the foul line on the exact trajectory line
      ballOffsetX = 25;
      ballOffsetY = 0;
    }

    return {
      bowlerX,
      bowlerY: releaseLineY,
      ballX: bowlerX + ballOffsetX,
      ballY: releaseLineY + ballOffsetY
    };
  }

  // =========================================================================
  // 4. GAME INITIALIZATION & TURN MANAGEMENT
  // =========================================================================

  function startNewGame(modeIdx = state.gameModeIndex) {
    state.gameModeIndex = modeIdx;
    state.frameCounter = 0;
    state.gameActive = true;
    state.currentPlayer = 0;
    state.currentFrame = 1;
    state.rollInFrame = 0;
    state.players = [createPlayerScoreState(), createPlayerScoreState()];
    state.particles = [];
    state.floatingTexts = [];

    initPinsRack();
    resetBowlerForNextBall(true);
    updateScoreboardDOM();
    updateHUD();
  }

  function resetBowlerForNextBall(keepVerticalPos = false) {
    state.bowlerState = 0;
    if (!keepVerticalPos) {
      state.bowlerY = 14; // Centered nicely
    }
    state.bowlerX = ROM_APPROACH_BOWLER_X[0];
    state.ballX = state.bowlerX + ROM_APPROACH_BALL_DX[0];
    state.ballY = state.bowlerY + ROM_APPROACH_BALL_DY[0];
    state.lockedCurveDir = 0;
    state.activeSteerDir = 0;
    state.isCelebration = false;
    state.ballTrail = [];
    window.bowlingAudio.stopRolling();
    updateHUD();
  }

  // =========================================================================
  // 5. EXACT ROM PHYSICS & COLLISION STEP (60Hz)
  // =========================================================================

  function updatePhysicsTick() {
    state.frameCounter = (state.frameCounter + 1) & 0xFF;
    const mode = ROM_GAME_MODES[state.gameModeIndex];

    // Update particles & floating texts
    updateEffects();

    if (!state.gameActive) {
      // Attract / Game Over cycling color
      state.laneFlashHue = (state.frameCounter * 2) % 360;
      return;
    }

    // ---------------------------------------------------------------------
    // STATE 0: POSITIONING BOWLER BEFORE THROW ($8D == 0, ROM $F454-$F487)
    // ---------------------------------------------------------------------
    if (state.bowlerState === 0) {
      // Every 4th frame (LDA $80; AND #$03; BNE $F47F), move bowler up/down
      if ((state.frameCounter & 0x03) === 0) {
        if (state.keys.up && !state.keys.down) {
          if (state.bowlerY < 0x1C) {
            state.bowlerY++;
            window.bowlingAudio.playMoveTick();
          }
        } else if (state.keys.down && !state.keys.up) {
          if (state.bowlerY > 0x01) {
            state.bowlerY--;
            window.bowlingAudio.playMoveTick();
          }
        }
      }

      state.bowlerX = ROM_APPROACH_BOWLER_X[0];
      state.ballX = state.bowlerX + ROM_APPROACH_BALL_DX[0];
      state.ballY = state.bowlerY + ROM_APPROACH_BALL_DY[0];

      // Fire button pressed -> start approach ($8D = 1, $90 = 0)
      if (state.keys.throwPressed) {
        state.keys.throwPressed = false;
        state.lockedCurveDir = 0;
        state.activeSteerDir = 0;
        state.bowlerState = 1;
        window.bowlingAudio.playApproachStep(1);
        updateHUD();
      }
    }

    // ---------------------------------------------------------------------
    // STATES 1..4: 4-STEP APPROACH & SWING ANIMATION ($8D == 1..4, ROM $F489-$F495)
    // ---------------------------------------------------------------------
    else if (state.bowlerState >= 1 && state.bowlerState <= 4) {
      state.keys.throwPressed = false;
      const stepIdx = state.bowlerState;
      state.bowlerX = ROM_APPROACH_BOWLER_X[stepIdx];
      state.ballX = state.bowlerX + ROM_APPROACH_BALL_DX[stepIdx];
      state.ballY = state.bowlerY + ROM_APPROACH_BALL_DY[stepIdx];

      // Advance every 16 frames (LDA $80; AND #$0F; BNE $F497; INC $8D)
      if ((state.frameCounter & 0x0F) === 0) {
        state.bowlerState++;
        if (state.bowlerState <= 4) {
          window.bowlingAudio.playApproachStep(state.bowlerState);
        } else if (state.bowlerState === 5) {
          // Ball released onto the lane!
          window.bowlingAudio.startRolling();
          updateHUD();
        }
      }
    }

    // ---------------------------------------------------------------------
    // STATE 5: BALL ROLLING DOWN THE LANE ($8D == 5, ROM $F49A-$F4B7 & $F60A-$F629)
    // ---------------------------------------------------------------------
    else if (state.bowlerState === 5) {
      state.keys.throwPressed = false;
      state.ballSpinAngle += 0.38;

      // Advance ball X every 2 frames (LDA $80; AND #$01; BNE; INC $9E)
      if ((state.frameCounter & 0x01) === 0) {
        state.ballX++;

        // Record trail point
        const bx = romBallXToCanvasX(state.ballX);
        const by = rowAFToCanvasY(state.ballY + 2);
        state.ballTrail.push({ x: bx, y: by, alpha: 0.75 });
        if (state.ballTrail.length > 22) state.ballTrail.shift();

        // Check if ball reached the pit at the end of the lane (CMP #$8C; BCS $F4B7)
        if (state.ballX >= 0x8C) {
          window.bowlingAudio.stopRolling();
          state.bowlerState = 6; // Return / Pin sweep phase
          return;
        }

        // Steering / Curve logic ($F4A8-$F4B4 -> $F60A-$F629)
        // Only active if mode is NOT 'straight' (ROM bit 5 = $20)
        // and only when ball is still in lane bounds (0 < ballY < 28)
        const inGutter = (state.ballY <= 0 || state.ballY >= 0x1D);
        if (mode.type !== 'straight' && !inGutter) {
          // Every 8 frames (LDA $80; AND #$07; BNE $F497)
          if ((state.frameCounter & 0x07) === 0) {
            let joyDir = 0; // 1 = UP, 2 = DOWN
            if (state.keys.up && !state.keys.down) joyDir = 1;
            else if (state.keys.down && !state.keys.up) joyDir = 2;

            if (mode.type === 'steer') {
              // Bit 6 ($40) set: Steerable ball reads live joystick every 8 frames
              state.lockedCurveDir = joyDir;
            } else if (mode.type === 'curve') {
              // Bit 6 ($40) clear: Curve ball locks direction on first Up/Down input!
              if (state.lockedCurveDir === 0 && joyDir !== 0) {
                state.lockedCurveDir = joyDir;
                spawnFloatingText(
                  romBallXToCanvasX(state.ballX),
                  rowAFToCanvasY(state.ballY + 2) - 18,
                  joyDir === 1 ? 'EFEITO ▲' : 'EFEITO ▼',
                  '#00f0ff'
                );
              }
            }

            state.activeSteerDir = state.lockedCurveDir;

            // Apply vertical movement ($F618-$F629)
            if (state.lockedCurveDir === 1) {
              // Move UP (INC $A9 up to $1C)
              if (state.ballY + 1 < 0x1D) {
                state.ballY++;
                if (state.ballY === 0x1C) {
                  window.bowlingAudio.playGutter();
                  spawnFloatingText(romBallXToCanvasX(state.ballX), LANE.topGutterY + 16, 'CANALETA!', '#ff2a85');
                }
              }
            } else if (state.lockedCurveDir === 2) {
              // Move DOWN (DEC $A9 down to 0)
              if (state.ballY > 0) {
                state.ballY--;
                if (state.ballY === 0) {
                  window.bowlingAudio.playGutter();
                  spawnFloatingText(romBallXToCanvasX(state.ballX), LANE.bottomGutterY - 12, 'CANALETA!', '#ff2a85');
                }
              }
            }
          }
        }
      }

      // Update rolling sound pan & frequency
      const progress = Math.max(0, Math.min(1, (state.ballX - 0x18) / (0x8C - 0x18)));
      window.bowlingAudio.updateRolling(progress, state.lockedCurveDir !== 0);

      // -------------------------------------------------------------------
      // BALL-TO-PIN COLLISION CHECK ($F378-$F3D7)
      // -------------------------------------------------------------------
      // In ROM: SEC; LDA $9E; SBC #$70; LSR; EOR #$07; CMP #$08
      if (state.ballX >= 0x70 && state.ballX < 0x80) {
        const colD5 = ((state.ballX - 0x70) >> 1) ^ 0x07; // Maps 0x70..0x7F to columns 7..0
        for (let i = 9; i >= 0; i--) {
          const pin = state.pins[i];
          if (!pin.standing || pin.cleared || pin.c3 !== 0) continue;

          // Match column B9[i] == colD5 or colD5 - 1 ($F391-$F39E)
          if (pin.b9 === colD5 || (colD5 - 1 >= 0 && pin.b9 === colD5 - 1)) {
            // Vertical overlap check ($F3A0-$F3AA): D5 = AF[i] - A9 + 1; hit if 0 <= D5 < 6
            const hitOffset = pin.af - state.ballY + 1;
            if (hitOffset >= 0 && hitOffset < 6) {
              // Ball deflects vertically off the pin! ($F3B3-$F3BC)
              if (hitOffset >= 3) {
                state.ballY = Math.max(0, state.ballY - 1);
              } else {
                state.ballY = Math.min(0x1C, state.ballY + 1);
              }

              // Determine Difficulty A/B table index ($F3BD-$F3CF)
              // Difficulty B (Standard): Carry = 0 -> even indices of $F7A6 (wider pin scatter)
              // Difficulty A (Expert): Carry = bit 7 of $80 -> odd/even indices (tighter pin scatter)
              const playerDiff = state.difficulty[state.currentPlayer];
              let carryBit = 0;
              if (playerDiff === 'A') {
                carryBit = (state.frameCounter & 0x80) ? 1 : 1; // Pro mode uses odd indices for demanding pocket hits
              }
              const velIndex = ((hitOffset << 1) | carryBit) % ROM_PIN_VEL_TABLE.length;
              pin.c3 = ROM_PIN_VEL_TABLE[velIndex];
              pin.hitFlash = 1.0;
              pin.visSpin = (hitOffset >= 3 ? 1 : -1) * (0.22 + Math.random() * 0.15);

              spawnPinHitParticles(pin.visX, pin.visY);
              window.bowlingAudio.playPinHit(1);
              break; // ROM processes 1 direct ball-pin hit per frame
            }
          }
        }
      }
    }

    // ---------------------------------------------------------------------
    // STATE 6: BALL RETURN, PIN SWEEP & SCORING ($8D >= 6, ROM $F4B9-$F607)
    // ---------------------------------------------------------------------
    else if (state.bowlerState === 6) {
      // Ball returns along the bottom return track ($F4BF: DEC $9E)
      state.ballY = 1;
      state.ballX -= 2; // Smooth return speed

      // At $9E == $70 (or <= $70), sweep knocked-down pins ($F4FF-$F51E)
      if (state.ballX <= 0x70 && state.pinSweepProgress === 0) {
        state.pinSweepProgress = 1;
        let newlyKnocked = 0;
        for (let i = 0; i < 10; i++) {
          const pin = state.pins[i];
          if (!pin.cleared && (!pin.standing || pin.c3 !== 0)) {
            pin.standing = false;
            pin.cleared = true;
            pin.c3 = 0;
            pin.b9 = 0xFF;
            newlyKnocked++;
          }
        }
        state.knockedTotalInSet += newlyKnocked;

        // Trigger Strike / Spare celebration if all 10 pins in the rack are down! ($F4D5: LDA $A3; CMP #$10)
        if (state.knockedTotalInSet === 10) {
          state.isCelebration = true;
          const isStrike = (state.rollInFrame === 0);
          window.bowlingAudio.playCelebration(isStrike ? 'strike' : 'spare');
          spawnFloatingText(
            LANE.foulLineX + 280,
            (LANE.laneTopY + LANE.laneBottomY) / 2,
            isStrike ? '⚡ STRIKE! ⚡' : '✨ SPARE! ✨',
            isStrike ? '#00f0ff' : '#00e676',
            true
          );
        } else if (newlyKnocked === 0) {
          spawnFloatingText(
            LANE.foulLineX + 260,
            (LANE.laneTopY + LANE.laneBottomY) / 2,
            '0 PINOS',
            '#94a3b8'
          );
        }
      }

      // Celebration animation while ball returns ($F4DB-$F4FD)
      if (state.isCelebration) {
        state.laneFlashHue = (state.frameCounter * 7) % 360;
        if ((state.frameCounter & 0x0F) === 0) {
          state.celebrationPose ^= 1;
          state.bowlerY = state.celebrationPose ? 18 : 14;
        }
      }

      // Stop early at $52 on 1st ball if not all 10 pins knocked down ($F4CD-$F4D3)
      const stopX = (state.rollInFrame === 0 && state.knockedTotalInSet < 10) ? 0x38 : 0x06;
      if (state.ballX <= stopX) {
        state.pinSweepProgress = 0;
        completeRollAndScore();
      }
    }

    // ---------------------------------------------------------------------
    // MOVING PINS & PIN-TO-PIN CHAIN COLLISIONS ($F3D8-$F444)
    // ---------------------------------------------------------------------
    updateMovingPinsROM();
  }

  function updateMovingPinsROM() {
    // ROM processes 4 pins per frame in round-robin order ($F3D8: LDA #$03; STA $D5)
    for (let step = 0; step < 4; step++) {
      let idx = state.pinMoveRoundRobin;
      const pin = state.pins[idx];

      if (pin && !pin.cleared && pin.c3 > 0 && pin.c3 < 0x80) {
        // Low nibble = signed 4-bit vertical delta dAF ($F3E9-$F3F7)
        let dAF = pin.c3 & 0x0F;
        if (dAF >= 8) dAF -= 16;
        pin.af += dAF;

        // High nibble = horizontal delta subtracted from B9 ($F401-$F410)
        const dB9 = (pin.c3 >> 4) & 0x0F;

        if (pin.af < 0 || pin.af >= 0x22) {
          // Pin flew off top/bottom of pin deck -> knocked down ($F3F9-$F3FF)
          pin.b9 = -1;
          pin.c3 = 0xFF;
          pin.standing = false;
        } else {
          pin.b9 -= dB9;
          if (pin.b9 < 0) {
            // Pin flew into the pit at the back -> knocked down ($F412-$F416)
            pin.c3 = 0xFF;
            pin.standing = false;
          } else {
            // Check pin-to-pin collision with all other standing pins ($F41D-$F439)
            for (let y = 9; y >= 0; y--) {
              if (y === idx) continue;
              const other = state.pins[y];
              if (!other.standing || other.cleared || other.c3 !== 0) continue;

              // Same horizontal column B9 and vertical distance |other.af - pin.af| <= 2
              if (other.b9 === pin.b9) {
                const diffAF = other.af - pin.af + 2;
                if (diffAF >= 0 && diffAF < 5) {
                  other.c3 = pin.c3;
                  other.hitFlash = 1.0;
                  other.visSpin = (Math.random() > 0.5 ? 1 : -1) * 0.28;
                  spawnPinHitParticles(other.visX, other.visY);
                  window.bowlingAudio.playPinHit(2);
                }
              }
            }
          }
        }
      }

      idx--;
      if (idx < 0) idx = 9;
      state.pinMoveRoundRobin = idx;
    }

    // Smooth 60fps visual interpolation of pin positions
    for (let i = 0; i < 10; i++) {
      const pin = state.pins[i];
      if (pin.hitFlash > 0) pin.hitFlash = Math.max(0, pin.hitFlash - 0.06);

      if (pin.c3 !== 0 || !pin.standing) {
        const targetX = pin.b9 >= 0 ? columnB9ToCanvasX(pin.b9) : LANE.pitX + 28;
        const targetY = rowAFToCanvasY(Math.max(-2, Math.min(35, pin.af + 0.5)));
        pin.visX += (targetX - pin.visX) * 0.28;
        pin.visY += (targetY - pin.visY) * 0.28;
        pin.visAngle += pin.visSpin;
      } else {
        pin.visX = columnB9ToCanvasX(pin.b9);
        pin.visY = rowAFToCanvasY(pin.af + 0.5);
        pin.visAngle = 0;
      }
    }
  }

  // =========================================================================
  // 6. OFFICIAL 10-FRAME BOWLING SCORING (ROM $F523-$F607)
  // =========================================================================

  function completeRollAndScore() {
    const pIdx = state.currentPlayer;
    const player = state.players[pIdx];
    const fIdx = state.currentFrame - 1; // 0..9
    const frameObj = player.frames[fIdx];

    // Calculate pins knocked down on this specific roll
    const standingNow = state.pins.filter(p => p.standing && !p.cleared).length;
    const knockedThisRoll = state.standingBeforeRoll - standingNow;
    state.standingBeforeRoll = standingNow;

    player.rollsFlat.push(knockedThisRoll);
    frameObj.rolls.push(knockedThisRoll);

    // Recalculate standard 10-frame bowling scores across all frames
    recalculateBowlingScores(player);

    // Determine whether frame continues, rack resets, or turn switches
    if (state.currentFrame < 10) {
      if (state.rollInFrame === 0) {
        if (knockedThisRoll === 10) {
          // STRIKE! Frame complete immediately ($F560-$F567)
          frameObj.atariMarker = 'strike';
          advanceTurnOrFrame();
        } else {
          // Proceed to 2nd ball of the frame ($F54D-$F55F)
          state.rollInFrame = 1;
          resetBowlerForNextBall(true);
        }
      } else {
        // 2nd ball of frames 1..9 complete ($F56A-$F596)
        const frameTotalPins = frameObj.rolls[0] + frameObj.rolls[1];
        frameObj.atariMarker = (frameTotalPins === 10) ? 'spare' : 'open';
        advanceTurnOrFrame();
      }
    } else {
      // -------------------------------------------------------------------
      // 10th FRAME SPECIAL BONUS RULES (ROM $F59A-$F605)
      // -------------------------------------------------------------------
      const r = frameObj.rolls;
      if (r.length === 1) {
        if (r[0] === 10) {
          // Strike on 1st ball of 10th frame -> gets 2 bonus balls! Fresh rack!
          frameObj.atariMarker = 'strike';
          state.rollInFrame = 1;
          initPinsRack();
          resetBowlerForNextBall(true);
        } else {
          // Need 2nd ball in 10th frame
          state.rollInFrame = 1;
          resetBowlerForNextBall(true);
        }
      } else if (r.length === 2) {
        if (r[0] === 10) {
          // Currently on 1st bonus ball after 10th-frame Strike; 1 more bonus ball remains!
          state.rollInFrame = 2;
          if (r[1] === 10) {
            // Double strike in 10th -> fresh rack for 3rd ball!
            initPinsRack();
          }
          resetBowlerForNextBall(true);
        } else if (r[0] + r[1] === 10) {
          // Spare in 10th frame -> gets 1 bonus ball with fresh rack!
          frameObj.atariMarker = 'spare';
          state.rollInFrame = 2;
          initPinsRack();
          resetBowlerForNextBall(true);
        } else {
          // Open 10th frame -> finished!
          frameObj.atariMarker = 'open';
          advanceTurnOrFrame();
        }
      } else {
        // 3rd ball of 10th frame finished!
        advanceTurnOrFrame();
      }
    }

    updateScoreboardDOM();
    updateHUD();
  }

  function advanceTurnOrFrame() {
    const mode = ROM_GAME_MODES[state.gameModeIndex];
    state.rollInFrame = 0;

    if (mode.players === 2) {
      if (state.currentPlayer === 0) {
        // Switch to Player 2 for the same frame
        state.currentPlayer = 1;
        initPinsRack();
        resetBowlerForNextBall(false);
        return;
      } else {
        // Both players finished this frame
        state.currentPlayer = 0;
        if (state.currentFrame >= 10) {
          triggerGameOver();
          return;
        }
        state.currentFrame++;
        initPinsRack();
        resetBowlerForNextBall(false);
      }
    } else {
      // 1 Player mode
      if (state.currentFrame >= 10) {
        triggerGameOver();
        return;
      }
      state.currentFrame++;
      initPinsRack();
      resetBowlerForNextBall(false);
    }
  }

  function triggerGameOver() {
    state.gameActive = false;
    state.bowlerState = 0;
    window.bowlingAudio.stopRolling();
    window.bowlingAudio.playCelebration('gameover');

    const mode = ROM_GAME_MODES[state.gameModeIndex];
    const p1Score = state.players[0].romScore;
    const p2Score = state.players[1].romScore;

    let msg = `FIM DE JOGO! PLACAR: ${p1Score}`;
    if (p1Score === 300) msg = '🏆 JOGO PERFEITO: 300 PONTOS! 🏆';
    else if (mode.players === 2) {
      if (p1Score > p2Score) msg = `🏆 JOGADOR 1 VENCEU! (${p1Score} a ${p2Score})`;
      else if (p2Score > p1Score) msg = `🏆 JOGADOR 2 VENCEU! (${p2Score} a ${p1Score})`;
      else msg = `🤝 EMPATE! (${p1Score} a ${p2Score})`;
    }

    spawnFloatingText(
      canvas.width / 2,
      (LANE.laneTopY + LANE.laneBottomY) / 2,
      msg,
      '#ffb800',
      true
    );
    updateHUD();
    checkAndPromptHighScoresOnGameOver();
  }

  function recalculateBowlingScores(player) {
    const rolls = player.rollsFlat;
    let rollIndex = 0;
    let runningTotal = 0;

    for (let f = 0; f < 10; f++) {
      const frameObj = player.frames[f];
      if (rollIndex >= rolls.length) {
        frameObj.cumulativeScore = null;
        continue;
      }

      const first = rolls[rollIndex];
      if (first === 10) {
        // Strike: 10 + next 2 rolls (in ROM, score updates immediately with 10 and adds bonus rolls as they happen)
        const bonus1 = (rollIndex + 1 < rolls.length) ? rolls[rollIndex + 1] : 0;
        const bonus2 = (rollIndex + 2 < rolls.length) ? rolls[rollIndex + 2] : 0;
        runningTotal += 10 + bonus1 + bonus2;
        frameObj.cumulativeScore = runningTotal;
        rollIndex += 1;
      } else if (rollIndex + 1 < rolls.length) {
        const second = rolls[rollIndex + 1];
        if (first + second === 10) {
          // Spare: 10 + next 1 roll
          const bonus1 = (rollIndex + 2 < rolls.length) ? rolls[rollIndex + 2] : 0;
          runningTotal += 10 + bonus1;
          frameObj.cumulativeScore = runningTotal;
        } else {
          // Open frame
          runningTotal += first + second;
          frameObj.cumulativeScore = runningTotal;
        }
        rollIndex += 2;
      } else {
        // Mid-frame (after 1st non-strike ball): show live partial score like Atari 2600
        frameObj.cumulativeScore = runningTotal + first;
        break;
      }
    }

    player.romScore = runningTotal;
  }

  // =========================================================================
  // 7. PARTICLES & VISUAL CALLOUTS
  // =========================================================================

  function spawnPinHitParticles(x, y) {
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4.5;
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.5 + Math.random() * 3.5,
        color: Math.random() > 0.35 ? '#ffffff' : '#ff2a85',
        alpha: 1.0
      });
    }
  }

  function spawnFloatingText(x, y, text, color = '#00f0ff', big = false) {
    state.floatingTexts.push({
      x,
      y,
      text,
      color,
      big,
      alpha: 1.0,
      vy: big ? -0.45 : -0.9
    });
  }

  function updateEffects() {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.alpha -= 0.032;
      if (p.alpha <= 0) state.particles.splice(i, 1);
    }

    for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
      const ft = state.floatingTexts[i];
      ft.y += ft.vy;
      ft.alpha -= ft.big ? 0.011 : 0.022;
      if (ft.alpha <= 0) state.floatingTexts.splice(i, 1);
    }

    for (let i = state.ballTrail.length - 1; i >= 0; i--) {
      state.ballTrail[i].alpha -= 0.03;
      if (state.ballTrail[i].alpha <= 0) state.ballTrail.splice(i, 1);
    }
  }

  // =========================================================================
  // 8. RENDERING (MODERN HD NEON ALLEY + CLASSIC ATARI 2600 CRT MODE)
  // =========================================================================

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (state.visualMode === 'atari') {
      renderClassicAtariMode();
    } else {
      renderModernHDMode();
    }
  }

  // -------------------------------------------------------------------------
  // A. MODERN HD NEON BOWLING ALLEY RENDERER
  // -------------------------------------------------------------------------
  function renderModernHDMode() {
    // 1. Ambient dark arena background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGrad.addColorStop(0, '#070b18');
    bgGrad.addColorStop(0.5, '#0d1428');
    bgGrad.addColorStop(1, '#060913');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Top & Bottom Gutters (dark metallic channels)
    drawGutterChannel(LANE.leftX, LANE.topGutterY, LANE.pitX - LANE.leftX, LANE.laneTopY - LANE.topGutterY);
    drawGutterChannel(LANE.leftX, LANE.laneBottomY, LANE.pitX - LANE.leftX, LANE.bottomGutterY - LANE.laneBottomY);

    // 3. Hardwood Maple Bowling Lane with individual wood planks & reflections
    const laneW = LANE.pitX - LANE.leftX;
    const laneH = LANE.laneBottomY - LANE.laneTopY;

    ctx.save();
    if (state.isCelebration || !state.gameActive) {
      // Celebration neon glow along the lane (modern tribute to ROM $F4DB color cycling)
      const glowGrad = ctx.createLinearGradient(LANE.leftX, LANE.laneTopY, LANE.pitX, LANE.laneBottomY);
      glowGrad.addColorStop(0, `hsla(${state.laneFlashHue}, 85%, 45%, 0.92)`);
      glowGrad.addColorStop(1, `hsla(${(state.laneFlashHue + 70) % 360}, 85%, 35%, 0.92)`);
      ctx.fillStyle = glowGrad;
    } else {
      const woodGrad = ctx.createLinearGradient(LANE.leftX, 0, LANE.pitX, 0);
      woodGrad.addColorStop(0, '#d99b52');
      woodGrad.addColorStop(0.18, '#e8b06b');
      woodGrad.addColorStop(0.75, '#f2c17d');
      woodGrad.addColorStop(0.95, '#d59348');
      woodGrad.addColorStop(1, '#9c6224');
      ctx.fillStyle = woodGrad;
    }
    ctx.fillRect(LANE.leftX, LANE.laneTopY, laneW, laneH);

    // Draw 20 thin horizontal maple planks
    const numPlanks = 20;
    const plankH = laneH / numPlanks;
    for (let i = 0; i < numPlanks; i++) {
      const py = LANE.laneTopY + i * plankH;
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(120, 62, 12, 0.08)';
        ctx.fillRect(LANE.leftX, py, laneW, plankH);
      }
      ctx.strokeStyle = 'rgba(92, 45, 10, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(LANE.leftX, py);
      ctx.lineTo(LANE.pitX, py);
      ctx.stroke();
    }

    // Glossy overhead light reflection on the oiled lane
    const sheenGrad = ctx.createLinearGradient(0, LANE.laneTopY, 0, LANE.laneBottomY);
    sheenGrad.addColorStop(0, 'rgba(255,255,255,0.16)');
    sheenGrad.addColorStop(0.35, 'rgba(255,255,255,0.03)');
    sheenGrad.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    sheenGrad.addColorStop(0.65, 'rgba(255,255,255,0.03)');
    sheenGrad.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = sheenGrad;
    ctx.fillRect(LANE.leftX, LANE.laneTopY, laneW, laneH);

    // 4. Foul Line, Approach Dots, and Target Arrows on the Lane
    // Foul Line
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(LANE.foulLineX, LANE.laneTopY);
    ctx.lineTo(LANE.foulLineX, LANE.laneBottomY);
    ctx.stroke();

    // Glowing Neon Border Strips (Top & Bottom lane edges)
    const pColor = state.currentPlayer === 0 ? '#00f0ff' : '#fb923c';
    ctx.shadowColor = pColor;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = pColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(LANE.leftX, LANE.laneTopY);
    ctx.lineTo(LANE.pitX, LANE.laneTopY);
    ctx.moveTo(LANE.leftX, LANE.laneBottomY);
    ctx.lineTo(LANE.pitX, LANE.laneBottomY);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Approach alignment dots
    ctx.fillStyle = 'rgba(40, 20, 5, 0.55)';
    for (let d = -3; d <= 3; d++) {
      const dy = (LANE.laneTopY + LANE.laneBottomY) / 2 + d * 42;
      ctx.beginPath();
      ctx.arc(LANE.foulLineX - 30, dy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Classic chevron target arrows on the lane
    const arrowCenterY = (LANE.laneTopY + LANE.laneBottomY) / 2;
    for (let a = -3; a <= 3; a++) {
      const ax = LANE.foulLineX + 165 - Math.abs(a) * 18;
      const ay = arrowCenterY + a * 40;
      ctx.fillStyle = Math.abs(a) === 1 ? 'rgba(220, 38, 38, 0.65)' : 'rgba(92, 45, 10, 0.55)';
      ctx.beginPath();
      ctx.moveTo(ax + 14, ay);
      ctx.lineTo(ax - 8, ay - 6);
      ctx.lineTo(ax - 4, ay);
      ctx.lineTo(ax - 8, ay + 6);
      ctx.closePath();
      ctx.fill();
    }

    // 5. Aiming Guide Line during Positioning (State 0)
    if (state.bowlerState === 0 && state.gameActive) {
      const pose = getBowlerAndHeldBallCanvasPos();
      ctx.save();
      ctx.setLineDash([8, 8]);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.55)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(pose.ballX + 16, pose.ballY);
      ctx.lineTo(LANE.pinDeckStartX + 20, pose.ballY);
      ctx.stroke();
      ctx.restore();
    }

    // 6. Dark Pit at the right end of the Pin Deck
    const pitGrad = ctx.createLinearGradient(LANE.pitX - 10, 0, LANE.pitX + 45, 0);
    pitGrad.addColorStop(0, '#1a0f07');
    pitGrad.addColorStop(0.3, '#05070e');
    pitGrad.addColorStop(1, '#020307');
    ctx.fillStyle = pitGrad;
    ctx.fillRect(LANE.pitX, LANE.topGutterY, 50, LANE.bottomGutterY - LANE.topGutterY);

    ctx.restore();

    // 7. Pin Deck Spots & 3D-Shaded Pins
    drawPinDeckSpots();
    drawModernPins();

    // 8. Ball Motion Trail & Rolling Bowling Ball (when released)
    if (state.bowlerState >= 5) {
      drawModernBall();
    }

    // 9. Modern Articulated Bowler Character (with ball held close in hand for states 0..4)
    drawModernBowler();

    // 10. Particles & Floating Callout Texts
    drawParticlesAndCallouts();
  }

  function drawGutterChannel(x, y, w, h) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#090d1a');
    g.addColorStop(0.5, '#1e293b');
    g.addColorStop(1, '#090d1a');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }

  function drawPinDeckSpots() {
    for (let i = 0; i < 10; i++) {
      const sx = columnB9ToCanvasX(ROM_PIN_INIT_B9[i]);
      const sy = rowAFToCanvasY(ROM_PIN_INIT_AF[i] + 0.5);
      ctx.fillStyle = 'rgba(60, 30, 10, 0.38)';
      ctx.beginPath();
      ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawModernPins() {
    // Sort pins by Y so lower pins naturally overlap higher pins slightly
    const sorted = [...state.pins].sort((a, b) => a.visY - b.visY);

    for (const pin of sorted) {
      if (pin.cleared) continue;

      ctx.save();
      ctx.translate(pin.visX, pin.visY);
      ctx.rotate(pin.visAngle);

      // Drop shadow on wood lane
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.ellipse(3, 5, 11, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      // Pin body (ivory white 3D gradient with red stripes)
      const pinGrad = ctx.createRadialGradient(-3, -3, 2, 0, 0, 13);
      if (pin.hitFlash > 0) {
        pinGrad.addColorStop(0, '#ffffff');
        pinGrad.addColorStop(1, '#00f0ff');
      } else {
        pinGrad.addColorStop(0, '#ffffff');
        pinGrad.addColorStop(0.7, '#f1f5f9');
        pinGrad.addColorStop(1, '#cbd5e1');
      }

      ctx.fillStyle = pinGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();

      // Red crown ring (classic bowling pin neck stripe seen from top-oblique angle)
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, 0, 6.8, 0, Math.PI * 2);
      ctx.stroke();

      // Pin number label
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 9px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(pin.number), 0, 0.5);

      ctx.restore();
    }
  }

  function drawBallSphereAt(bx, by, radius = 13.5, drawShadow = true) {
    ctx.save();
    ctx.translate(bx, by);

    if (drawShadow) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
      ctx.beginPath();
      ctx.ellipse(3, 5, radius, radius * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3D Sphere Gradient (Blue for P1, Sunset Orange for P2)
    const ballGrad = ctx.createRadialGradient(-4.5, -4.5, 2, 0, 0, radius);
    if (state.currentPlayer === 0) {
      ballGrad.addColorStop(0, '#7dd3fc');
      ballGrad.addColorStop(0.35, '#0284c7');
      ballGrad.addColorStop(1, '#082f49');
    } else {
      ballGrad.addColorStop(0, '#fdba74');
      ballGrad.addColorStop(0.35, '#ea580c');
      ballGrad.addColorStop(1, '#431407');
    }

    ctx.fillStyle = ballGrad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    // Rotating finger holes to show ball roll & hook spin
    ctx.rotate(state.ballSpinAngle);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    const holeOffset = Math.sin(state.ballSpinAngle) * 3.8;
    ctx.beginPath();
    ctx.arc(holeOffset - 2.8, -2.8, 2.0, 0, Math.PI * 2);
    ctx.arc(holeOffset + 2.8, -2.8, 2.0, 0, Math.PI * 2);
    ctx.arc(holeOffset, 2.8, 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawModernBall() {
    // Draw glowing spin/curve trail
    for (const pt of state.ballTrail) {
      ctx.fillStyle = state.lockedCurveDir !== 0
        ? `rgba(0, 240, 255, ${pt.alpha * 0.45})`
        : `rgba(56, 189, 248, ${pt.alpha * 0.3})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 9 * pt.alpha, 0, Math.PI * 2);
      ctx.fill();
    }

    const bx = romBallXToCanvasX(state.ballX);
    const by = rowAFToCanvasY(state.ballY + 2);
    drawBallSphereAt(bx, by, 13.5, true);
  }

  function drawModernBowler() {
    const pose = getBowlerAndHeldBallCanvasPos();
    const bx = pose.bowlerX;
    const by = pose.bowlerY;

    ctx.save();
    ctx.translate(bx, by);

    const isP1 = state.currentPlayer === 0;
    const jerseyMain = isP1 ? '#2563eb' : '#ea580c';
    const jerseyAccent = isP1 ? '#38bdf8' : '#fde047';

    // Determine pose from state.bowlerState (0 = stance holding ball, 1..2 = backswing, 3..4 = release lunge, celebration = jump)
    let bodyTilt = 0;
    let jumpOffset = 0;

    if (state.isCelebration) {
      jumpOffset = state.celebrationPose ? -14 : 0;
    } else if (state.bowlerState === 1) {
      bodyTilt = 0.05;
    } else if (state.bowlerState === 2 || state.bowlerState === 3) {
      bodyTilt = 0.14;
    } else if (state.bowlerState === 4 || state.bowlerState === 5) {
      bodyTilt = 0.2;
    }

    ctx.translate(0, jumpOffset);

    // Floor shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.beginPath();
    ctx.ellipse(2, 28 - jumpOffset, 18, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.rotate(bodyTilt);

    // Legs (side-profile Atari-inspired stance)
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 6.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (state.bowlerState >= 3 && state.bowlerState <= 5) {
      // Lunge stance at foul line
      ctx.moveTo(-3, 8);
      ctx.lineTo(-13, 25);
      ctx.moveTo(3, 8);
      ctx.lineTo(13, 24);
    } else {
      ctx.moveTo(-3, 8);
      ctx.lineTo(-5, 25);
      ctx.moveTo(3, 8);
      ctx.lineTo(6, 25);
    }
    ctx.stroke();

    // Bowling shoes
    ctx.fillStyle = '#f8fafc';
    if (state.bowlerState >= 3 && state.bowlerState <= 5) {
      ctx.beginPath();
      ctx.ellipse(-12, 26, 6.5, 3.5, 0, 0, Math.PI * 2);
      ctx.ellipse(14, 25, 6.5, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(-4, 26, 6.5, 3.5, 0, 0, Math.PI * 2);
      ctx.ellipse(7, 26, 6.5, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Back Support Arm (reaching toward ball when holding in front)
    if (state.bowlerState <= 1 || state.bowlerState === 4) {
      ctx.strokeStyle = '#f5d0fe';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(4, -6);
      ctx.lineTo(14, -2);
      ctx.stroke();
    }

    // Torso (Retro Bowling Shirt with vertical stripe)
    ctx.fillStyle = jerseyMain;
    ctx.beginPath();
    ctx.roundRect(-10, -14, 20, 24, 6);
    ctx.fill();

    ctx.fillStyle = jerseyAccent;
    ctx.fillRect(-2, -14, 5, 24);

    // Head (Side-profile facing right toward pins, like Atari 2600)
    ctx.fillStyle = '#fbcfe8';
    ctx.beginPath();
    ctx.arc(2, -23, 9, 0, Math.PI * 2);
    ctx.fill();

    // Hair & Retro Headband
    ctx.fillStyle = '#1e1b4b';
    ctx.beginPath();
    ctx.arc(0, -25, 9.2, Math.PI * 0.8, Math.PI * 2.05);
    ctx.fill();

    ctx.strokeStyle = jerseyAccent;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(-7, -25);
    ctx.lineTo(10, -25);
    ctx.stroke();

    ctx.restore(); // undo bodyTilt so ball & cradling hand sit at exact pose offset

    // Draw the Bowling Ball HELD CLOSE in the bowler's hand during states 0..4
    if (state.bowlerState <= 4) {
      const localBallX = pose.ballX - bx;
      const localBallY = pose.ballY - by;
      drawBallSphereAt(localBallX, localBallY, 12.5, false);

      // Front Arm & Hand cradling the ball (just like the Atari 2600 bowler sprite!)
      ctx.strokeStyle = '#fbcfe8';
      ctx.lineWidth = 5.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(2, -5); // shoulder
      if (state.bowlerState === 0 || state.bowlerState === 1 || state.bowlerState === 4) {
        // Forearm extends forward & cups the bottom-back of the ball
        ctx.lineTo(localBallX - 10, localBallY + 5);
        ctx.lineTo(localBallX - 2, localBallY + 8);
      } else {
        // Backswing arm holding ball behind/beside hip
        ctx.lineTo(localBallX + 4, localBallY - 4);
      }
      ctx.stroke();
    } else {
      // Follow-through / Celebration arm after ball is released
      ctx.strokeStyle = '#fbcfe8';
      ctx.lineWidth = 5.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(3, -6);
      if (state.isCelebration && state.celebrationPose) {
        ctx.lineTo(14, -22); // Arms raised in victory!
      } else {
        ctx.lineTo(18, -12); // Classic bowling follow-through pose
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawParticlesAndCallouts() {
    for (const p of state.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const ft of state.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.font = ft.big ? '900 34px Segoe UI, sans-serif' : '800 16px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    // Arcade Cabinet Author Credit Watermark on Canvas
    ctx.save();
    ctx.font = '700 11px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.fillText('REMASTER BY GITHUB.COM/REALZURR', canvas.width - 18, canvas.height - 14);
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // B. CLASSIC ATARI 2600 CRT RENDERER (EXACT ROM SPRITES & PALETTE)
  // -------------------------------------------------------------------------
  function renderClassicAtariMode() {
    // Classic NTSC Bowling Colors from ROM $F722:
    // COLUBK = $D8 (Green-Gold Lane) / $26 (Gold Gutters), COLUP0/P1 = Blue ($84) / Red ($44), COLUPF = $58
    const laneColor = state.isCelebration
      ? `hsl(${state.laneFlashHue}, 75%, 45%)`
      : '#c88828';
    const bgColor = '#385828';
    const pColor = state.currentPlayer === 0 ? '#4078f0' : '#e85040';

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Classic blocky lane
    ctx.fillStyle = laneColor;
    ctx.fillRect(LANE.leftX, LANE.laneTopY, LANE.pitX - LANE.leftX, LANE.laneBottomY - LANE.laneTopY);

    // Top & Bottom Playfield Borders
    ctx.fillStyle = '#503090';
    ctx.fillRect(LANE.leftX, LANE.laneTopY - 10, LANE.pitX - LANE.leftX, 10);
    ctx.fillRect(LANE.leftX, LANE.laneBottomY, LANE.pitX - LANE.leftX, 10);

    // Foul line
    ctx.fillStyle = '#000000';
    ctx.fillRect(LANE.foulLineX, LANE.laneTopY, 6, LANE.laneBottomY - LANE.laneTopY);

    // Draw 10 Pins as authentic 2-scanline Atari rectangular blocks ($F6BA-$F6EC)
    ctx.fillStyle = pColor;
    for (const pin of state.pins) {
      if (pin.cleared) continue;
      ctx.fillRect(Math.round(pin.visX - 8), Math.round(pin.visY - 8), 16, 16);
    }

    const pose = getBowlerAndHeldBallCanvasPos();

    // Draw Ball using ROM $F72E widths (2, 3, 3, 3, 2)
    // When held (states 0..4), ball is right next to the Atari bowler's hand on the release line
    const bx = Math.round(state.bowlerState <= 4 ? pose.ballX + 4 : romBallXToCanvasX(state.ballX));
    const by = Math.round(state.bowlerState <= 4 ? pose.ballY : rowAFToCanvasY(state.ballY + 2));
    ctx.fillStyle = pColor;
    ctx.fillRect(bx - 7, by - 9, 14, 3);
    ctx.fillRect(bx - 10, by - 6, 20, 12);
    ctx.fillRect(bx - 7, by + 6, 14, 3);

    // Draw Bowler using exact 8x12 bitmap from ROM ($F7B8, $F7C8, $F7D8)
    let spriteIdx = 0;
    if (state.isCelebration) {
      spriteIdx = state.celebrationPose ? 2 : 0;
    } else if (state.bowlerState === 2 || state.bowlerState === 3) {
      spriteIdx = 1;
    } else if (state.bowlerState === 4 || state.bowlerState === 5) {
      spriteIdx = 2;
    }

    const bitmap = ROM_BOWLER_SPRITES[spriteIdx];
    const pixW = 4;
    const pixH = 5;
    // Align row 7 (the outstretched hand of the 12-row Atari sprite) with pose.bowlerY!
    const bowlerLeft = Math.round(pose.bowlerX - 18);
    const bowlerBottom = Math.round(pose.bowlerY + 7 * pixH);

    for (let row = 0; row < 12; row++) {
      const byte = bitmap[row];
      // Row 0 in ROM is shoes ($D2 = black), rows 1..5 pants, rows 6..11 shirt/head
      if (row === 0) ctx.fillStyle = '#111111';
      else if (row < 6) ctx.fillStyle = pColor;
      else ctx.fillStyle = state.currentPlayer === 0 ? '#68a0ff' : '#ff8870';

      for (let bit = 0; bit < 8; bit++) {
        if ((byte >> (7 - bit)) & 1) {
          ctx.fillRect(
            bowlerLeft + bit * pixW,
            bowlerBottom - (row + 1) * pixH,
            pixW,
            pixH
          );
        }
      }
    }

    drawParticlesAndCallouts();
  }

  // =========================================================================
  // 9. SCOREBOARD DOM & HUD UPDATES
  // =========================================================================

  function buildScoreboardGrids() {
    ['p1FramesGrid', 'p2FramesGrid'].forEach((gridId, pIdx) => {
      const container = document.getElementById(gridId);
      container.innerHTML = '';
      for (let f = 1; f <= 10; f++) {
        const cell = document.createElement('div');
        cell.className = 'frame-cell';
        cell.id = `p${pIdx + 1}-frame-${f}`;

        const rollsHtml = f < 10
          ? `<div class="roll-box" id="p${pIdx + 1}-f${f}-r1"></div>
             <div class="roll-box" id="p${pIdx + 1}-f${f}-r2"></div>`
          : `<div class="roll-box" id="p${pIdx + 1}-f${f}-r1"></div>
             <div class="roll-box" id="p${pIdx + 1}-f${f}-r2"></div>
             <div class="roll-box" id="p${pIdx + 1}-f${f}-r3"></div>`;

        cell.innerHTML = `
          <div class="frame-num">${f}</div>
          <div class="frame-rolls">${rollsHtml}</div>
          <div class="frame-atari-bar" id="p${pIdx + 1}-f${f}-atari" title="Marcador Clássico Atari"></div>
          <div class="frame-running" id="p${pIdx + 1}-f${f}-score"></div>
        `;
        container.appendChild(cell);
      }
    });
  }

  function formatRollSymbol(frameIdx, rolls, rollPos) {
    if (rollPos >= rolls.length) return { text: '', cls: '' };
    const val = rolls[rollPos];

    if (frameIdx < 9) {
      if (rollPos === 0 && val === 10) return { text: '', cls: '' }; // Put X in box 2
      if (rollPos === 0) return { text: val === 0 ? '-' : String(val), cls: '' };
      if (rollPos === 1) {
        if (rolls[0] + val === 10) return { text: '/', cls: 'spare-mark' };
        return { text: val === 0 ? '-' : String(val), cls: '' };
      }
    } else {
      // 10th frame (3 boxes)
      if (rollPos === 0) {
        if (val === 10) return { text: 'X', cls: 'strike-mark' };
        return { text: val === 0 ? '-' : String(val), cls: '' };
      }
      if (rollPos === 1) {
        if (rolls[0] === 10) {
          if (val === 10) return { text: 'X', cls: 'strike-mark' };
          return { text: val === 0 ? '-' : String(val), cls: '' };
        }
        if (rolls[0] + val === 10) return { text: '/', cls: 'spare-mark' };
        return { text: val === 0 ? '-' : String(val), cls: '' };
      }
      if (rollPos === 2) {
        if (val === 10) return { text: 'X', cls: 'strike-mark' };
        if (rolls[0] === 10 && rolls[1] < 10 && rolls[1] + val === 10) {
          return { text: '/', cls: 'spare-mark' };
        }
        return { text: val === 0 ? '-' : String(val), cls: '' };
      }
    }
    return { text: '', cls: '' };
  }

  function updateScoreboardDOM() {
    const mode = ROM_GAME_MODES[state.gameModeIndex];
    const cardP1 = document.getElementById('scoreCardP1');
    const cardP2 = document.getElementById('scoreCardP2');

    cardP2.classList.toggle('hidden', mode.players === 1);
    cardP1.classList.toggle('active', state.currentPlayer === 0);
    cardP2.classList.toggle('active', state.currentPlayer === 1 && mode.players === 2);

    for (let p = 0; p < 2; p++) {
      const player = state.players[p];
      document.getElementById(`p${p + 1}TotalScore`).textContent =
        String(player.romScore).padStart(3, '0');

      for (let f = 0; f < 10; f++) {
        const frameObj = player.frames[f];
        const cell = document.getElementById(`p${p + 1}-frame-${f + 1}`);
        const isCurrent = state.gameActive && state.currentPlayer === p && state.currentFrame === (f + 1);
        cell.classList.toggle('current-frame', isCurrent);

        const r1El = document.getElementById(`p${p + 1}-f${f + 1}-r1`);
        const r2El = document.getElementById(`p${p + 1}-f${f + 1}-r2`);

        if (f < 9 && frameObj.rolls[0] === 10) {
          r1El.textContent = '';
          r1El.className = 'roll-box';
          r2El.textContent = 'X';
          r2El.className = 'roll-box strike-mark';
        } else {
          const s1 = formatRollSymbol(f, frameObj.rolls, 0);
          const s2 = formatRollSymbol(f, frameObj.rolls, 1);
          r1El.textContent = s1.text;
          r1El.className = `roll-box ${s1.cls}`;
          r2El.textContent = s2.text;
          r2El.className = `roll-box ${s2.cls}`;
        }

        if (f === 9) {
          const r3El = document.getElementById(`p${p + 1}-f10-r3`);
          const s3 = formatRollSymbol(f, frameObj.rolls, 2);
          r3El.textContent = s3.text;
          r3El.className = `roll-box ${s3.cls}`;
        }

        // Classic Atari frame marker bar ($0093..$0098)
        const atariEl = document.getElementById(`p${p + 1}-f${f + 1}-atari`);
        atariEl.innerHTML = frameObj.atariMarker
          ? `<span class="atari-glyph ${frameObj.atariMarker}"></span>`
          : '';

        const scoreEl = document.getElementById(`p${p + 1}-f${f + 1}-score`);
        scoreEl.textContent = frameObj.cumulativeScore !== null ? String(frameObj.cumulativeScore) : '';
      }
    }
  }

  function updateHUD() {
    const mode = ROM_GAME_MODES[state.gameModeIndex];
    const frameText = document.getElementById('hudFrameText');
    const modeText = document.getElementById('hudModeText');
    const hintText = document.getElementById('hudHintText');

    modeText.textContent = mode.name;

    if (!state.gameActive) {
      frameText.textContent = 'FIM DE PARTIDA';
      hintText.textContent = 'Pressione R ou clique em NOVO JOGO para jogar novamente';
      return;
    }

    const pLabel = mode.players === 2 ? `J${state.currentPlayer + 1} • ` : '';
    frameText.textContent = `${pLabel}FRAME ${state.currentFrame} • BOLA ${state.rollInFrame + 1}`;

    if (state.bowlerState === 0) {
      hintText.textContent = '↑/↓ (ou W/S) posiciona o jogador • ESPAÇO arremessa';
    } else if (state.bowlerState >= 1 && state.bowlerState <= 4) {
      hintText.textContent = 'Preparando arremesso...';
    } else if (state.bowlerState === 5) {
      if (mode.type === 'curve') {
        hintText.textContent = state.lockedCurveDir === 0
          ? 'Pressione ↑ ou ↓ UMA VEZ para travar a curva da bola!'
          : `Curva travada para ${state.lockedCurveDir === 1 ? 'CIMA ▲' : 'BAIXO ▼'}`;
      } else if (mode.type === 'steer') {
        hintText.textContent = 'Segure ↑ ou ↓ para dirigir a bola livremente na pista!';
      } else {
        hintText.textContent = 'Bola Reta: sem efeito após o lançamento!';
      }
    } else {
      hintText.textContent = 'Retornando bola...';
    }
  }

  // =========================================================================
  // 9B. TOP 5 HIGH SCORES (5-LETTER INITIALS + SCORE)
  // =========================================================================

  const HIGHSCORE_STORAGE_KEY = 'bowling2600_top5_v1';
  const DEFAULT_TOP5 = [
    { initials: 'RZURR', score: 210 },
    { initials: 'KAPLN', score: 175 },
    { initials: 'ATARI', score: 140 },
    { initials: 'STRIK', score: 105 },
    { initials: 'SPARE', score: 70 }
  ];

  let highScores = loadHighScores();
  let pendingRecordQueue = [];
  let activeRecordCandidate = null;
  let lastInsertedIndex = -1;

  function loadHighScores() {
    try {
      const raw = localStorage.getItem(HIGHSCORE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return normalizeTop5(parsed);
        }
      }
    } catch (_) {}
    return normalizeTop5(DEFAULT_TOP5);
  }

  function normalizeTop5(list) {
    const cleaned = list
      .map(item => ({
        initials: String(item.initials || 'JOGDR')
          .toUpperCase()
          .replace(/[^A-ZÀ-Ÿ0-9]/g, '')
          .slice(0, 5)
          .padEnd(5, ' '),
        score: Math.max(0, Math.min(300, parseInt(item.score, 10) || 0))
      }))
      .sort((a, b) => b.score - a.score);

    while (cleaned.length < 5) {
      cleaned.push({ initials: '-----', score: 0 });
    }
    return cleaned.slice(0, 5);
  }

  function saveHighScores() {
    try {
      localStorage.setItem(HIGHSCORE_STORAGE_KEY, JSON.stringify(highScores));
    } catch (_) {}
  }

  function renderHighScoresDOM() {
    const listEl = document.getElementById('highscoreList');
    if (!listEl) return;
    listEl.innerHTML = '';

    highScores.slice(0, 5).forEach((entry, idx) => {
      const li = document.createElement('li');
      li.className = `highscore-item ${idx === 0 ? 'rank-1' : ''} ${idx === lastInsertedIndex ? 'highlight-new' : ''}`;
      const formattedInitials = entry.initials.trim() || '-----';
      const formattedScore = String(entry.score).padStart(3, '0');
      li.innerHTML = `
        <div class="hs-left">
          <span class="hs-rank">${idx + 1}º</span>
          <span class="hs-initials">${formattedInitials}</span>
        </div>
        <span class="hs-dots"></span>
        <span class="hs-score">${formattedScore}</span>
      `;
      listEl.appendChild(li);
    });
  }

  function qualifiesForTop5(score) {
    if (score <= 0) return false;
    return highScores.length < 5 || score >= highScores[4].score;
  }

  function checkAndPromptHighScoresOnGameOver() {
    const mode = ROM_GAME_MODES[state.gameModeIndex];
    pendingRecordQueue = [];

    const p1Score = state.players[0].romScore;
    if (qualifiesForTop5(p1Score)) {
      pendingRecordQueue.push({ playerLabel: 'JOGADOR 1', score: p1Score });
    }

    if (mode.players === 2) {
      const p2Score = state.players[1].romScore;
      if (qualifiesForTop5(p2Score)) {
        pendingRecordQueue.push({ playerLabel: 'JOGADOR 2', score: p2Score });
      }
    }

    if (pendingRecordQueue.length > 0) {
      openNextPendingRecordModal();
    }
  }

  function openNextPendingRecordModal() {
    if (pendingRecordQueue.length === 0) {
      activeRecordCandidate = null;
      return;
    }
    activeRecordCandidate = pendingRecordQueue.shift();
    openRecordModal(activeRecordCandidate.playerLabel, activeRecordCandidate.score);
  }

  function openRecordModal(playerLabel, score) {
    const modal = document.getElementById('recordModal');
    const labelEl = document.getElementById('recordPlayerLabel');
    const inputEl = document.getElementById('recordInitialsInput');

    activeRecordCandidate = { playerLabel, score };
    labelEl.textContent = `${playerLabel} • PONTUAÇÃO: ${String(score).padStart(3, '0')}`;
    inputEl.value = '';
    modal.classList.remove('hidden');
    setTimeout(() => inputEl.focus(), 40);
  }

  function closeRecordModal() {
    const modal = document.getElementById('recordModal');
    modal.classList.add('hidden');
    if (pendingRecordQueue.length > 0) {
      setTimeout(openNextPendingRecordModal, 150);
    } else {
      activeRecordCandidate = null;
    }
  }

  function insertHighScoreRecord(rawInitials, score) {
    const cleanInitials = String(rawInitials || '')
      .toUpperCase()
      .replace(/[^A-ZÀ-Ÿ]/g, '')
      .slice(0, 5);

    if (!cleanInitials) return;

    const newEntry = { initials: cleanInitials, score: Math.max(0, Math.min(300, score)) };
    const combined = [...highScores, newEntry];
    combined.sort((a, b) => b.score - a.score);

    lastInsertedIndex = combined.indexOf(newEntry);
    if (lastInsertedIndex >= 5) lastInsertedIndex = 4;

    highScores = combined.slice(0, 5);
    saveHighScores();
    renderHighScoresDOM();
  }

  // =========================================================================
  // 10. CONTROLS (KEYBOARD, TOUCH/MOUSE & GAMEPAD) & UI BINDINGS
  // =========================================================================

  function isModalOrInputFocused() {
    const recordModal = document.getElementById('recordModal');
    if (recordModal && !recordModal.classList.contains('hidden')) return true;
    const active = document.activeElement;
    return active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
  }

  function setupInputsAndUI() {
    window.addEventListener('keydown', (e) => {
      if (isModalOrInputFocused()) return;

      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        state.keys.up = true;
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        state.keys.down = true;
      } else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (!state.gameActive) {
          startNewGame();
        } else if (state.bowlerState === 0) {
          state.keys.throwPressed = true;
        }
      } else if (e.code === 'KeyR') {
        startNewGame();
      } else if (e.code === 'KeyG') {
        const nextMode = (state.gameModeIndex + 1) % ROM_GAME_MODES.length;
        document.getElementById('gameSelect').value = String(nextMode + 1);
        startNewGame(nextMode);
      } else if (e.code === 'KeyV') {
        toggleVisualMode();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        state.keys.up = false;
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        state.keys.down = false;
      }
    });

    // Touch / Mouse Pad Controls
    const btnUp = document.getElementById('btnUp');
    const btnDown = document.getElementById('btnDown');
    const btnThrow = document.getElementById('btnThrow');

    const bindHoldButton = (btn, keyName) => {
      const start = (e) => { e.preventDefault(); state.keys[keyName] = true; };
      const end = (e) => { e.preventDefault(); state.keys[keyName] = false; };
      btn.addEventListener('mousedown', start);
      btn.addEventListener('mouseup', end);
      btn.addEventListener('mouseleave', end);
      btn.addEventListener('touchstart', start, { passive: false });
      btn.addEventListener('touchend', end, { passive: false });
    };

    bindHoldButton(btnUp, 'up');
    bindHoldButton(btnDown, 'down');

    btnThrow.addEventListener('click', () => {
      if (!state.gameActive) {
        startNewGame();
      } else if (state.bowlerState === 0) {
        state.keys.throwPressed = true;
      }
    });

    // Console Header Switches
    const gameSelect = document.getElementById('gameSelect');
    gameSelect.addEventListener('change', (e) => {
      const idx = parseInt(e.target.value, 10) - 1;
      startNewGame(idx);
      e.target.blur();
    });

    const setupDiffButton = (btnId, badgeId, playerIdx) => {
      const btn = document.getElementById(btnId);
      const badge = document.getElementById(badgeId);
      btn.addEventListener('click', () => {
        const next = state.difficulty[playerIdx] === 'B' ? 'A' : 'B';
        state.difficulty[playerIdx] = next;
        btn.dataset.diff = next;
        btn.textContent = next === 'B' ? 'B (Normal)' : 'A (Pro)';
        badge.textContent = `DIF ${next}`;
      });
    };

    setupDiffButton('diffP1Btn', 'p1DiffBadge', 0);
    setupDiffButton('diffP2Btn', 'p2DiffBadge', 1);

    document.getElementById('visualModeBtn').addEventListener('click', toggleVisualMode);

    const audioModeBtn = document.getElementById('audioModeBtn');
    audioModeBtn.addEventListener('click', () => {
      const next = window.bowlingAudio.mode === 'modern' ? 'tia' : 'modern';
      window.bowlingAudio.setMode(next);
      audioModeBtn.textContent = next === 'modern' ? 'Moderno Stereo' : 'Atari TIA 2600';
      audioModeBtn.classList.toggle('active-modern', next === 'modern');
    });

    const muteBtn = document.getElementById('muteBtn');
    muteBtn.addEventListener('click', () => {
      const isMuted = window.bowlingAudio.toggleMute();
      muteBtn.textContent = isMuted ? '🔇' : '🔊';
    });

    document.getElementById('resetBtn').addEventListener('click', () => startNewGame());

    // Rules Modal
    const rulesModal = document.getElementById('rulesModal');
    document.getElementById('rulesBtn').addEventListener('click', () => {
      rulesModal.classList.remove('hidden');
    });
    document.getElementById('closeModalBtn').addEventListener('click', () => {
      rulesModal.classList.add('hidden');
    });
    rulesModal.addEventListener('click', (e) => {
      if (e.target === rulesModal) rulesModal.classList.add('hidden');
    });

    // High Score 5-Letter Record Modal
    const recordModal = document.getElementById('recordModal');
    const recordInput = document.getElementById('recordInitialsInput');
    const recordForm = document.getElementById('recordForm');

    // Enforce max 5 letters (A-Z) in uppercase while typing
    recordInput.addEventListener('input', () => {
      const filtered = recordInput.value.toUpperCase().replace(/[^A-ZÀ-Ÿ]/g, '').slice(0, 5);
      if (recordInput.value !== filtered) {
        recordInput.value = filtered;
      }
    });

    document.getElementById('openRecordModalBtn').addEventListener('click', () => {
      const pIdx = state.currentPlayer;
      const pScore = state.players[pIdx].romScore;
      openRecordModal(`JOGADOR ${pIdx + 1}`, pScore);
    });

    document.getElementById('closeRecordModalBtn').addEventListener('click', () => {
      closeRecordModal();
    });

    recordModal.addEventListener('click', (e) => {
      if (e.target === recordModal) closeRecordModal();
    });

    recordForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const initials = recordInput.value.toUpperCase().replace(/[^A-ZÀ-Ÿ]/g, '').slice(0, 5);
      if (!initials) return;
      const score = activeRecordCandidate ? activeRecordCandidate.score : state.players[state.currentPlayer].romScore;
      insertHighScoreRecord(initials, score);
      window.bowlingAudio.playCelebration('spare');
      closeRecordModal();
    });
  }

  function toggleVisualMode() {
    state.visualMode = state.visualMode === 'modern' ? 'atari' : 'modern';
    const btn = document.getElementById('visualModeBtn');
    const crt = document.getElementById('crtOverlay');
    btn.textContent = state.visualMode === 'modern' ? 'Moderno HD' : 'Atari 2600 CRT';
    btn.classList.toggle('active-modern', state.visualMode === 'modern');
    crt.classList.toggle('hidden', state.visualMode === 'modern');
  }

  let gpWasActive = false;
  function pollGamepad() {
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    const pad = pads && pads[0];
    if (!pad) return;

    const axisY = pad.axes[1] || 0;
    const dpadUp = (pad.buttons[12] && pad.buttons[12].pressed) || axisY < -0.4;
    const dpadDown = (pad.buttons[13] && pad.buttons[13].pressed) || axisY > 0.4;
    const fireBtn = pad.buttons[0] && pad.buttons[0].pressed;

    if (dpadUp || dpadDown) {
      gpWasActive = true;
      state.keys.up = dpadUp;
      state.keys.down = dpadDown;
    } else if (gpWasActive) {
      gpWasActive = false;
      state.keys.up = false;
      state.keys.down = false;
    }

    if (fireBtn && state.bowlerState === 0 && state.gameActive) {
      state.keys.throwPressed = true;
    }
  }

  // =========================================================================
  // 11. MAIN 60FPS GAME LOOP
  // =========================================================================

  let lastTime = performance.now();
  const STEP_MS = 1000 / 60;
  let accumulator = 0;

  function gameLoop(now) {
    const delta = Math.min(100, now - lastTime);
    lastTime = now;
    accumulator += delta;

    pollGamepad();

    while (accumulator >= STEP_MS) {
      updatePhysicsTick();
      accumulator -= STEP_MS;
    }

    render();
    requestAnimationFrame(gameLoop);
  }

  // Boot
  buildScoreboardGrids();
  renderHighScoresDOM();
  setupInputsAndUI();
  startNewGame(0);
  requestAnimationFrame(gameLoop);
})();
