'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Screen = 'menu' | 'playing' | 'paused' | 'gameover';
type EnemyKind = 'asteroid' | 'drone' | 'hunter';
type PowerUpKind = 'shield' | 'rapid' | 'health' | 'double';
type Entity = {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  points: number;
  rotation: number;
  spin: number;
};
type Bullet = { id: number; x: number; y: number; vy: number; radius: number };
type PowerUp = { id: number; kind: PowerUpKind; x: number; y: number; vy: number; pulse: number };
type Particle = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
};
type Star = { x: number; y: number; size: number; speed: number; alpha: number };
type GameState = {
  width: number;
  height: number;
  playerX: number;
  playerY: number;
  playerRadius: number;
  entities: Entity[];
  bullets: Bullet[];
  powerUps: PowerUp[];
  particles: Particle[];
  stars: Star[];
  nextId: number;
  score: number;
  lives: number;
  wave: number;
  elapsed: number;
  spawnTimer: number;
  powerTimer: number;
  shotTimer: number;
  hitTimer: number;
  shield: boolean;
  rapidUntil: number;
  doubleUntil: number;
};

const STORAGE_KEY = 'astro-survivor-settings';
const SCORE_KEY = 'astro-survivor-high-score';
const COLORS: Record<EnemyKind | PowerUpKind, string> = {
  asteroid: '#f59e0b',
  drone: '#fb7185',
  hunter: '#c084fc',
  shield: '#22d3ee',
  rapid: '#facc15',
  health: '#4ade80',
  double: '#f472b6',
};
function makeStars(width: number, height: number): Star[] {
  return Array.from({ length: 90 }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    size: 0.6 + Math.random() * 2,
    speed: 8 + Math.random() * 32,
    alpha: 0.2 + Math.random() * 0.7,
  }));
}

function makeGame(width: number, height: number): GameState {
  return {
    width,
    height,
    playerX: width / 2,
    playerY: height - 72,
    playerRadius: 18,
    entities: [],
    bullets: [],
    powerUps: [],
    particles: [],
    stars: makeStars(width, height),
    nextId: 1,
    score: 0,
    lives: 3,
    wave: 1,
    elapsed: 0,
    spawnTimer: 0.7,
    powerTimer: 9,
    shotTimer: 0,
    hitTimer: 0,
    shield: false,
    rapidUntil: 0,
    doubleUntil: 0,
  };
}

function circleHit(
  a: { x: number; y: number; radius: number },
  b: { x: number; y: number; radius: number }
) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const radius = a.radius + b.radius;
  return dx * dx + dy * dy <= radius * radius;
}

function formatScore(score: number) {
  return score.toLocaleString('en-US').padStart(5, '0');
}

export default function AstroSurvivor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameState>(makeGame(900, 600));
  const keysRef = useRef({ left: false, right: false, shoot: false });
  const animationRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const [screen, setScreen] = useState<Screen>('menu');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [wave, setWave] = useState(1);
  const [activePower, setActivePower] = useState('None active');
  const [soundOn, setSoundOn] = useState(true);
  const [newHigh, setNewHigh] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { soundOn?: boolean };
      // Browser storage is external state; hydrate it once after the client mounts.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSoundOn(saved.soundOn ?? true);
      setHighScore(Number(localStorage.getItem(SCORE_KEY) ?? 0));
    } catch {
      setSoundOn(true);
    }
  }, []);

  const playTone = useCallback(
    (frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.035) => {
      if (!soundOn || typeof window === 'undefined') return;
      try {
        const context = audioRef.current ?? new AudioContext();
        audioRef.current = context;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, context.currentTime);
        gain.gain.setValueAtTime(volume, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + duration);
      } catch {
        // Audio is an enhancement and may be unavailable in restricted browsers.
      }
    },
    [soundOn]
  );

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ soundOn: next }));
    if (next) playTone(640, 0.08, 'sine', 0.025);
  };

  const resizeGame = useCallback(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell) return;
    const rect = shell.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const game = gameRef.current;
    const scaleX = rect.width / game.width;
    game.width = rect.width;
    game.height = rect.height;
    game.playerX *= scaleX;
    game.playerY = rect.height - 72;
    game.stars = game.stars.map((star) => ({
      ...star,
      x: star.x * scaleX,
      y: Math.min(star.y, rect.height),
    }));
  }, []);

  useEffect(() => {
    resizeGame();
    window.addEventListener('resize', resizeGame);
    return () => window.removeEventListener('resize', resizeGame);
  }, [resizeGame]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && screen === 'playing') setScreen('paused');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [screen]);

  const addBurst = (game: GameState, x: number, y: number, color: string, count = 12) => {
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + Math.random() * 0.5;
      const speed = 35 + Math.random() * 105;
      game.particles.push({
        id: game.nextId++,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.45 + Math.random() * 0.35,
        color,
        size: 1.5 + Math.random() * 3,
      });
    }
  };

  const startGame = () => {
    const { width, height } = gameRef.current;
    gameRef.current = makeGame(width, height);
    setScore(0);
    setLives(3);
    setWave(1);
    setActivePower('None active');
    setNewHigh(false);
    setScreen('playing');
    playTone(220, 0.12, 'triangle', 0.04);
  };

  const finishGame = () => {
    const finalScore = gameRef.current.score;
    const savedHigh = Number(localStorage.getItem(SCORE_KEY) ?? highScore);
    const isNewHigh = finalScore > savedHigh;
    if (isNewHigh) {
      localStorage.setItem(SCORE_KEY, String(finalScore));
      setHighScore(finalScore);
    }
    setNewHigh(isNewHigh);
    setScreen('gameover');
    playTone(110, 0.55, 'sawtooth', 0.045);
  };

  const shoot = useCallback(() => {
    const game = gameRef.current;
    if (screen !== 'playing' || game.shotTimer > 0) return;
    game.bullets.push({
      id: game.nextId++,
      x: game.playerX,
      y: game.playerY - 24,
      vy: 520,
      radius: 3,
    });
    game.shotTimer = game.rapidUntil > game.elapsed ? 0.095 : 0.24;
    playTone(520, 0.055, 'square', 0.022);
  }, [playTone, screen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const pressed = event.type === 'keydown';
      if (['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D', ' ', 'p', 'P'].includes(event.key))
        event.preventDefault();
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A')
        keysRef.current.left = pressed;
      if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D')
        keysRef.current.right = pressed;
      if (event.key === ' ') keysRef.current.shoot = pressed;
      if (
        pressed &&
        (event.key === 'p' || event.key === 'P') &&
        (screen === 'playing' || screen === 'paused')
      )
        setScreen((current) => (current === 'playing' ? 'paused' : 'playing'));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [screen]);

  useEffect(() => {
    if (screen !== 'playing') return;
    let previous = performance.now();
    const frame = (now: number) => {
      const dt = Math.min((now - previous) / 1000, 0.034);
      previous = now;
      const game = gameRef.current;
      game.elapsed += dt;
      game.wave = 1 + Math.floor(game.elapsed / 28);
      game.shotTimer = Math.max(0, game.shotTimer - dt);
      game.hitTimer = Math.max(0, game.hitTimer - dt);
      const difficulty = 1 + game.score / 850 + game.elapsed / 150;
      const move = (keysRef.current.left ? -1 : 0) + (keysRef.current.right ? 1 : 0);
      game.playerX = Math.max(30, Math.min(game.width - 30, game.playerX + move * 330 * dt));
      if (keysRef.current.shoot) shoot();

      game.stars.forEach((star) => {
        star.y += star.speed * dt * (1 + game.wave * 0.06);
        if (star.y > game.height) {
          star.y = -4;
          star.x = Math.random() * game.width;
        }
      });

      game.spawnTimer -= dt;
      if (game.spawnTimer <= 0) {
        const hunterReady = game.score >= 850;
        const roll = Math.random();
        const kind: EnemyKind =
          hunterReady && roll > 0.82 ? 'hunter' : roll > 0.58 ? 'drone' : 'asteroid';
        const radius = kind === 'asteroid' ? 13 + Math.random() * 15 : kind === 'drone' ? 17 : 20;
        const hp = kind === 'drone' ? 3 : 1;
        game.entities.push({
          id: game.nextId++,
          kind,
          x: radius + Math.random() * (game.width - radius * 2),
          y: -radius - 8,
          vx: 0,
          vy:
            (kind === 'drone' ? 110 : kind === 'hunter' ? 78 : 58) *
            (0.9 + Math.random() * 0.25) *
            difficulty,
          radius,
          hp,
          maxHp: hp,
          points: kind === 'asteroid' ? Math.round(radius * 3) : kind === 'drone' ? 125 : 240,
          rotation: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 3,
        });
        game.spawnTimer =
          Math.max(0.24, 0.88 - game.elapsed * 0.008 - game.score * 0.00018) *
          (0.7 + Math.random() * 0.5);
      }

      game.powerTimer -= dt;
      if (game.powerTimer <= 0) {
        const kinds: PowerUpKind[] = ['shield', 'rapid', 'health', 'double'];
        game.powerUps.push({
          id: game.nextId++,
          kind: kinds[Math.floor(Math.random() * kinds.length)] ?? 'shield',
          x: 36 + Math.random() * (game.width - 72),
          y: -20,
          vy: 58,
          pulse: 0,
        });
        game.powerTimer = 15 + Math.random() * 14;
      }

      game.bullets = game.bullets.filter((bullet) => {
        bullet.y -= bullet.vy * dt;
        return bullet.y > -20;
      });
      game.entities.forEach((entity) => {
        entity.y += entity.vy * dt;
        entity.rotation += entity.spin * dt;
        if (entity.kind === 'hunter') entity.x += Math.sign(game.playerX - entity.x) * 38 * dt;
      });
      game.powerUps.forEach((power) => {
        power.y += power.vy * dt;
        power.pulse += dt * 5;
      });

      for (const bullet of game.bullets) {
        for (const entity of game.entities) {
          if (entity.hp > 0 && circleHit(bullet, entity)) {
            entity.hp -= 1;
            bullet.y = -999;
            addBurst(game, bullet.x, bullet.y < 0 ? entity.y : bullet.y, COLORS[entity.kind], 5);
            if (entity.hp <= 0) {
              game.score += entity.points * (game.doubleUntil > game.elapsed ? 2 : 1);
              addBurst(
                game,
                entity.x,
                entity.y,
                COLORS[entity.kind],
                entity.kind === 'hunter' ? 22 : 13
              );
              playTone(
                entity.kind === 'hunter' ? 180 : 300,
                entity.kind === 'hunter' ? 0.2 : 0.08,
                'triangle',
                0.03
              );
            }
          }
        }
      }
      game.bullets = game.bullets.filter((bullet) => bullet.y > -100);
      game.entities = game.entities.filter((entity) => {
        if (entity.hp <= 0) return false;
        if (entity.y - entity.radius > game.height) return false;
        if (
          game.hitTimer <= 0 &&
          circleHit({ x: game.playerX, y: game.playerY, radius: game.playerRadius }, entity)
        ) {
          entity.hp = 0;
          game.hitTimer = 1.1;
          if (game.shield) game.shield = false;
          else game.lives -= 1;
          addBurst(game, game.playerX, game.playerY, game.shield ? COLORS.shield : '#fb7185', 24);
          playTone(game.shield ? 740 : 130, 0.24, 'sawtooth', 0.04);
          if (game.lives <= 0) finishGame();
          return false;
        }
        return true;
      });
      game.powerUps = game.powerUps.filter((power) => {
        if (power.y > game.height + 30) return false;
        if (
          circleHit(
            { x: game.playerX, y: game.playerY, radius: game.playerRadius + 5 },
            { x: power.x, y: power.y, radius: 15 }
          )
        ) {
          if (power.kind === 'shield') game.shield = true;
          if (power.kind === 'rapid') game.rapidUntil = game.elapsed + 10;
          if (power.kind === 'double') game.doubleUntil = game.elapsed + 10;
          if (power.kind === 'health') game.lives = Math.min(3, game.lives + 1);
          addBurst(game, power.x, power.y, COLORS[power.kind], 16);
          playTone(780, 0.16, 'sine', 0.035);
          return false;
        }
        return true;
      });
      game.particles = game.particles.filter((particle) => {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += 45 * dt;
        particle.life -= dt;
        return particle.life > 0;
      });

      setScore(game.score);
      setLives(game.lives);
      setWave(game.wave);
      const active: string[] = [];
      if (game.shield) active.push('Shield');
      if (game.rapidUntil > game.elapsed)
        active.push(`Rapid ${Math.ceil(game.rapidUntil - game.elapsed)}s`);
      if (game.doubleUntil > game.elapsed)
        active.push(`2× ${Math.ceil(game.doubleUntil - game.elapsed)}s`);
      setActivePower(active.join(' · ') || 'None active');
      // The renderer is a stable local function that only reads the canvas ref.
      // eslint-disable-next-line react-hooks/immutability
      drawGame(game);
      animationRef.current = requestAnimationFrame(frame);
    };
    animationRef.current = requestAnimationFrame(frame);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
    // finishGame is intentionally stable through refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, shoot, playTone]);

  function drawGame(game: GameState) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const scale = canvas.width / game.width;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, game.width, game.height);
    const gradient = context.createLinearGradient(0, 0, 0, game.height);
    gradient.addColorStop(0, '#071326');
    gradient.addColorStop(1, '#02050d');
    context.fillStyle = gradient;
    context.fillRect(0, 0, game.width, game.height);
    game.stars.forEach((star) => {
      context.globalAlpha = star.alpha;
      context.fillStyle = '#a8d8ff';
      context.beginPath();
      context.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      context.fill();
    });
    context.globalAlpha = 1;
    game.entities.forEach((entity) => {
      context.save();
      context.translate(entity.x, entity.y);
      context.rotate(entity.rotation);
      context.strokeStyle = COLORS[entity.kind];
      context.fillStyle = `${COLORS[entity.kind]}22`;
      context.lineWidth = 2;
      if (entity.kind === 'asteroid') {
        context.beginPath();
        for (let index = 0; index < 8; index += 1) {
          const angle = (Math.PI * 2 * index) / 8;
          const radius = entity.radius * (0.8 + (index % 3) * 0.09);
          context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        context.closePath();
        context.fill();
        context.stroke();
      } else if (entity.kind === 'drone') {
        context.beginPath();
        context.moveTo(0, -entity.radius);
        context.lineTo(entity.radius, entity.radius * 0.7);
        context.lineTo(0, entity.radius * 0.35);
        context.lineTo(-entity.radius, entity.radius * 0.7);
        context.closePath();
        context.fill();
        context.stroke();
        context.fillStyle = COLORS[entity.kind];
        context.fillRect(-3, -3, 6, 6);
      } else {
        context.beginPath();
        context.moveTo(0, -entity.radius);
        context.lineTo(entity.radius, entity.radius);
        context.lineTo(0, entity.radius * 0.55);
        context.lineTo(-entity.radius, entity.radius);
        context.closePath();
        context.fill();
        context.stroke();
        context.beginPath();
        context.arc(0, 2, 4, 0, Math.PI * 2);
        context.fillStyle = COLORS[entity.kind];
        context.fill();
      }
      context.restore();
      if (entity.maxHp > 1) {
        context.fillStyle = '#1c2637';
        context.fillRect(entity.x - 16, entity.y - entity.radius - 9, 32, 3);
        context.fillStyle = COLORS[entity.kind];
        context.fillRect(
          entity.x - 16,
          entity.y - entity.radius - 9,
          32 * (entity.hp / entity.maxHp),
          3
        );
      }
    });
    game.bullets.forEach((bullet) => {
      context.fillStyle = '#d7fbff';
      context.shadowColor = '#22d3ee';
      context.shadowBlur = 10;
      context.fillRect(bullet.x - 2, bullet.y - 9, 4, 12);
      context.shadowBlur = 0;
    });
    game.powerUps.forEach((power) => {
      context.save();
      context.translate(power.x, power.y);
      context.rotate(power.pulse * 0.15);
      context.strokeStyle = COLORS[power.kind];
      context.fillStyle = `${COLORS[power.kind]}22`;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(0, 0, 15 + Math.sin(power.pulse) * 2, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = COLORS[power.kind];
      context.font = 'bold 12px Arial';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(power.kind === 'double' ? '2×' : power.kind.slice(0, 1).toUpperCase(), 0, 1);
      context.restore();
    });
    if (game.hitTimer <= 0 || Math.floor(game.hitTimer * 12) % 2 === 0) {
      context.save();
      context.translate(game.playerX, game.playerY);
      context.fillStyle = '#071b2d';
      context.strokeStyle = game.shield ? COLORS.shield : '#6be4ff';
      context.lineWidth = 2.5;
      context.shadowColor = '#22d3ee';
      context.shadowBlur = 18;
      context.beginPath();
      context.moveTo(0, -25);
      context.lineTo(18, 17);
      context.lineTo(0, 10);
      context.lineTo(-18, 17);
      context.closePath();
      context.fill();
      context.stroke();
      context.shadowBlur = 0;
      context.fillStyle = '#e0fbff';
      context.beginPath();
      context.moveTo(0, -13);
      context.lineTo(6, 5);
      context.lineTo(-6, 5);
      context.closePath();
      context.fill();
      context.fillStyle = '#fb923c';
      context.beginPath();
      context.moveTo(-8, 14);
      context.lineTo(-3, 26);
      context.lineTo(0, 14);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(8, 14);
      context.lineTo(3, 26);
      context.lineTo(0, 14);
      context.closePath();
      context.fill();
      context.restore();
    }
    if (game.shield) {
      context.strokeStyle = `${COLORS.shield}99`;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(game.playerX, game.playerY, 28 + Math.sin(game.elapsed * 5) * 2, 0, Math.PI * 2);
      context.stroke();
    }
    game.particles.forEach((particle) => {
      context.globalAlpha = Math.max(0, particle.life);
      context.fillStyle = particle.color;
      context.fillRect(particle.x, particle.y, particle.size, particle.size);
    });
    context.globalAlpha = 1;
  }

  const holdControl = (key: 'left' | 'right' | 'shoot', value: boolean) => {
    keysRef.current[key] = value;
    if (key === 'shoot' && value) shoot();
  };

  return (
    <main className="game-shell">
      <div className="game-frame">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark">✦</span>
            <span>
              ASTRO <strong>SURVIVOR</strong>
            </span>
          </div>
          {screen === 'playing' || screen === 'paused' ? (
            <button
              className="pause-button"
              onClick={() => setScreen(screen === 'playing' ? 'paused' : 'playing')}
              aria-label={screen === 'playing' ? 'Pause game' : 'Resume game'}
            >
              {screen === 'playing' ? 'Ⅱ Pause' : '▶ Resume'}
            </button>
          ) : (
            <button className="sound-button" onClick={toggleSound}>
              {soundOn ? '◉ Sound on' : '○ Sound off'}
            </button>
          )}
        </header>
        <section className="playfield-wrap" ref={shellRef}>
          <canvas ref={canvasRef} aria-label="Astro Survivor game area" />
          {screen === 'playing' || screen === 'paused' ? (
            <div className="hud">
              <div>
                <span className="hud-label">SCORE</span>
                <strong>{formatScore(score)}</strong>
              </div>
              <div>
                <span className="hud-label">HIGH SCORE</span>
                <strong>{formatScore(highScore)}</strong>
              </div>
              <div>
                <span className="hud-label">LIVES</span>
                <strong className="lives">
                  {'◆'.repeat(lives)}
                  <span>{'◇'.repeat(3 - lives)}</span>
                </strong>
              </div>
              <div>
                <span className="hud-label">WAVE</span>
                <strong>{String(wave).padStart(2, '0')}</strong>
              </div>
              <div className="power-readout">
                <span className="hud-label">POWER-UP</span>
                <strong>{activePower}</strong>
              </div>
            </div>
          ) : null}
          {screen === 'menu' ? (
            <div className="overlay menu-overlay">
              <div className="eyebrow">DEEP SPACE // SECTOR 07</div>
              <h1>
                Astro <em>Survivor</em>
              </h1>
              <p className="lede">
                Hold the line. Break the swarm.
                <br />
                How long can you stay in orbit?
              </p>
              <div className="menu-actions">
                <button className="primary-button" onClick={startGame}>
                  Launch mission <span>↗</span>
                </button>
                <button className="secondary-button" onClick={toggleSound}>
                  {soundOn ? '◉ Sound on' : '○ Sound off'}
                </button>
              </div>
              <div className="controls-card">
                <span className="controls-title">FLIGHT CONTROLS</span>
                <div className="controls-grid">
                  <div>
                    <kbd>←</kbd>
                    <kbd>→</kbd>
                    <span>Steer</span>
                  </div>
                  <div>
                    <kbd>A</kbd>
                    <kbd>D</kbd>
                    <span>Steer</span>
                  </div>
                  <div>
                    <kbd>SPACE</kbd>
                    <span>Fire</span>
                  </div>
                </div>
              </div>
              <div className="menu-footer">
                <span>
                  HIGH SCORE <strong>{formatScore(highScore)}</strong>
                </span>
                <span>LOCAL ARCADE // NO SIGNAL REQUIRED</span>
              </div>
            </div>
          ) : null}
          {screen === 'paused' ? (
            <div className="overlay pause-overlay">
              <div className="pause-kicker">FLIGHT CONTROL</div>
              <h2>Systems paused</h2>
              <p>Take a breath, pilot. The sector is frozen.</p>
              <button className="primary-button" onClick={() => setScreen('playing')}>
                Resume mission <span>▶</span>
              </button>
              <button className="text-button" onClick={() => setScreen('menu')}>
                Abort to main menu
              </button>
            </div>
          ) : null}
          {screen === 'gameover' ? (
            <div className="overlay gameover-overlay">
              <div className="eyebrow">SIGNAL LOST // RUN COMPLETE</div>
              <h2>
                Mission <em>over</em>
              </h2>
              <div className="final-score">
                <span>FINAL SCORE</span>
                <strong>{formatScore(score)}</strong>
              </div>
              <p className={newHigh ? 'high-callout' : ''}>
                {newHigh ? '✦ New high score achieved' : `Best score: ${formatScore(highScore)}`}
              </p>
              <div className="menu-actions">
                <button className="primary-button" onClick={startGame}>
                  Play again <span>↗</span>
                </button>
                <button className="text-button" onClick={() => setScreen('menu')}>
                  Return to main menu
                </button>
              </div>
            </div>
          ) : null}
          {screen === 'playing' ? (
            <div className="touch-controls">
              <button
                aria-label="Move left"
                onPointerDown={() => holdControl('left', true)}
                onPointerUp={() => holdControl('left', false)}
                onPointerLeave={() => holdControl('left', false)}
              >
                ←
              </button>
              <button
                className="touch-fire"
                aria-label="Fire"
                onPointerDown={() => holdControl('shoot', true)}
                onPointerUp={() => holdControl('shoot', false)}
                onPointerLeave={() => holdControl('shoot', false)}
              >
                ✦
              </button>
              <button
                aria-label="Move right"
                onPointerDown={() => holdControl('right', true)}
                onPointerUp={() => holdControl('right', false)}
                onPointerLeave={() => holdControl('right', false)}
              >
                →
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
