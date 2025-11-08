"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type FruitKind = {
  name: string;
  base: string;
  highlight: string;
  flesh: string;
  seeds: string;
};

type FruitState = {
  id: number;
  kind: FruitKind;
  x: number;
  y: number;
  radius: number;
  rotation: number;
  state: "enter" | "slice" | "settle" | "exit";
  t: number;
  sliceProgress: number;
  sliceTriggered: boolean;
  halves: {
    angle: number;
    offset: number;
    separation: number;
  }[];
};

type BladeTrack = {
  active: boolean;
  progress: number;
  x: number;
  y: number;
  angle: number;
  width: number;
};

const FRUITS: FruitKind[] = [
  {
    name: "Mango",
    base: "#ff9f54",
    highlight: "#ffd365",
    flesh: "#ffe17e",
    seeds: "rgba(226, 164, 42, 0.7)"
  },
  {
    name: "Dragonfruit",
    base: "#ff477e",
    highlight: "#ff84c2",
    flesh: "#fef9ff",
    seeds: "rgba(12, 12, 12, 0.8)"
  },
  {
    name: "Kiwi",
    base: "#8dc63f",
    highlight: "#b0ff6b",
    flesh: "#d8ffb6",
    seeds: "rgba(29, 60, 29, 0.8)"
  },
  {
    name: "Grapefruit",
    base: "#ff7660",
    highlight: "#ffc2a1",
    flesh: "#ffe5dc",
    seeds: "rgba(238, 134, 119, 0.9)"
  },
  {
    name: "Blueberry",
    base: "#5b6cff",
    highlight: "#a9b9ff",
    flesh: "#d8dcff",
    seeds: "rgba(49, 56, 110, 0.9)"
  }
];

const easing = {
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeInExpo: (t: number) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  easeOutExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))
};

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number) {
  const toHex = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function lighten(hex: string, amount: number) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + amount, g + amount, b + amount);
}

const blade: BladeTrack = {
  active: false,
  progress: 0,
  x: 0,
  y: 0,
  angle: 0,
  width: 0
};

export default function Page() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>();
  const fruitsRef = useRef<FruitState[]>([]);
  const bladeRef = useRef<BladeTrack>({ ...blade });
  const spawnTimerRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ambientRef = useRef<GainNode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [soundLevels, setSoundLevels] = useState([2, 6, 12, 8, 4]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
  }, []);

  const setupAmbient = useCallback(async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    if (ambientRef.current) {
      return;
    }
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const fade = Math.pow(1 - i / data.length, 1.5);
      const noise = Math.random() * 2 - 1;
      data[i] = noise * fade * 0.6;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const slowFilter = ctx.createBiquadFilter();
    slowFilter.type = "lowpass";
    slowFilter.frequency.value = 480;
    slowFilter.Q.value = 0.7;

    const gentleLfo = ctx.createOscillator();
    gentleLfo.frequency.value = 0.2;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    gentleLfo.connect(lfoGain).connect(slowFilter.frequency);
    gentleLfo.start();

    const gain = ctx.createGain();
    gain.gain.value = 0.12;

    source.connect(slowFilter).connect(gain).connect(ctx.destination);
    source.start(0);
    ambientRef.current = gain;
  }, []);

  const playSliceSound = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const duration = 0.45;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) {
      const time = i / ctx.sampleRate;
      const envelope =
        Math.pow(1 - Math.min(time / duration, 1), 1.5) *
        Math.sin(Math.PI * Math.min(time / duration, 1));
      const noise = Math.random() * 2 - 1;
      const tone =
        Math.sin(2 * Math.PI * (920 + Math.sin(time * 12) * 40) * time) * 0.4;
      channel[i] = (noise * 0.4 + tone) * envelope;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const highPass = ctx.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    source.connect(highPass).connect(gain).connect(ctx.destination);
    source.start();
  }, []);

  const spawnFruit = useCallback(
    (width: number, height: number) => {
      const kind = FRUITS[Math.floor(Math.random() * FRUITS.length)];
      const baseRadius = Math.min(width, height) * 0.14;
      const variance = baseRadius * 0.3;
      const fruit: FruitState = {
        id: Math.random(),
        kind,
        x: width * (0.3 + Math.random() * 0.4),
        y: height + 120,
        radius: baseRadius + (Math.random() * 2 - 1) * variance,
        rotation: (Math.random() * Math.PI) / 4,
        state: "enter",
        t: 0,
        sliceProgress: 0,
        sliceTriggered: false,
        halves: [
          { angle: -Math.PI / 2.6, offset: 0, separation: 0 },
          { angle: Math.PI / 2.6, offset: 0, separation: 0 }
        ]
      };
      fruitsRef.current.push(fruit);
    },
    []
  );

  const drawBlade = (ctx: CanvasRenderingContext2D, track: BladeTrack) => {
    if (!track.active) return;
    ctx.save();
    ctx.translate(track.x, track.y);
    ctx.rotate(track.angle);
    const length = 420;
    const thickness = 14;
    const gradient = ctx.createLinearGradient(-length / 2, 0, length / 2, 0);
    gradient.addColorStop(0, "rgba(240, 255, 255, 0)");
    gradient.addColorStop(0.25, "rgba(199, 255, 255, 0.3)");
    gradient.addColorStop(0.55, "rgba(255, 255, 255, 0.75)");
    gradient.addColorStop(0.7, "rgba(199, 255, 255, 0.28)");
    gradient.addColorStop(1, "rgba(240, 255, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.shadowColor = "rgba(140, 255, 255, 0.35)";
    ctx.shadowBlur = 48;
    ctx.beginPath();
    ctx.moveTo(-length / 2, -thickness / 2);
    ctx.lineTo(length / 2, 0);
    ctx.lineTo(-length / 2, thickness / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const drawFruit = (
    ctx: CanvasRenderingContext2D,
    fruit: FruitState,
    time: number
  ) => {
    ctx.save();
    ctx.translate(fruit.x, fruit.y);
    ctx.rotate(fruit.rotation);
    const glow = ctx.createRadialGradient(
      0,
      -fruit.radius * 0.4,
      fruit.radius * 0.3,
      0,
      0,
      fruit.radius * 1.2
    );
    glow.addColorStop(0, `${fruit.kind.highlight}44`);
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(
      0,
      fruit.radius * 0.25,
      fruit.radius * 1.3,
      fruit.radius * 0.5,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    if (fruit.state === "slice" || fruit.state === "settle") {
      fruit.halves.forEach((half, index) => {
        ctx.save();
        const direction = index === 0 ? -1 : 1;
        const separation =
          half.separation * direction + direction * fruit.sliceProgress * 24;
        ctx.translate(separation, half.offset);
        ctx.rotate(half.angle * (0.4 + fruit.sliceProgress * 0.8));

        const gradient = ctx.createLinearGradient(
          -fruit.radius,
          0,
          fruit.radius,
          0
        );
        gradient.addColorStop(0, lighten(fruit.kind.base, 18));
        gradient.addColorStop(0.45, fruit.kind.base);
        gradient.addColorStop(0.55, lighten(fruit.kind.base, 20));
        gradient.addColorStop(1, lighten(fruit.kind.base, 26));
        ctx.fillStyle = gradient;
        ctx.shadowColor = `${fruit.kind.highlight}55`;
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          fruit.radius,
          fruit.radius * 0.85,
          0,
          Math.PI / 8,
          Math.PI * 1.9
        );
        ctx.fill();

        const fleshGradient = ctx.createRadialGradient(
          -fruit.radius * 0.15,
          -fruit.radius * 0.25,
          fruit.radius * 0.2,
          0,
          0,
          fruit.radius * 0.75
        );
        fleshGradient.addColorStop(0, lighten(fruit.kind.flesh, 18));
        fleshGradient.addColorStop(0.7, fruit.kind.flesh);
        fleshGradient.addColorStop(1, lighten(fruit.kind.base, 12));

        ctx.fillStyle = fleshGradient;
        ctx.beginPath();
        ctx.ellipse(
          fruit.radius * 0.15,
          0,
          fruit.radius * 0.8,
          fruit.radius * 0.62,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();

        const seeds = Math.floor(6 + fruit.radius / 12);
        for (let i = 0; i < seeds; i++) {
          const theta =
            (i / seeds) * Math.PI * 1.05 + (index === 0 ? 0 : Math.PI * 0.1);
          const r = fruit.radius * 0.52;
          const sx = Math.cos(theta) * r * 0.7;
          const sy = Math.sin(theta) * r * 0.38;
          ctx.fillStyle = fruit.kind.seeds;
          ctx.beginPath();
          ctx.ellipse(
            sx,
            sy,
            fruit.radius * 0.05,
            fruit.radius * 0.12,
            theta,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
        ctx.restore();
      });
    } else {
      const gradient = ctx.createRadialGradient(
        -fruit.radius * 0.3,
        -fruit.radius * 0.45,
        fruit.radius * 0.1,
        0,
        0,
        fruit.radius
      );
      gradient.addColorStop(0, lighten(fruit.kind.highlight, 30));
      gradient.addColorStop(0.55, fruit.kind.highlight);
      gradient.addColorStop(1, fruit.kind.base);
      ctx.fillStyle = gradient;
      ctx.shadowColor = `${fruit.kind.highlight}55`;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(0, 0, fruit.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    const pulse = (Math.sin(time * 0.002 + fruit.id) + 1) * 0.5;
    if (fruit.state === "settle") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `${fruit.kind.highlight}${Math.round(70 * pulse)
        .toString(16)
        .padStart(2, "0")}`;
      ctx.beginPath();
      ctx.arc(fruit.x, fruit.y, fruit.radius * (1.1 + pulse * 0.2), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => {
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [resizeCanvas]);

  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      lastTimeRef.current = undefined;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = (timestamp: number) => {
      if (!lastTimeRef.current) {
        lastTimeRef.current = timestamp;
      }
      const delta = Math.min((timestamp - lastTimeRef.current) / 1000, 0.035);
      lastTimeRef.current = timestamp;
      const width = canvas.width / (window.devicePixelRatio || 1);
      const height = canvas.height / (window.devicePixelRatio || 1);

      spawnTimerRef.current += delta;
      if (spawnTimerRef.current > 2.4) {
        spawnTimerRef.current = 0;
        spawnFruit(width, height);
      }

      ctx.clearRect(0, 0, width, height);

      const backdropGradient = ctx.createLinearGradient(0, 0, width, height);
      backdropGradient.addColorStop(0, "#021520");
      backdropGradient.addColorStop(1, "#041b2e");
      ctx.fillStyle = backdropGradient;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "rgba(43, 73, 91, 0.38)";
      const padX = width * 0.08;
      const padY = height * 0.75;
      const padW = width * 0.84;
      const padH = height * 0.18;
      const radius = 28;
      ctx.beginPath();
      ctx.moveTo(padX + radius, padY);
      ctx.lineTo(padX + padW - radius, padY);
      ctx.quadraticCurveTo(padX + padW, padY, padX + padW, padY + radius);
      ctx.lineTo(padX + padW, padY + padH - radius);
      ctx.quadraticCurveTo(
        padX + padW,
        padY + padH,
        padX + padW - radius,
        padY + padH
      );
      ctx.lineTo(padX + radius, padY + padH);
      ctx.quadraticCurveTo(padX, padY + padH, padX, padY + padH - radius);
      ctx.lineTo(padX, padY + radius);
      ctx.quadraticCurveTo(padX, padY, padX + radius, padY);
      ctx.closePath();
      ctx.fill();

      const fruits = fruitsRef.current;
      for (let i = fruits.length - 1; i >= 0; i--) {
        const fruit = fruits[i];
        fruit.t += delta;
        switch (fruit.state) {
          case "enter": {
            const progress = Math.min(fruit.t / 1.4, 1);
            const eased = easing.easeOutCubic(progress);
            fruit.y =
              height * 0.32 +
              Math.sin(progress * Math.PI) * -80 +
              easing.easeOutCubic(1 - progress) * 60;
            fruit.rotation += delta * 0.6;
            if (progress >= 1) {
              fruit.state = "slice";
              fruit.t = 0;
            }
            break;
          }
          case "slice": {
            const progress = Math.min(fruit.t / 0.75, 1);
            fruit.sliceProgress = easing.easeInOutCubic(progress);
            if (!fruit.sliceTriggered && fruit.sliceProgress > 0.24) {
              fruit.sliceTriggered = true;
              playSliceSound();
              bladeRef.current.active = true;
              bladeRef.current.progress = 0;
              bladeRef.current.angle = Math.PI / 3.4;
              bladeRef.current.x = fruit.x;
              bladeRef.current.y = fruit.y - 30;
              bladeRef.current.width = fruit.radius * 2.6;
            }
            if (progress >= 1) {
              fruit.state = "settle";
              fruit.t = 0;
            }
            break;
          }
          case "settle": {
            const progress = Math.min(fruit.t / 2.6, 1);
            fruit.halves.forEach((half, index) => {
              const direction = index === 0 ? -1 : 1;
              half.offset =
                easing.easeOutCubic(progress) * 16 * direction +
                Math.sin(timestamp / 450 + index) * 4;
              half.separation = easing.easeOutCubic(progress) * fruit.radius * 0.45;
            });
            if (progress >= 1) {
              fruit.state = "exit";
              fruit.t = 0;
            }
            break;
          }
          case "exit": {
            fruit.y += delta * 24;
            fruit.rotation += delta * 0.3;
            if (fruit.t > 4) {
              fruits.splice(i, 1);
            }
            break;
          }
        }
        drawFruit(ctx, fruit, timestamp);
      }

      const bladeTrack = bladeRef.current;
      if (bladeTrack.active) {
        bladeTrack.progress += delta * 3.2;
        bladeTrack.x += Math.cos(bladeTrack.angle) * bladeTrack.width * delta * 3;
        bladeTrack.y += Math.sin(bladeTrack.angle) * bladeTrack.width * delta * 3;
        if (bladeTrack.progress > 1.1) {
          bladeTrack.active = false;
        }
      }

      drawBlade(ctx, bladeTrack);

      const particlesCount = 28;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < particlesCount; i++) {
        const drift = Math.sin(timestamp / 1200 + i) * 120;
        const px =
          ((i * 97) % particlesCount) * (width / particlesCount) + drift * 0.1;
        const py =
          ((i * 53) % particlesCount) * (height / particlesCount) +
          Math.sin(timestamp / 900 + px) * 40;
        const size = 1.2 + Math.sin(timestamp / 400 + i) * 0.8;
        ctx.fillStyle = "rgba(58, 255, 198, 0.16)";
        ctx.beginPath();
        ctx.arc(px % width, py % height, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      setSoundLevels(prev =>
        prev.map((level, index) => {
          const pulse =
            Math.abs(Math.sin(timestamp / (260 + index * 40))) * 12 +
            Math.random() * 4;
          return level * 0.6 + pulse * 0.4;
        })
      );

      animationRef.current = requestAnimationFrame(render);
    };

    animationRef.current = requestAnimationFrame(render);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, playSliceSound]);

  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => undefined);
      }
    };
  }, []);

  const handleStart = useCallback(async () => {
    setHasStarted(true);
    await setupAmbient();
    setIsPlaying(true);
  }, [setupAmbient]);

  return (
    <div className="glass-panel" ref={containerRef}>
      <canvas ref={canvasRef} />
      <div className="content-overlay">
        <div className="title-stack">
          <h1>Fruit Cutting ASMR</h1>
          <span>Slow visuals · Crisp slices · Hypnotic ambience</span>
        </div>
        <div className="action-area">
          <div className="asmr-pill">Immersive Audio</div>
          {!hasStarted && (
            <button className="asmr-button" onClick={handleStart}>
              Begin
            </button>
          )}
        </div>
      </div>
      <div className="watermark">Slicing Suite · 2024</div>
      <div className="sound-indicator">
        {soundLevels.map((level, idx) => (
          <span
            key={idx}
            style={{
              height: `${Math.max(6, Math.min(26, level))}px`,
              opacity: hasStarted ? 1 : 0.25
            }}
          />
        ))}
      </div>
    </div>
  );
}
