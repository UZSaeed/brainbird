"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ── Constants ────────────────────────────────────────────────────────────────
const W = 1200;
const H = 800;
const BIRD_X = 140;

// Physics (tuned for gentler, floaty feel)
const GRAVITY = 0.12;
const FLOAT_ACCEL = -0.35;
const MAX_FALL = 4;
const MAX_RISE = -3.5;

// Pipes
const PIPE_W = 68;
const CAP_H = 26;
const CAP_W = PIPE_W + 14;
const GAP = 170;
const PIPE_SPEED = 3;
const PIPE_INTERVAL = 2400; // ms between pipe spawns

// Hitbox — just the brain body, not ears/lobes
const HIT_HALF_W = 16;
const HIT_HALF_H = 14;

// ── Types ────────────────────────────────────────────────────────────────────
interface Pipe {
  x: number;
  botY: number;
  scored: boolean;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

// ── Deterministic stars (avoid hydration mismatch) ──────────────────────────
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}
const STARS = Array.from({ length: 55 }, (_, i) => {
  const r = seeded(i * 7919 + 31);
  return { x: r() * W, y: r() * (H - 80), radius: 1 + r() * 2, alpha: 0.1 + r() * 0.3 };
});

// ── Drawing helpers ──────────────────────────────────────────────────────────

function drawBrain(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, img: HTMLImageElement | null) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((angle * Math.PI) / 180);

  if (img) {
    const w = 110;
    const h = (110 * 558) / 1024; // Maintains original aspect ratio
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  }
  
  ctx.restore();
}

function drawPipe(ctx: CanvasRenderingContext2D, x: number, botY: number) {
  const bodyColor = "#b0b0b0";
  const border = "#808080";
  const botH = H - 40 - botY;

  ctx.fillStyle = bodyColor;
  ctx.strokeStyle = border;
  ctx.lineWidth = 2;

  // Bottom cap
  roundRect(ctx, x - CAP_W / 2, botY, CAP_W, CAP_H, 8);
  const botShaft = botH - CAP_H;
  if (botShaft > 0) {
    ctx.fillRect(x - PIPE_W / 2, botY + CAP_H, PIPE_W, botShaft);
    ctx.strokeRect(x - PIPE_W / 2, botY + CAP_H, PIPE_W, botShaft);
  }
}

function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Glow
  ctx.fillStyle = "rgba(255,221,0,0.35)";
  ctx.beginPath();
  ctx.arc(x, y, 18, 0, Math.PI * 2);
  ctx.fill();

  // Core
  ctx.fillStyle = "rgba(255,221,0,0.8)";
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fill();

  // Lightning bolt
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(x - 2, y - 8);
  ctx.lineTo(x + 4, y - 8);
  ctx.lineTo(x + 1, y - 1);
  ctx.lineTo(x + 6, y - 1);
  ctx.lineTo(x - 4, y + 9);
  ctx.lineTo(x - 1, y + 2);
  ctx.lineTo(x - 6, y + 2);
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawBackground(ctx: CanvasRenderingContext2D) {
  // Sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#1a1a2e");
  grad.addColorStop(1, "#0f3460");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Stars
  for (const s of STARS) {
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle = "#4a90e2";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Ground
  ctx.fillStyle = "#2d2d44";
  ctx.fillRect(0, H - 40, W, 40);
  ctx.fillStyle = "#4a90e2";
  ctx.fillRect(0, H - 40, W, 2);
}

// ── Component ────────────────────────────────────────────────────────────────
export default function BrainBird() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = '/brain-sprite.png';
    img.onload = () => {
      imgRef.current = img;
    };
  }, []);

  // React state — only for the HUD overlay
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [started, setStarted] = useState(false); // has the first frame rendered

  // All game state lives in refs (no re-renders during gameplay)
  const stateRef = useRef({
    birdY: H / 2,
    velocity: 0,
    alive: true,
    waitingToStart: true,
    holding: false,
    pipes: [] as Pipe[],
    sparks: [] as Spark[],
    score: 0,
    highScore: 0,
    lastPipeTime: 0,
    deathTimer: 0,   // frames since death (for bird fall animation)
    deathBirdY: 0,
    deathBirdAngle: 0,
    flashAlpha: 0,
  });

  // ── Reset helper ──
  const resetGame = useCallback(() => {
    const s = stateRef.current;
    s.birdY = H / 2;
    s.velocity = 0;
    s.alive = true;
    s.waitingToStart = true;
    s.holding = false;
    s.pipes = [];
    s.sparks = [];
    s.score = 0;
    s.lastPipeTime = 0;
    s.deathTimer = 0;
    s.deathBirdY = 0;
    s.deathBirdAngle = 0;
    s.flashAlpha = 0;
    setScore(0);
    setGameOver(false);
  }, []);

  // ── Input handlers ──
  const onDown = useCallback(() => {
    const s = stateRef.current;
    if (!s.alive) return;
    if (s.waitingToStart) {
      s.waitingToStart = false;
      s.lastPipeTime = performance.now() + 600; // first pipe after short delay
    }
    s.holding = true;
  }, []);

  const onUp = useCallback(() => {
    stateRef.current.holding = false;
  }, []);

  // ── Keyboard listeners (capture phase, always on window) ──
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        onDown();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        onUp();
      }
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [onDown, onUp]);

  // ── Game loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let running = true;

    const loop = (now: number) => {
      if (!running) return;
      const s = stateRef.current;

      // ── UPDATE ──
      if (s.alive && !s.waitingToStart) {
        // Physics
        if (s.holding) {
          s.velocity += FLOAT_ACCEL;
        } else {
          s.velocity += GRAVITY;
        }
        s.velocity = Math.max(MAX_RISE, Math.min(MAX_FALL, s.velocity));
        s.birdY += s.velocity;

        // Ceiling
        if (s.birdY < 22) {
          s.birdY = 22;
          s.velocity = 0;
        }

        // Ground = death
        if (s.birdY >= H - 56) {
          s.birdY = H - 56;
          die(s);
        }

        // Spawn pipes
        if (now > s.lastPipeTime + PIPE_INTERVAL) {
          const gapY = 90 + Math.random() * (H - 90 - GAP - 90);
          const botY = gapY + GAP;
          s.pipes.push({ x: W + PIPE_W / 2, botY, scored: false });
          s.lastPipeTime = now;
        }

        // Move pipes + collision + scoring
        for (let i = s.pipes.length - 1; i >= 0; i--) {
          const p = s.pipes[i];
          p.x -= PIPE_SPEED;

          // Off-screen cleanup
          if (p.x < -PIPE_W) {
            s.pipes.splice(i, 1);
            continue;
          }

          // Score: coin passes bird
          if (!p.scored && p.x < BIRD_X) {
            p.scored = true;
            s.score++;
            if (s.score > s.highScore) s.highScore = s.score;
            setScore(s.score);
            setHighScore(s.highScore);

            // Sparks
            for (let j = 0; j < 8; j++) {
              const angle = (j / 8) * Math.PI * 2;
              s.sparks.push({
                x: BIRD_X,
                y: s.birdY,
                vx: Math.cos(angle) * 3,
                vy: Math.sin(angle) * 3,
                life: 1,
              });
            }
          }

          // Collision detection
          if (s.alive) {
            const dx = Math.abs(p.x - BIRD_X);
            // Only check when bird is horizontally overlapping PIPE body
            if (dx < PIPE_W / 2 + HIT_HALF_W) {
              const by = s.birdY;
              // Hit bottom pipe
              if (by + HIT_HALF_H > p.botY) {
                die(s);
              }
            }
          }
        }
      }

      // Death animation
      if (!s.alive) {
        s.deathTimer++;
        s.deathBirdY += Math.min(s.deathTimer * 0.5, 8);
        s.deathBirdAngle = Math.min(s.deathBirdAngle + 4, 180);
        if (s.flashAlpha > 0) s.flashAlpha -= 0.03;
      }

      // Update sparks
      for (let i = s.sparks.length - 1; i >= 0; i--) {
        const sp = s.sparks[i];
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.life -= 0.04;
        if (sp.life <= 0) s.sparks.splice(i, 1);
      }

      // ── DRAW ──
      drawBackground(ctx);

      // Pipes + coins
      for (const p of s.pipes) {
        drawPipe(ctx, p.x, p.botY);
        if (!p.scored) {
          drawCoin(ctx, p.x, p.botY - 45); // Sit above the pipe
        }
      }

      // Sparks
      for (const sp of s.sparks) {
        ctx.globalAlpha = sp.life;
        ctx.fillStyle = "#ffdd00";
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Bird
      if (s.alive) {
        const angle = Math.max(-30, Math.min(75, s.velocity * 4));
        drawBrain(ctx, BIRD_X, s.birdY, angle, imgRef.current);
      } else {
        drawBrain(ctx, BIRD_X, s.birdY + s.deathBirdY, s.deathBirdAngle, imgRef.current);
      }

      // Death flash
      if (s.flashAlpha > 0) {
        ctx.fillStyle = `rgba(255,255,255,${s.flashAlpha})`;
        ctx.fillRect(0, 0, W, H);
      }

      // Score text (in-canvas pill)
      ctx.save();
      ctx.font = "bold 20px sans-serif";
      const scoreStr = String(s.score);
      const textWidth = ctx.measureText(scoreStr).width;
      
      const pillW = 32 + textWidth + 18; 
      const pillH = 34;
      const pillX = W / 2 - pillW / 2;
      const pillY = 16;
      
      // Pill bg
      ctx.fillStyle = "rgba(15, 52, 96, 0.85)";
      ctx.strokeStyle = "rgba(74, 144, 226, 0.6)";
      ctx.lineWidth = 2;
      roundRect(ctx, pillX, pillY, pillW, pillH, 17);
      
      // Lightning bolt icon (small)
      const lx = pillX + 20;
      const ly = pillY + pillH / 2;
      
      // Glow
      ctx.fillStyle = "rgba(255,221,0,0.3)";
      ctx.beginPath(); ctx.arc(lx, ly, 10, 0, Math.PI * 2); ctx.fill();
      
      // Core
      ctx.fillStyle = "rgba(255,221,0,0.9)";
      ctx.beginPath(); ctx.arc(lx, ly, 6, 0, Math.PI * 2); ctx.fill();
      
      // Bolt shape
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(lx - 1, ly - 4);
      ctx.lineTo(lx + 2, ly - 4);
      ctx.lineTo(lx + 0.5, ly - 0.5);
      ctx.lineTo(lx + 3, ly - 0.5);
      ctx.lineTo(lx - 2, ly + 4.5);
      ctx.lineTo(lx - 0.5, ly + 1);
      ctx.lineTo(lx - 3, ly + 1);
      ctx.closePath();
      ctx.fill();
      
      // Text
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(scoreStr, lx + 12, ly + 1.5);
      ctx.restore();

      // "Press SPACE" prompt
      if (s.waitingToStart && s.alive) {
        ctx.font = "15px sans-serif";
        ctx.fillStyle = "#c8dff5";
        ctx.strokeStyle = "#1a1a2e";
        ctx.lineWidth = 3;
        const lines = ["Press SPACE to begin", "or squeeze arm if Bluetooth connected"];
        lines.forEach((line, i) => {
          const ly = H / 2 + 60 + i * 20;
          ctx.strokeText(line, W / 2, ly);
          ctx.fillText(line, W / 2, ly);
        });
      }

      if (!started) setStarted(true);

      animRef.current = requestAnimationFrame(loop);
    };

    const die = (s: typeof stateRef.current) => {
      if (!s.alive) return;
      s.alive = false;
      s.deathTimer = 0;
      s.deathBirdY = 0;
      s.deathBirdAngle = s.velocity * 4;
      s.flashAlpha = 0.4;
      setGameOver(true);
    };

    animRef.current = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [started]);

  // ── Handlers ──
  const handleRestart = useCallback(() => {
    resetGame();
  }, [resetGame]);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* HUD */}
      <div className="flex items-center justify-between w-full max-w-[1200px] px-2">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium" style={{ color: "var(--dark)" }}>
            Score:{" "}
            <span className="font-bold text-lg" style={{ color: "var(--neuro-blue)" }}>
              {score}
            </span>
          </div>
          <div className="text-sm font-medium" style={{ color: "var(--dark)" }}>
            Best:{" "}
            <span className="font-bold" style={{ color: "var(--brain-pink)" }}>
              {highScore}
            </span>
          </div>
        </div>
      </div>

      {/* Canvas wrapper */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          onPointerDown={onDown}
          onPointerUp={onUp}
          style={{
            width: W,
            height: H,
            borderRadius: 16,
            display: "block",
            boxShadow: "0 8px 32px rgba(74,144,226,0.25), 0 2px 8px rgba(0,0,0,0.15)",
          }}
        />

        {/* Loading overlay */}
        {!started && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl"
            style={{ background: "rgba(26,26,46,0.88)", backdropFilter: "blur(2px)" }}
          >
            <p className="text-white text-lg font-semibold mb-2">🧠 Brain-Bird</p>
            <p className="text-sm animate-pulse" style={{ color: "#7a9dbf" }}>Loading game…</p>
          </div>
        )}

        {/* Game-over overlay */}
        {gameOver && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl gap-4"
            style={{ background: "rgba(26,26,46,0.88)", backdropFilter: "blur(4px)" }}
          >
            <p className="text-white text-2xl font-bold">Game Over</p>
            <p className="font-medium" style={{ color: "var(--brain-pink)" }}>
              Score: {score}&nbsp;|&nbsp;Best: {highScore}
            </p>
            <button
              onClick={handleRestart}
              className="px-6 py-2.5 rounded-full font-semibold text-sm transition-all duration-150 active:scale-95 cursor-pointer"
              style={{
                background: "var(--neuro-blue)",
                color: "white",
                boxShadow: "0 4px 14px rgba(74,144,226,0.4)",
              }}
            >
              Play Again
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-center" style={{ color: "#9999aa" }}>
        Hold{" "}
        <kbd className="px-1.5 py-0.5 rounded text-xs font-mono" style={{ background: "#eee", color: "#333" }}>
          Space
        </kbd>{" "}
        to float · release to fall · pass through synapses & collect coins to score
      </p>
    </div>
  );
}
