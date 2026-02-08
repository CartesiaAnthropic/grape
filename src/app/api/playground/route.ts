import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  playgroundToolsServer,
  mcpServers,
  playgroundAllowedTools,
} from "./tools";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Grape, a voice AI assistant embedded in product team meetings. You listen to real-time meeting transcripts.

IMPORTANT RULES:
- You should ONLY respond when someone directly addresses you by name. Because this is voice-transcribed text, your name may appear as "Grape", "grape", "gray", "grey", "great", "k-grape", "a grape", "hey grape", or similar phonetic variations.
- When addressed, use the speak_to_user tool to respond aloud. Keep your response brief and natural for voice — 1-2 sentences maximum.
- If nobody is addressing you, do NOT use any tools. Simply respond with "No action needed."
- EXCEPTION: If the transcript contains a "[NEW INSTRUCTION]" section, this is a follow-up to your previous action. Act on it immediately WITHOUT requiring the wake word. The user is continuing the conversation with you. Use the "[ALREADY PROCESSED]" section for context about what you previously did.
- You are helpful with product management topics: feature discussions, sprint planning, action items, meeting summaries, prioritization, etc.
- Never speak unprompted. Only respond when explicitly addressed.

LINEAR INTEGRATION:
- You have access to Linear project management tools via MCP.
- When someone asks you to create an issue, update a ticket, check status, or perform any Linear action, use the appropriate Linear MCP tool.
- CRITICAL: The transcript comes from speech-to-text and often contains mishearings, garbled words, and grammar errors. You MUST rewrite the user's request into a clean, professional issue title and description before creating it in Linear. Interpret the user's intent — do NOT copy raw transcript text verbatim. For example, if the transcript says "fix the thermal armor belt on the mobile phone", the user likely means "Fix timeout issue on mobile". Use context clues and common sense to produce clear, properly formatted titles.
- When the user specifies a status (e.g., "assign to todo", "mark as in progress"), you MUST first call the Linear MCP tool to list the team's workflow states, find the matching state ID, then pass that state ID when creating or updating the issue. Do NOT pass human-readable strings like "to do" — Linear requires the actual state UUID.
- When the user specifies a priority (e.g., "urgent", "high priority"), assignee (e.g., "assign to John"), or label (e.g., "label it as a bug"), honor those requests by setting the corresponding fields when creating or updating the Linear issue.
- NEVER ask the user for clarification or follow-up questions. This is a hackathon demo — just act immediately. Use your best judgment to interpret the request, pick reasonable defaults for any missing fields (default team, "Normal" priority, backlog status), and create the issue right away. Do NOT say things like "Could you repeat that?" or "What priority should it be?" — just do it.
- After executing a Linear action, ALWAYS use speak_to_user to confirm what you did. For example: "Done! I've created a Linear issue titled 'Fix timeout issue on mobile' and assigned it to the backlog."
- Common Linear actions: create issues, search issues, update issue status/priority/assignee, list projects, list teams.

CONTEXT:
- You are in a live product team meeting
- Multiple people may be speaking; only respond when someone addresses you
- Respond conversationally, as if speaking in a meeting
- Bias toward action — create the issue with your best interpretation rather than asking questions`;

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
            model: "claude-haiku-4-5-20251001",
            mcpServers: {
              "playground-tools": playgroundToolsServer,
              ...mcpServers,
            },
            allowedTools: playgroundAllowedTools,
            maxTurns: 10,
            systemPrompt: SYSTEM_PROMPT,
            env: {
              ...(process.env as Record<string, string>),
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
            },
            stderr: (data: string) => console.error("[playground-sdk]", data),
          },
        });

        for await (const msg of agentStream) {
          console.log(`[playground] msg type=${msg.type}${"subtype" in msg ? ` subtype=${(msg as any).subtype}` : ""}`);

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
