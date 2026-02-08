"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { CartesiaClient, WebPlayer } from "@cartesia/cartesia-js";

const ShaderGradientCanvas = dynamic(
  () => import("@shadergradient/react").then((m) => m.ShaderGradientCanvas),
  { ssr: false }
);
const ShaderGradient = dynamic(
  () => import("@shadergradient/react").then((m) => m.ShaderGradient),
  { ssr: false }
);

interface TranscriptEntry {
  id: number;
  text: string;
  isFinal: boolean;
  timestamp: Date;
}

// STT config
const STT_SAMPLE_RATE = 16000;
const STT_MODEL = "ink-whisper";
const STT_ENCODING = "pcm_s16le";
const STT_LANGUAGE = "en";

// TTS config
const TTS_VOICE_ID = "a01c369f-6d2d-4185-bc20-b32c225eab70"; // Fiona - chirpy British female

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

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
  const fromRef = useRef<[number, number, number][]>(target.map(hexToRgb));
  const toRef = useRef<[number, number, number][]>(target.map(hexToRgb));
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  const animate = useCallback(() => {
    const now = performance.now();
    const elapsed = now - startRef.current;
    const t = Math.min(elapsed / duration, 1);
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

const DEFAULT_PARAMS = {
  positionY: -0.5,
  rotationZ: 90,
  uSpeed: 0.3,
  uStrength: 1.5,
  uDensity: 1.8,
};

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
  }, [
    target.positionY,
    target.rotationZ,
    target.uSpeed,
    target.uStrength,
    target.uDensity,
    animate,
  ]);

  return current;
}

const IDLE_COLORS: ColorSet = ["#d5e1cb", "#c1d7c5", "#f0edd4"];

const PRESETS: {
  name: string;
  colors: ColorSet;
  swatch: string;
  params?: Partial<ShaderParams>;
}[] = [
  {
    name: "Researching",
    colors: ["#b0ff6b", "#4dc3ff", "#32fb54"],
    swatch: "#4dc3ff",
    params: { positionY: -1.2, rotationZ: 97, uSpeed: 0.5, uStrength: 1.7, uDensity: 1.4 },
  },
  {
    name: "Purple Researching",
    colors: ["#b0ff6b", "#ae33f0", "#32fb54"],
    swatch: "#ae33f0",
    params: { positionY: -1.2, rotationZ: 97, uSpeed: 0.5, uStrength: 1.7, uDensity: 1.4 },
  },
  {
    name: "Purple Researching 2",
    colors: ["#b0ff6b", "#ba32ec", "#32fb54"],
    swatch: "#ba32ec",
    params: { positionY: -1.2, rotationZ: 97, uSpeed: 0.5, uStrength: 1.7, uDensity: 1.4 },
  },
  { name: "Green", colors: ["#98d760", "#89b946", "#f0edd4"], swatch: "#98d760" },
  { name: "Sunshine", colors: ["#f5c842", "#e8a832", "#7db848"], swatch: "#f5c842" },
  { name: "Sunrise", colors: ["#7db848", "#c8b840", "#f5c842"], swatch: "#e8a832" },
  {
    name: "Crimson Sunrise",
    colors: ["#5cb030", "#d06828", "#d42020"],
    swatch: "#d42020",
  },
  {
    name: "Violet Sunrise",
    colors: ["#5cb030", "#8848c8", "#7018e0"],
    swatch: "#7018e0",
  },
  {
    name: "Cobalt Sunrise",
    colors: ["#5cb030", "#2880d0", "#1848e8"],
    swatch: "#1848e8",
  },
  {
    name: "Neon",
    colors: ["#b0ff6b", "#ffe414", "#32fb54"],
    swatch: "#b0ff6b",
    params: { positionY: -1.2, rotationZ: 97, uSpeed: 0.5, uStrength: 1.7, uDensity: 1.4 },
  },
  {
    name: "Candy",
    colors: ["#a30ac2", "#fff18a", "#fb32e0"],
    swatch: "#a30ac2",
    params: { positionY: -1.8, rotationZ: 97, uSpeed: 0.5, uStrength: 0.9, uDensity: 1.2 },
  },
  { name: "Ocean", colors: ["#2d6ee6", "#4a9be8", "#a0d4f5"], swatch: "#2d6ee6" },
  { name: "Purple", colors: ["#8b5cf6", "#a78bfa", "#ddd6fe"], swatch: "#8b5cf6" },
  {
    name: "Forest Fire",
    colors: ["#7db848", "#a0c868", "#c43a31"],
    swatch: "#c43a31",
  },
  { name: "Autumn", colors: ["#7db848", "#c4783a", "#c43a31"], swatch: "#c4783a" },
  {
    name: "Golden",
    colors: ["#f5c842", "#e8a832", "#ffcf24"],
    swatch: "#f5c842",
    params: { uSpeed: 1.4, uStrength: 1.9 },
  },
];

export default function Playground() {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [partialText, setPartialText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [researchStatus, setResearchStatus] = useState<string>("idle");
  const [showTranscriptPanel, setShowTranscriptPanel] = useState(true);
  const [micLevel, setMicLevel] = useState(0);

  const [activePreset, setActivePreset] = useState(9);
  const [useCustom, setUseCustom] = useState(false);
  const [customColors, setCustomColors] = useState<ColorSet>([
    "#7db848",
    "#c8b840",
    "#f5c842",
  ]);
  const [customParams, setCustomParams] = useState(DEFAULT_PARAMS);
  const [showCustomEditor, setShowCustomEditor] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const entryIdRef = useRef(0);
  const micLevelSmoothRef = useRef(0);

  // TTS refs
  type TtsWebsocket = ReturnType<InstanceType<typeof CartesiaClient>["tts"]["websocket"]>;
  const ttsWsRef = useRef<TtsWebsocket | null>(null);
  const playerRef = useRef<WebPlayer | null>(null);
  const isSpeakingRef = useRef(false);
  const savedOnMessageRef = useRef<((e: MessageEvent) => void) | null>(null);

  // LLM refs
  const isProcessingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const transcriptsRef = useRef<TranscriptEntry[]>([]);
  const researchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastProgressCountRef = useRef(0);

  // Poll research status while recording
  useEffect(() => {
    if (!isRecording) return;
    lastProgressCountRef.current = 0;
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/research-status");
        const data = await res.json();
        setResearchStatus(data.status);
        // Log new progress entries to console
        if (data.progress && data.progress.length > lastProgressCountRef.current) {
          const newEntries = data.progress.slice(lastProgressCountRef.current);
          for (const entry of newEntries) {
            console.log("[Grape Research]", entry);
          }
          lastProgressCountRef.current = data.progress.length;
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
    researchPollRef.current = poll;
    return () => {
      clearInterval(poll);
      researchPollRef.current = null;
    };
  }, [isRecording]);

  const CANDY_INDEX = 10;
  const effectivePreset = isSpeaking ? CANDY_INDEX : activePreset;

  const targetColors =
    !isRecording ? IDLE_COLORS : useCustom && !isSpeaking ? customColors : PRESETS[effectivePreset].colors;
  const [c1, c2, c3] = useSmoothColors(targetColors, 1500);

  const targetParams = !isRecording
    ? { ...DEFAULT_PARAMS, uSpeed: 0.2 }
    : useCustom && !isSpeaking
      ? customParams
      : { ...DEFAULT_PARAMS, ...PRESETS[effectivePreset].params };
  const params = useSmoothParams(targetParams, 1500);

  const speakTTS = useCallback(async (message: string) => {
    if (!ttsWsRef.current || !playerRef.current) {
      console.warn("[Grape] TTS not initialized, skipping response");
      return;
    }
    if (isSpeakingRef.current) {
      console.log("[Grape] Already speaking, skipping");
      return;
    }

    console.log("[Grape] Speaking:", message);
    setIsSpeaking(true);
    isSpeakingRef.current = true;

    // Pause sending mic audio to STT to avoid echo feedback.
    if (workletNodeRef.current) {
      savedOnMessageRef.current = workletNodeRef.current.port.onmessage as
        | ((e: MessageEvent) => void)
        | null;
      workletNodeRef.current.port.onmessage = null;
    }

    try {
      const { source } = await ttsWsRef.current.send({
        modelId: "sonic-2",
        transcript: message,
        voice: { mode: "id", id: TTS_VOICE_ID },
        language: "en",
      });

      await playerRef.current.play(source);
      console.log("[Grape] Finished speaking");
    } catch (err) {
      console.error("[Grape] TTS playback failed:", err);
    } finally {
      // Resume sending mic audio to STT.
      if (workletNodeRef.current && savedOnMessageRef.current) {
        workletNodeRef.current.port.onmessage = savedOnMessageRef.current;
        savedOnMessageRef.current = null;
      }
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    }
  }, []);

  const sendToLLM = useCallback(
    async (allTranscripts: TranscriptEntry[]) => {
      if (isProcessingRef.current || isSpeakingRef.current) {
        console.log("[Grape] Skipping LLM call: already processing or speaking");
        return;
      }

      if (allTranscripts.length === 0) return;

      const latest = allTranscripts[allTranscripts.length - 1].text;
      const history = allTranscripts.slice(0, -1).map((t) => t.text).join(" ");

      if (!latest.trim()) return;

      console.log("[Grape] Sending transcript to LLM...");
      isProcessingRef.current = true;
      setIsProcessing(true);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const res = await fetch("/api/playground", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ history, latest }),
          signal: abortController.signal,
        });

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let llmText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") break;

            try {
              const data = JSON.parse(payload);

              if (data.type === "tool_use" && data.name === "speak_to_user") {
                console.log("[Grape] LLM wants to speak:", data.input?.message);
                speakTTS(data.input?.message);
              }

              if (data.type === "text") {
                llmText += data.text;
              }

              if (data.type === "error") {
                console.error("[Grape] LLM error:", data.text);
              }

              if (data.type === "research_status") {
                console.log("[Grape] Research started:", data.question);
                setResearchStatus(data.status);
              }
            } catch {
              // Skip malformed JSON lines.
            }
          }
        }

        if (llmText) {
          console.log("[Grape] LLM response:", llmText.trim());
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("[Grape] LLM request failed:", err);
        }
      } finally {
        isProcessingRef.current = false;
        setIsProcessing(false);
        abortControllerRef.current = null;
      }
    },
    [speakTTS]
  );

  const stop = useCallback(() => {
    console.log("[Grape] Stopping recording...");

    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send("finalize");
      }
      wsRef.current.close();
      wsRef.current = null;
    }

    // TTS cleanup
    if (ttsWsRef.current) {
      ttsWsRef.current.disconnect();
      ttsWsRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.stop().catch(() => {});
      playerRef.current = null;
    }
    isSpeakingRef.current = false;
    savedOnMessageRef.current = null;

    // LLM cleanup
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    isProcessingRef.current = false;

    micLevelSmoothRef.current = 0;
    setMicLevel(0);
    transcriptsRef.current = [];
    setTranscripts([]);
    setIsRecording(false);
    setIsSpeaking(false);
    setIsProcessing(false);
    setPartialText("");
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setIsConnecting(true);
    transcriptsRef.current = [];
    micLevelSmoothRef.current = 0;

    try {
      // 1. Get access token from our API route
      console.log("[Grape] Requesting Cartesia access token...");
      const tokenRes = await fetch("/api/cartesia-token", { method: "POST" });
      if (!tokenRes.ok) {
        throw new Error(`Token request failed: ${tokenRes.status}`);
      }
      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;
      if (!accessToken) {
        throw new Error("No access_token in response");
      }

      // 2. Connect WebSocket to Cartesia STT
      const params = new URLSearchParams({
        access_token: accessToken,
        cartesia_version: "2024-06-10",
        model: STT_MODEL,
        language: STT_LANGUAGE,
        encoding: STT_ENCODING,
        sample_rate: String(STT_SAMPLE_RATE),
      });
      const wsUrl = `wss://api.cartesia.ai/stt/websocket?${params}`;
      console.log("[Grape] Connecting to Cartesia STT WebSocket...");

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          console.log("[Grape] STT WebSocket connected");
          resolve();
        };
        ws.onerror = (e) => {
          console.error("[Grape] WebSocket onerror event:", e);
          reject(new Error("WebSocket connection failed"));
        };
        ws.onclose = (e) => {
          console.error("[Grape] WebSocket closed during connect:", e.code, e.reason);
          reject(new Error(`WebSocket closed: ${e.code} ${e.reason}`));
        };
        setTimeout(() => reject(new Error("WebSocket connection timeout")), 10000);
      });

      // 3. Initialize TTS WebSocket
      try {
        const ttsClient = new CartesiaClient();
        const ttsWs = ttsClient.tts.websocket({
          sampleRate: 24000,
          container: "raw",
          encoding: "pcm_f32le",
        });
        await ttsWs.connect({ accessToken });
        ttsWsRef.current = ttsWs;
        playerRef.current = new WebPlayer({ bufferDuration: 1 });
        console.log("[Grape] TTS WebSocket connected");
      } catch (ttsErr) {
        console.error("[Grape] TTS initialization failed (STT still works):", ttsErr);
      }

      // 4. Listen for transcription results
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "transcript") {
          if (data.is_final) {
            const text = (data.text ?? "").trim();
            if (text) {
              const entry: TranscriptEntry = {
                id: entryIdRef.current++,
                text,
                isFinal: true,
                timestamp: new Date(),
              };
              transcriptsRef.current = [...transcriptsRef.current, entry];
              setTranscripts(transcriptsRef.current);
              console.log("[Grape] FINAL:", text);

              // Send to LLM for decision
              sendToLLM(transcriptsRef.current);
            }
            setPartialText("");
          } else {
            setPartialText(data.text);
          }
        } else if (data.type === "error") {
          console.error("[Grape] STT error:", data.message);
          setError(data.message);
        }
      };

      ws.onclose = (event) => {
        console.log("[Grape] WebSocket closed:", event.code, event.reason);
        stop();
      };

      ws.onerror = (event) => {
        console.error("[Grape] WebSocket error:", event);
      };

      // 5. Capture microphone audio
      console.log("[Grape] Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: STT_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;
      console.log("[Grape] Microphone access granted");

      // 6. Process audio with AudioWorklet for PCM extraction
      const audioCtx = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
      audioContextRef.current = audioCtx;

      const workletCode = `
        class PcmProcessor extends AudioWorkletProcessor {
          process(inputs) {
            const input = inputs[0];
            if (input && input[0]) {
              const float32 = input[0];
              const int16 = new Int16Array(float32.length);
              for (let i = 0; i < float32.length; i++) {
                const s = Math.max(-1, Math.min(1, float32[i]));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
              }
              this.port.postMessage(int16.buffer, [int16.buffer]);
            }
            return true;
          }
        }
        registerProcessor('pcm-processor', PcmProcessor);
      `;
      const blob = new Blob([workletCode], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const source = audioCtx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (e) => {
        const samples = new Int16Array(e.data as ArrayBuffer);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          const normalized = samples[i] / 32768;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / samples.length);
        const nextLevel = Math.min(1, rms * 3);
        micLevelSmoothRef.current += (nextLevel - micLevelSmoothRef.current) * 0.12;
        setMicLevel(micLevelSmoothRef.current);

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(e.data);
        }
      };

      source.connect(workletNode);

      setIsRecording(true);
      setIsConnecting(false);
      console.log("[Grape] Recording started - speak now!");
    } catch (err) {
      console.error("[Grape] Start failed:", err);
      setError(err instanceof Error ? err.message : "Failed to start");
      setIsConnecting(false);
      stop();
    }
  }, [stop, sendToLLM]);

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ backgroundColor: "#f0edd4" }}
    >
      {showTranscriptPanel && (
        <aside
          className="fixed left-0 top-0 z-40 h-full w-[310px] border-r px-4 py-4"
          style={{
            backgroundColor: "rgba(240, 237, 212, 0.93)",
            borderColor: "rgba(42,42,42,0.12)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-black/50">
              Transcript
            </h2>
            <button
              onClick={() => setShowTranscriptPanel(false)}
              className="rounded-lg px-2 py-1 text-xs cursor-pointer"
              style={{ backgroundColor: "rgba(42,42,42,0.08)", color: "#2a2a2a" }}
            >
              Hide
            </button>
          </div>

          <div className="mb-4 flex flex-col gap-1 text-xs">
            {isRecording && !isSpeaking && !isProcessing && (
              <span style={{ color: "#2a2a2a" }}>Listening...</span>
            )}
            {isProcessing && !isSpeaking && (
              <span style={{ color: "#1d4ed8" }}>Thinking...</span>
            )}
            {isSpeaking && <span style={{ color: "#7e22ce" }}>Grape is speaking...</span>}
            {!isRecording && !isConnecting && !error && (
              <span style={{ color: "rgba(42,42,42,0.6)" }}>Press Start Grape to begin.</span>
            )}
            {error && (
              <span className="rounded-md px-2 py-1" style={{ backgroundColor: "#fee2e2", color: "#991b1b" }}>
                {error}
              </span>
            )}
          </div>

          <div className="h-[calc(100%-120px)] overflow-y-auto pr-1">
            {transcripts.length === 0 && !partialText ? (
              <p className="text-sm" style={{ color: "rgba(42,42,42,0.45)" }}>
                Waiting for speech...
              </p>
            ) : (
              <div className="space-y-2">
                {transcripts.map((entry) => (
                  <div key={entry.id} className="flex gap-2">
                    <span className="shrink-0 pt-1 font-mono text-[10px]" style={{ color: "rgba(42,42,42,0.4)" }}>
                      {entry.timestamp.toLocaleTimeString()}
                    </span>
                    <p className="text-sm" style={{ color: "#1f2937" }}>
                      {entry.text}
                    </p>
                  </div>
                ))}

                {partialText && (
                  <div className="flex gap-2">
                    <span className="shrink-0 pt-1 font-mono text-[10px]" style={{ color: "rgba(42,42,42,0.4)" }}>
                      {new Date().toLocaleTimeString()}
                    </span>
                    <p className="text-sm italic" style={{ color: "rgba(42,42,42,0.55)" }}>
                      {partialText}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      )}

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
          transform: `translate(-50%, -50%) scale(${isRecording ? 1.45 * (0.825 + micLevel * 0.35) : 0.42})`,
          opacity: 1,
          transition: isRecording
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

      <div className="relative z-10 flex min-h-screen flex-col">
        <div className="p-8 sm:p-10">
          <span
            className="tracking-[-0.01em]"
            style={{ color: "#41651d", fontSize: "35px", fontWeight: 600, lineHeight: 1 }}
          >
            grape
          </span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-end pb-[6vh]">
          {!showTranscriptPanel && isRecording && (
            <button
              onClick={() => setShowTranscriptPanel(true)}
              className="mb-3 cursor-pointer"
              style={{
                color: "rgba(42,42,42,0.55)",
                fontSize: "15px",
                fontWeight: 400,
                fontFamily:
                  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Segoe UI', sans-serif",
              }}
            >
              Show Transcript
            </button>
          )}
          <button
            onClick={isRecording ? stop : start}
            disabled={isConnecting}
            className="rounded-xl px-14 py-5 text-lg font-medium tracking-wide transition-transform duration-300 ease-out cursor-pointer hover:scale-[1.08] disabled:cursor-wait disabled:hover:scale-100"
            style={{
              backgroundColor: isRecording ? "#111827" : "#f0f0f0",
              color: isRecording ? "#f9fafb" : "#1a1a1a",
              boxShadow: "0 2px 12px rgba(0, 0, 0, 0.08)",
              fontFamily:
                "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              opacity: isConnecting ? 0.8 : 1,
            }}
          >
            {isConnecting ? "Connecting..." : isRecording ? "Stop Listening" : "Start Grape"}
          </button>
        </div>
      </div>

      <div
        className="fixed bottom-4 right-4 z-50 flex max-h-[90vh] min-w-[160px] flex-col gap-2 overflow-y-auto rounded-xl p-3"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(12px)",
        }}
      >
        {isRecording && (
          <>
            <span
              className="px-1 text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "rgba(255,255,255,0.4)" }}
            >
              Status
            </span>
            <div className="flex items-center gap-2 px-1">
              <span
                className={`h-3 w-3 shrink-0 rounded-full ${
                  isSpeaking
                    ? "bg-purple-500 animate-pulse"
                    : isProcessing
                      ? "bg-blue-500 animate-pulse"
                      : researchStatus === "researching"
                        ? "bg-yellow-500 animate-pulse"
                        : researchStatus === "done"
                          ? "bg-green-500"
                          : "bg-zinc-400"
                }`}
              />
              <span className="text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
                {isSpeaking
                  ? "Speaking..."
                  : isProcessing
                    ? "Thinking..."
                    : researchStatus === "researching"
                      ? "Researching..."
                      : researchStatus === "done"
                        ? "Research ready"
                        : "Listening..."}
              </span>
            </div>
            <div
              style={{
                height: "1px",
                backgroundColor: "rgba(255,255,255,0.1)",
                margin: "4px 0",
              }}
            />
          </>
        )}

        <span
          className="px-1 text-[11px] font-medium uppercase tracking-wider"
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
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors duration-200"
            style={{
              backgroundColor:
                !useCustom && activePreset === i ? "rgba(255,255,255,0.15)" : "transparent",
              color: "#fff",
            }}
          >
            <span
              className="block h-3 w-3 shrink-0 rounded-full"
              style={{
                backgroundColor: preset.swatch,
                boxShadow:
                  !useCustom && activePreset === i ? `0 0 6px ${preset.swatch}` : "none",
              }}
            />
            {preset.name}
          </button>
        ))}

        <div
          style={{
            height: "1px",
            backgroundColor: "rgba(255,255,255,0.1)",
            margin: "4px 0",
          }}
        />

        <span
          className="px-1 text-[11px] font-medium uppercase tracking-wider"
          style={{ color: "rgba(255,255,255,0.4)" }}
        >
          Mic Signal
        </span>

        <div className="flex flex-col gap-1.5 px-1">
          <div className="flex items-center gap-2">
            <div
              className="h-2 flex-1 overflow-hidden rounded-full"
              style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${micLevel * 100}%`,
                  backgroundColor:
                    micLevel > 0.7 ? "#ff4444" : micLevel > 0.4 ? "#f5c842" : "#4ade80",
                  transition: "width 0.08s linear, background-color 0.2s",
                }}
              />
            </div>
            <span
              className="shrink-0 font-mono text-[10px]"
              style={{ color: "rgba(255,255,255,0.5)", minWidth: "32px", textAlign: "right" }}
            >
              {micLevel.toFixed(2)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
              Scale
            </span>
            <span className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
              {isRecording ? (1.45 * (0.825 + micLevel * 0.35)).toFixed(2) : "0.42"}x
            </span>
          </div>
        </div>

        <div
          style={{
            height: "1px",
            backgroundColor: "rgba(255,255,255,0.1)",
            margin: "4px 0",
          }}
        />

        <button
          onClick={() => {
            setShowCustomEditor(!showCustomEditor);
            setUseCustom(true);
          }}
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors duration-200"
          style={{
            backgroundColor: useCustom ? "rgba(255,255,255,0.15)" : "transparent",
            color: "#fff",
          }}
        >
          <span
            className="block h-3 w-3 shrink-0 rounded-full"
            style={{
              background: `linear-gradient(135deg, ${customColors[0]}, ${customColors[1]}, ${customColors[2]})`,
              boxShadow: useCustom ? `0 0 6px ${customColors[0]}` : "none",
            }}
          />
          Custom
          <span className="ml-auto text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>
            {showCustomEditor ? "\u25B2" : "\u25BC"}
          </span>
        </button>

        {showCustomEditor && (
          <div className="flex flex-col gap-3 px-1 pt-1">
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
                  className="h-6 w-6 cursor-pointer rounded border-0 p-0"
                  style={{ backgroundColor: "transparent" }}
                />
                <span className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                  {label}
                </span>
                <span className="ml-auto font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {customColors[i]}
                </span>
              </label>
            ))}

            <div
              style={{
                height: "1px",
                backgroundColor: "rgba(255,255,255,0.08)",
                margin: "2px 0",
              }}
            />

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
                  <span className="font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
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
                  className="h-1 w-full cursor-pointer appearance-none rounded-full"
                  style={{ accentColor: "#fff", backgroundColor: "rgba(255,255,255,0.15)" }}
                />
              </label>
            ))}

            <button
              onClick={() => {
                const code = `{ name: \"Custom\", colors: [\"${customColors[0]}\", \"${customColors[1]}\", \"${customColors[2]}\"], swatch: \"${customColors[0]}\" }`;
                navigator.clipboard.writeText(code);
              }}
              className="mt-1 cursor-pointer rounded-lg px-2 py-1.5 text-[11px] transition-colors duration-200"
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
