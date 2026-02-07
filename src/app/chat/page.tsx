"use client";

import { useState, useRef, useEffect } from "react";
import { streamChat } from "../lib/chat-stream";

type Message = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { name: string; input: unknown }[];
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    // Placeholder for the assistant reply
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", toolCalls: [] },
    ]);

    try {
      await streamChat(text, (event) => {
        if (event.type === "text" || event.type === "result") {
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last.role === "assistant") {
              copy[copy.length - 1] = {
                ...last,
                content:
                  event.type === "result" ? event.text : last.content + event.text,
              };
            }
            return copy;
          });
        }

        if (event.type === "tool_use") {
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last.role === "assistant") {
              copy[copy.length - 1] = {
                ...last,
                toolCalls: [
                  ...(last.toolCalls ?? []),
                  { name: event.name, input: event.input },
                ],
              };
            }
            return copy;
          });
        }

        if (event.type === "error") {
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last.role === "assistant") {
              copy[copy.length - 1] = { ...last, content: `Error: ${event.text}` };
            }
            return copy;
          });
        }
      });
    } catch (err) {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last.role === "assistant") {
          copy[copy.length - 1] = { ...last, content: `Error: ${err}` };
        }
        return copy;
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      {/* Messages */}
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-8 pb-32">
        {messages.length === 0 && (
          <p className="mt-32 text-center text-zinc-400">
            Send a message to get started.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-white text-zinc-800 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800"
              }`}
            >
              {msg.content || (loading && i === messages.length - 1 ? "..." : "")}

              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                  {msg.toolCalls.map((tc, j) => (
                    <div
                      key={j}
                      className="rounded bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    >
                      tool: {tc.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="mx-auto flex w-full max-w-2xl gap-2 px-4 py-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
