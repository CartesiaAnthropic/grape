"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";

const ShaderGradientCanvas = dynamic(
  () => import("@shadergradient/react").then((m) => m.ShaderGradientCanvas),
  { ssr: false }
);
const ShaderGradient = dynamic(
  () => import("@shadergradient/react").then((m) => m.ShaderGradient),
  { ssr: false }
);

// Parse "#rrggbb" to [r, g, b]
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// [r, g, b] to "#rrggbb"
function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

type ColorSet = [string, string, string];

function useSmoothColors(target: ColorSet, duration = 1200): ColorSet {
  const [current, setCurrent] = useState<ColorSet>(target);
  const fromRef = useRef<[number, number, number][]>(
    target.map(hexToRgb)
  );
  const toRef = useRef<[number, number, number][]>(target.map(hexToRgb));
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  const animate = useCallback(() => {
    const now = performance.now();
    const elapsed = now - startRef.current;
    const t = Math.min(elapsed / duration, 1);
    // Ease-out cubic
    const ease = 1 - Math.pow(1 - t, 3);

    const from = fromRef.current;
    const to = toRef.current;

    const lerped: ColorSet = [0, 1, 2].map((i) =>
      rgbToHex(
        from[i][0] + (to[i][0] - from[i][0]) * ease,
        from[i][1] + (to[i][1] - from[i][1]) * ease,
        from[i][2] + (to[i][2] - from[i][2]) * ease
      )
    ) as ColorSet;

    setCurrent(lerped);

    if (t < 1) {
      rafRef.current = requestAnimationFrame(animate);
    }
  }, [duration]);

  useEffect(() => {
    // Snapshot current as the "from", set new "to"
    fromRef.current = current.map(hexToRgb) as [number, number, number][];
    toRef.current = target.map(hexToRgb) as [number, number, number][];
    startRef.current = performance.now();

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target[0], target[1], target[2], animate]);

  return current;
}

const DEFAULT_PARAMS = { positionY: -0.5, rotationZ: 90, uSpeed: 0.3, uStrength: 1.5, uDensity: 1.8 };

type ShaderParams = typeof DEFAULT_PARAMS;

const PARAM_KEYS = Object.keys(DEFAULT_PARAMS) as (keyof ShaderParams)[];

function useSmoothParams(target: ShaderParams, duration = 1500): ShaderParams {
  const [current, setCurrent] = useState<ShaderParams>(target);
  const fromRef = useRef<ShaderParams>({ ...target });
  const toRef = useRef<ShaderParams>({ ...target });
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  const animate = useCallback(() => {
    const now = performance.now();
    const elapsed = now - startRef.current;
    const t = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);

    const from = fromRef.current;
    const to = toRef.current;
    const lerped = {} as ShaderParams;
    for (const k of PARAM_KEYS) {
      lerped[k] = from[k] + (to[k] - from[k]) * ease;
    }

    setCurrent(lerped);

    if (t < 1) {
      rafRef.current = requestAnimationFrame(animate);
    }
  }, [duration]);

  useEffect(() => {
    fromRef.current = { ...current };
    toRef.current = { ...target };
    startRef.current = performance.now();

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.positionY, target.rotationZ, target.uSpeed, target.uStrength, target.uDensity, animate]);

  return current;
}

function useMicLevel(active: boolean): number {
  const [level, setLevel] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!active) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
      setLevel(0);
      return;
    }

    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const ctx = new AudioContext();
        audioCtxRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.92;
        source.connect(analyser);

        const dataArray = new Float32Array(analyser.fftSize);
        let smoothed = 0;

        function tick() {
          if (cancelled) return;
          analyser.getFloatTimeDomainData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
          }
          const rms = Math.sqrt(sum / dataArray.length);
          const normalized = Math.min(1, rms * 3);
          // Exponential moving average for smoothness
          smoothed += (normalized - smoothed) * 0.12;
          setLevel(smoothed);
          rafRef.current = requestAnimationFrame(tick);
        }
        tick();
      } catch (err) {
        console.error("Mic access failed:", err);
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, [active]);

  return level;
}

const IDLE_COLORS: ColorSet = ["#d5e1cb", "#c1d7c5", "#f0edd4"];
const STARTED_COLORS: ColorSet = ["#98d760", "#89b946", "#f0edd4"];

const PRESETS: { name: string; colors: ColorSet; swatch: string; params?: Partial<ShaderParams> }[] = [
  { name: "Green", colors: ["#98d760", "#89b946", "#f0edd4"], swatch: "#98d760" },
  { name: "Sunshine", colors: ["#f5c842", "#e8a832", "#7db848"], swatch: "#f5c842" },
  { name: "Sunrise", colors: ["#7db848", "#c8b840", "#f5c842"], swatch: "#e8a832" },
  { name: "Crimson Sunrise", colors: ["#5cb030", "#d06828", "#d42020"], swatch: "#d42020" },
  { name: "Violet Sunrise", colors: ["#5cb030", "#8848c8", "#7018e0"], swatch: "#7018e0" },
  { name: "Cobalt Sunrise", colors: ["#5cb030", "#2880d0", "#1848e8"], swatch: "#1848e8" },
  { name: "Neon", colors: ["#b0ff6b", "#ffe414", "#32fb54"], swatch: "#b0ff6b", params: { positionY: -1.2, rotationZ: 97, uSpeed: 0.5, uStrength: 1.7, uDensity: 1.4 } },
  { name: "Candy", colors: ["#a30ac2", "#fff18a", "#fb32e0"], swatch: "#a30ac2", params: { positionY: -1.8, rotationZ: 97, uSpeed: 0.5, uStrength: 0.9, uDensity: 1.2 } },
  { name: "Ocean", colors: ["#2d6ee6", "#4a9be8", "#a0d4f5"], swatch: "#2d6ee6" },
  { name: "Purple", colors: ["#8b5cf6", "#a78bfa", "#ddd6fe"], swatch: "#8b5cf6" },
  { name: "Forest Fire", colors: ["#7db848", "#a0c868", "#c43a31"], swatch: "#c43a31" },
  { name: "Autumn", colors: ["#7db848", "#c4783a", "#c43a31"], swatch: "#c4783a" },
  { name: "Golden", colors: ["#f5c842", "#e8a832", "#ffcf24"], swatch: "#f5c842", params: { uSpeed: 1.4, uStrength: 1.9 } },
];

export default function Home() {
  const [started, setStarted] = useState(false);
  const [activePreset, setActivePreset] = useState(6);
  const [useCustom, setUseCustom] = useState(false);
  const [customColors, setCustomColors] = useState<ColorSet>(["#7db848", "#c8b840", "#f5c842"]);
  const [customParams, setCustomParams] = useState({
    positionY: -0.5,
    rotationZ: 90,
    uSpeed: 0.3,
    uStrength: 1.5,
    uDensity: 1.8,
  });
  const [showCustomEditor, setShowCustomEditor] = useState(false);

  const micLevel = useMicLevel(started);

  const targetColors = !started ? IDLE_COLORS : useCustom ? customColors : PRESETS[activePreset].colors;
  const [c1, c2, c3] = useSmoothColors(targetColors, 1500);
  const targetParams = !started
    ? { ...DEFAULT_PARAMS, uSpeed: 0.2 }
    : useCustom
      ? customParams
      : { ...DEFAULT_PARAMS, ...PRESETS[activePreset].params };
  const params = useSmoothParams(targetParams, 1500);

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ backgroundColor: "#f0edd4" }}
    >
      {/* ShaderGradient — the grape itself */}
      <div
        className="absolute pointer-events-none"
        style={{
          filter: "blur(20px)",
          WebkitMaskImage:
            "radial-gradient(ellipse closest-side at 50% 50%, black 0%, black 50%, transparent 28%)",
          maskImage:
            "radial-gradient(ellipse closest-side at 50% 50%, black 0%, black 50%, transparent 28%)",
          width: "290px",
          height: "367px",
          left: "50%",
          top: "50%",
          transform: `translate(-50%, -50%) scale(${started ? 1.45 * (0.875 + micLevel * 0.25) : 0.42})`,
          opacity: 1,
          transition: started
            ? "transform 0.15s ease-out"
            : "transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <ShaderGradientCanvas
          pixelDensity={4}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
          pointerEvents="none"
        >
          <ShaderGradient
            type="waterPlane"
            color1={c1}
            color2={c2}
            color3={c3}
            animate="on"
            uSpeed={params.uSpeed}
            uStrength={params.uStrength}
            uDensity={params.uDensity}
            uFrequency={3.5}
            cDistance={24}
            cPolarAngle={80}
            cAzimuthAngle={180}
            positionX={0}
            positionY={params.positionY}
            positionZ={0}
            rotationX={0}
            rotationY={0}
            rotationZ={targetParams.rotationZ}
          />
        </ShaderGradientCanvas>
      </div>

      {/* Content layer */}
      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Wordmark */}
        <div className="p-8 sm:p-10">
          <span
            className="text-[17px] font-medium tracking-[-0.01em]"
            style={{ color: "#2a2a2a" }}
          >
            grape
          </span>
        </div>

        {/* Center area */}
        <div className="flex flex-1 flex-col items-center justify-end pb-[6vh]">
          {/* Start button */}
          <button
            onClick={() => setStarted(!started)}
            className="cursor-pointer rounded-xl px-14 py-5 text-lg font-medium tracking-wide transition-transform duration-300 ease-out hover:scale-[1.08]"
            style={{
              backgroundColor: "#f0f0f0",
              color: "#1a1a1a",
              boxShadow: "0 2px 12px rgba(0, 0, 0, 0.08)",
              fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            }}
          >
            {started ? "Stop Listening" : "Start Grape"}
          </button>

        </div>
      </div>

      {/* Dev menu — always visible, bottom-right */}
      <div
        className="fixed bottom-4 right-4 z-50 rounded-xl p-3 flex flex-col gap-2"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(12px)",
          minWidth: "160px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <span
          className="text-[11px] font-medium tracking-wider uppercase px-1"
          style={{ color: "rgba(255,255,255,0.4)" }}
        >
          Palette
        </span>
        {PRESETS.map((preset, i) => (
          <button
            key={preset.name}
            onClick={() => {
              setActivePreset(i);
              setUseCustom(false);
              setCustomColors([...preset.colors] as ColorSet);
              setCustomParams({ ...DEFAULT_PARAMS, ...preset.params });
            }}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm cursor-pointer transition-colors duration-200"
            style={{
              backgroundColor:
                !useCustom && activePreset === i
                  ? "rgba(255,255,255,0.15)"
                  : "transparent",
              color: "#fff",
            }}
          >
            <span
              className="block w-3 h-3 rounded-full shrink-0"
              style={{
                backgroundColor: preset.swatch,
                boxShadow:
                  !useCustom && activePreset === i
                    ? `0 0 6px ${preset.swatch}`
                    : "none",
              }}
            />
            {preset.name}
          </button>
        ))}

        {/* Divider */}
        <div style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.1)", margin: "4px 0" }} />

        {/* Mic signal */}
        <span
          className="text-[11px] font-medium tracking-wider uppercase px-1"
          style={{ color: "rgba(255,255,255,0.4)" }}
        >
          Mic Signal
        </span>
        <div className="px-1 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <div
              className="flex-1 h-2 rounded-full overflow-hidden"
              style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${micLevel * 100}%`,
                  backgroundColor: micLevel > 0.7 ? "#ff4444" : micLevel > 0.4 ? "#f5c842" : "#4ade80",
                  transition: "width 0.08s linear, background-color 0.2s",
                }}
              />
            </div>
            <span
              className="text-[10px] font-mono shrink-0"
              style={{ color: "rgba(255,255,255,0.5)", minWidth: "32px", textAlign: "right" }}
            >
              {micLevel.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
              Scale
            </span>
            <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
              {started ? (1.45 * (0.875 + micLevel * 0.25)).toFixed(2) : "0.42"}x
            </span>
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.1)", margin: "4px 0" }} />

        {/* Custom gradient toggle */}
        <button
          onClick={() => {
            setShowCustomEditor(!showCustomEditor);
            setUseCustom(true);
          }}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm cursor-pointer transition-colors duration-200"
          style={{
            backgroundColor: useCustom ? "rgba(255,255,255,0.15)" : "transparent",
            color: "#fff",
          }}
        >
          <span
            className="block w-3 h-3 rounded-full shrink-0"
            style={{
              background: `linear-gradient(135deg, ${customColors[0]}, ${customColors[1]}, ${customColors[2]})`,
              boxShadow: useCustom ? `0 0 6px ${customColors[0]}` : "none",
            }}
          />
          Custom
          <span
            className="ml-auto text-[10px]"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            {showCustomEditor ? "\u25B2" : "\u25BC"}
          </span>
        </button>

        {/* Custom editor panel */}
        {showCustomEditor && (
          <div className="flex flex-col gap-3 px-1 pt-1">
            {/* Color pickers */}
            {(["Color 1", "Color 2", "Color 3"] as const).map((label, i) => (
              <label key={label} className="flex items-center gap-2">
                <input
                  type="color"
                  value={customColors[i]}
                  onChange={(e) => {
                    const next = [...customColors] as ColorSet;
                    next[i] = e.target.value;
                    setCustomColors(next);
                    setUseCustom(true);
                  }}
                  className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                  style={{ backgroundColor: "transparent" }}
                />
                <span className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                  {label}
                </span>
                <span className="ml-auto text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {customColors[i]}
                </span>
              </label>
            ))}

            {/* Divider */}
            <div style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.08)", margin: "2px 0" }} />

            {/* Sliders */}
            {([
              { key: "positionY" as const, label: "Y Offset", min: -3, max: 3, step: 0.1 },
              { key: "rotationZ" as const, label: "Rotation", min: 0, max: 360, step: 1 },
              { key: "uSpeed" as const, label: "Speed", min: 0, max: 2, step: 0.05 },
              { key: "uStrength" as const, label: "Strength", min: 0, max: 5, step: 0.1 },
              { key: "uDensity" as const, label: "Density", min: 0.5, max: 5, step: 0.1 },
            ]).map(({ key, label, min, max, step }) => (
              <label key={key} className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>
                    {label}
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
                    {customParams[key].toFixed(key === "rotationZ" ? 0 : 1)}
                  </span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={customParams[key]}
                  onChange={(e) => {
                    setCustomParams((prev) => ({ ...prev, [key]: parseFloat(e.target.value) }));
                    setUseCustom(true);
                  }}
                  className="w-full h-1 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: "#fff", backgroundColor: "rgba(255,255,255,0.15)" }}
                />
              </label>
            ))}

            {/* Copy to clipboard */}
            <button
              onClick={() => {
                const code = `{ name: "Custom", colors: ["${customColors[0]}", "${customColors[1]}", "${customColors[2]}"], swatch: "${customColors[0]}" }`;
                navigator.clipboard.writeText(code);
              }}
              className="mt-1 px-2 py-1.5 rounded-lg text-[11px] cursor-pointer transition-colors duration-200"
              style={{
                backgroundColor: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.5)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              Copy preset code
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
