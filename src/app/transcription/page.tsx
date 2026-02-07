"use client";

import { useState, useRef, useCallback } from "react";

interface TranscriptEntry {
  id: number;
  text: string;
  isFinal: boolean;
  timestamp: Date;
}

const STT_SAMPLE_RATE = 16000;
const STT_MODEL = "ink-whisper";
const STT_ENCODING = "pcm_s16le";
const STT_LANGUAGE = "en";

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [partialText, setPartialText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const entryIdRef = useRef(0);

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

    setIsRecording(false);
    setPartialText("");
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setIsConnecting(true);

    try {
      // 1. Get access token from our API route
      console.log("[Grape] Requesting Cartesia access token...");
      const tokenRes = await fetch("/api/cartesia-token", { method: "POST" });
      if (!tokenRes.ok) {
        throw new Error(`Token request failed: ${tokenRes.status}`);
      }
      const tokenData = await tokenRes.json();
      console.log("[Grape] Token response:", tokenData);
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
      console.log("[Grape] Connecting to Cartesia STT WebSocket...", wsUrl.replace(accessToken, "***"));

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          console.log("[Grape] WebSocket connected");
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

      // 3. Listen for transcription results
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("[Grape] STT message:", data);

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
              setTranscripts((prev) => [...prev, entry]);
              console.log("[Grape] FINAL:", text);
            }
            setPartialText("");
          } else {
            setPartialText(data.text);
            console.log("[Grape] partial:", data.text);
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

      // 4. Capture microphone audio
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

      // 5. Process audio with AudioWorklet for PCM extraction
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
  }, [stop]);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Grape
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Real-time meeting transcription
        </p>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
        {/* Controls */}
        <div className="flex items-center gap-4">
          <button
            onClick={isRecording ? stop : start}
            disabled={isConnecting}
            className={`flex h-12 items-center gap-2 rounded-full px-6 font-medium transition-colors ${
              isRecording
                ? "bg-red-600 text-white hover:bg-red-700"
                : isConnecting
                  ? "cursor-wait bg-zinc-300 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
                  : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            }`}
          >
            {isRecording ? (
              <>
                <span className="h-3 w-3 animate-pulse rounded-full bg-white" />
                Stop Recording
              </>
            ) : isConnecting ? (
              "Connecting..."
            ) : (
              "Start Recording"
            )}
          </button>

          {isRecording && (
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              Listening...
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Transcript */}
        <div className="flex-1 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Transcript
          </h2>

          {transcripts.length === 0 && !partialText ? (
            <p className="text-zinc-400 dark:text-zinc-600">
              {isRecording
                ? "Waiting for speech..."
                : "Press Start Recording to begin."}
            </p>
          ) : (
            <div className="space-y-2">
              {transcripts.map((entry) => (
                <div key={entry.id} className="flex gap-3">
                  <span className="shrink-0 pt-1 font-mono text-xs text-zinc-400 dark:text-zinc-600">
                    {entry.timestamp.toLocaleTimeString()}
                  </span>
                  <p className="text-zinc-900 dark:text-zinc-100">
                    {entry.text}
                  </p>
                </div>
              ))}

              {partialText && (
                <div className="flex gap-3">
                  <span className="shrink-0 pt-1 font-mono text-xs text-zinc-400 dark:text-zinc-600">
                    {new Date().toLocaleTimeString()}
                  </span>
                  <p className="italic text-zinc-400 dark:text-zinc-500">
                    {partialText}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
