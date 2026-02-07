import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { playgroundToolsServer, allowedTools } from "./tools";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are Grape, a voice AI assistant embedded in product team meetings. You listen to real-time meeting transcripts.

IMPORTANT RULES:
- You should ONLY respond when someone directly addresses you by name ("Grape", "Hey Grape", "Grape, can you...").
- When addressed, use the speak_to_user tool to respond aloud. Keep your response brief and natural for voice — 1-2 sentences maximum.
- If nobody is addressing you, do NOT use any tools. Simply respond with "No action needed."
- You are helpful with product management topics: feature discussions, sprint planning, action items, meeting summaries, prioritization, etc.
- Never speak unprompted. Only respond when explicitly addressed.

CONTEXT:
- You are in a live product team meeting
- The transcript is cumulative — you see the full conversation so far
- Multiple people may be speaking; only respond when someone addresses "Grape"
- Respond conversationally, as if speaking in a meeting`;

export async function POST(req: Request) {
  const { transcript } = await req.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        async function* promptStream(): AsyncGenerator<SDKUserMessage> {
          yield {
            type: "user" as const,
            session_id: "",
            parent_tool_use_id: null,
            message: {
              role: "user" as const,
              content: transcript,
            },
          };
        }

        const agentStream = query({
          prompt: promptStream(),
          options: {
            mcpServers: {
              "playground-tools": playgroundToolsServer,
            },
            allowedTools,
            maxTurns: 2,
            env: {
              ...(process.env as Record<string, string>),
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
            },
            stderr: (data: string) => console.error("[playground-sdk]", data),
            systemPrompt: SYSTEM_PROMPT,
          },
        });

        for await (const msg of agentStream) {
          if (msg.type === "assistant") {
            for (const block of msg.message.content) {
              if (block.type === "text" && block.text) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "text", text: block.text })}\n\n`
                  )
                );
              }
              if (block.type === "tool_use") {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_use",
                      name: block.name,
                      input: block.input,
                    })}\n\n`
                  )
                );
              }
            }
          }

          if (msg.type === "result" && msg.subtype === "success") {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "result", text: msg.result })}\n\n`
              )
            );
          }

          if (msg.type === "result" && msg.subtype !== "success") {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "error",
                  text: `Agent stopped: ${msg.subtype}`,
                })}\n\n`
              )
            );
          }
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "error",
              text: String(err),
            })}\n\n`
          )
        );
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
