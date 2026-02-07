"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { streamChat } from "../lib/chat-stream";

interface TranscriptEntry {
  id: number;
  text: string;
  isFinal: boolean;
  timestamp: Date;
}

interface AgentAction {
  type: "tool_use" | "text" | "result" | "error";
  name?: string;
  input?: unknown;
  text?: string;
}

const STT_SAMPLE_RATE = 16000;
const STT_MODEL = "ink-whisper";
const STT_ENCODING = "pcm_s16le";
const STT_LANGUAGE = "en";

export default function TranscriptionPage() {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [partialText, setPartialText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Agent state
  const [isProcessing, setIsProcessing] = useState(false);
  const [agentActions, setAgentActions] = useState<AgentAction[]>([]);
  const [agentResult, setAgentResult] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const entryIdRef = useRef(0);
  const lastProcessedCountRef = useRef(0);
  const processingRef = useRef(false);

  const stop = useCallback(() => {
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
      const tokenRes = await fetch("/api/cartesia-token", { method: "POST" });
      if (!tokenRes.ok) {
        throw new Error(`Token request failed: ${tokenRes.status}`);
      }
      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;
      if (!accessToken) {
        throw new Error("No access_token in response");
      }

      const params = new URLSearchParams({
        access_token: accessToken,
        cartesia_version: "2024-06-10",
        model: STT_MODEL,
        language: STT_LANGUAGE,
        encoding: STT_ENCODING,
        sample_rate: String(STT_SAMPLE_RATE),
      });
      const wsUrl = `wss://api.cartesia.ai/stt/websocket?${params}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("WebSocket connection failed"));
        ws.onclose = (e) =>
          reject(new Error(`WebSocket closed: ${e.code} ${e.reason}`));
        setTimeout(() => reject(new Error("WebSocket connection timeout")), 10000);
      });

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
              setTranscripts((prev) => [...prev, entry]);
              console.log("[Grape] FINAL:", text);
            }
            setPartialText("");
          } else {
            setPartialText(data.text);
          }
        } else if (data.type === "error") {
          setError(data.message);
        }
      };

      ws.onclose = () => stop();
      ws.onerror = (event) => console.error("[Grape] WebSocket error:", event);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: STT_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
      setIsConnecting(false);
      stop();
    }
  }, [stop]);

  // Auto-process whenever new transcript entries arrive
  useEffect(() => {
    if (transcripts.length === 0) return;
    if (transcripts.length === lastProcessedCountRef.current) return;
    if (processingRef.current) return;

    const fullTranscript = transcripts.map((t) => t.text).join("\n");
    lastProcessedCountRef.current = transcripts.length;
    processingRef.current = true;
    setIsProcessing(true);

    streamChat(
      `Here is the meeting transcript:\n\n${fullTranscript}`,
      (event) => {
        if (event.type === "tool_use") {
          setAgentActions((prev) => [
            ...prev,
            { type: "tool_use", name: event.name, input: event.input },
          ]);
        }
        if (event.type === "result") {
          setAgentResult(event.text);
        }
        if (event.type === "error") {
          setAgentActions((prev) => [
            ...prev,
            { type: "error", text: event.text },
          ]);
        }
      }
    )
      .catch((err) => {
        setAgentActions((prev) => [
          ...prev,
          { type: "error", text: String(err) },
        ]);
      })
      .finally(() => {
        processingRef.current = false;
        setIsProcessing(false);
      });
  }, [transcripts]);

  const toolLabel = (name: string) =>
    name
      .replace(/^mcp__custom-tools__/, "")
      .replace(/^mcp__notion__/, "notion:")
      .replace(/_/g, " ");

  const toolIcon = (name: string) => {
    if (name.includes("send_email")) return "mail";
    if (name.includes("notion") || name.includes("update_notion")) return "notebook";
    if (name.includes("create_task")) return "check-circle";
    if (name.includes("say_hello")) return "hand-wave";
    return "tool";
  };

  const iconMap: Record<string, string> = {
    mail: "\u2709",
    notebook: "\uD83D\uDCD3",
    "check-circle": "\u2705",
    "hand-wave": "\uD83D\uDC4B",
    tool: "\uD83D\uDD27",
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      {/* Header + Controls */}
      <header className="shrink-0 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Grape
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Real-time meeting transcription
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={isRecording ? stop : start}
              disabled={isConnecting}
              className={`flex h-10 items-center gap-2 rounded-full px-5 text-sm font-medium transition-colors ${
                isRecording
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : isConnecting
                    ? "cursor-wait bg-zinc-300 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
                    : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              }`}
            >
              {isRecording ? (
                <>
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
                  Stop
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
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}
      </header>

      {/* Two-column layout */}
      <div className="flex min-h-0 flex-1">
        {/* Left: Transcript */}
        <div className="flex w-1/2 flex-col border-r border-zinc-200 dark:border-zinc-800">
          <div className="border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
            <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Transcript
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {transcripts.length === 0 && !partialText ? (
              <p className="mt-8 text-center text-sm text-zinc-400 dark:text-zinc-600">
                {isRecording
                  ? "Waiting for speech..."
                  : "Press Start Recording to begin."}
              </p>
            ) : (
              <div className="space-y-2">
                {transcripts.map((entry) => (
                  <div key={entry.id} className="flex gap-3">
                    <span className="shrink-0 pt-0.5 font-mono text-xs text-zinc-400 dark:text-zinc-600">
                      {entry.timestamp.toLocaleTimeString()}
                    </span>
                    <p className="text-sm text-zinc-900 dark:text-zinc-100">
                      {entry.text}
                    </p>
                  </div>
                ))}

                {partialText && (
                  <div className="flex gap-3">
                    <span className="shrink-0 pt-0.5 font-mono text-xs text-zinc-400 dark:text-zinc-600">
                      {new Date().toLocaleTimeString()}
                    </span>
                    <p className="text-sm italic text-zinc-400 dark:text-zinc-500">
                      {partialText}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex w-1/2 flex-col">
          <div className="border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
            <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Actions
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {agentActions.length === 0 && !agentResult && !isProcessing && (
              <p className="mt-8 text-center text-sm text-zinc-400 dark:text-zinc-600">
                Actions will appear here after processing.
              </p>
            )}

            {isProcessing && agentActions.length === 0 && (
              <div className="mt-8 flex flex-col items-center gap-3">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                <p className="text-sm text-zinc-400">Analyzing transcript...</p>
              </div>
            )}

            {agentActions.length > 0 && (
              <div className="space-y-3">
                {agentActions.map((action, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border p-3 ${
                      action.type === "error"
                        ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
                        : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                    }`}
                  >
                    {action.type === "tool_use" && (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-base">
                            {iconMap[toolIcon(action.name ?? "")]}
                          </span>
                          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {toolLabel(action.name ?? "")}
                          </span>
                        </div>
                        <div className="mt-2 space-y-1">
                          {Object.entries(
                            (action.input as Record<string, unknown>) ?? {}
                          ).map(([key, val]) => (
                            <div key={key} className="flex gap-2 text-xs">
                              <span className="shrink-0 font-mono text-zinc-400 dark:text-zinc-500">
                                {key}:
                              </span>
                              <span className="truncate text-zinc-600 dark:text-zinc-400">
                                {String(val)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {action.type === "error" && (
                      <p className="text-sm text-red-700 dark:text-red-400">
                        {action.text}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {agentResult && (
              <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Summary
                </h3>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                  {agentResult}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
