import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { customToolsServer, mcpServers, allowedTools } from "./tools";

export const maxDuration = 120;

export async function POST(req: Request) {
  const { message } = await req.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Build the prompt as an async generator (required for custom MCP tools)
        async function* promptStream(): AsyncGenerator<SDKUserMessage> {
          yield {
            type: "user" as const,
            session_id: "",
            parent_tool_use_id: null,
            message: {
              role: "user" as const,
              content: message,
            },
          };
        }

        const agentStream = query({
          prompt: promptStream(),
          options: {
            mcpServers: {
              "custom-tools": customToolsServer,
              ...mcpServers,
            },
            allowedTools,
            maxTurns: 10,
            env: {
              ...process.env as Record<string, string>,
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
            },
            stderr: (data: string) => console.error("[agent-sdk]", data),
            systemPrompt: `You are a meeting action-item assistant. You receive conversation transcripts and extract actionable items from them.

For each action you identify, use the appropriate tool:
- send_email: when someone needs to be emailed (follow-ups, summaries, introductions)
- create_task: when there's a clear action item or to-do assigned to someone
- Notion MCP tools (mcp__notion__*): use these for any Notion operations:
  - search-content: find pages or data sources by title
  - retrieve-a-page / retrieve-a-page-content: read a page
  - update-a-page: update page properties
  - create-a-page: create a new page
  - append-a-block: add content blocks to a page

Always execute the actions — don't just list them. After executing, give a brief summary of what you did.`,
          },
        });

        for await (const msg of agentStream) {
          // Stream assistant text chunks
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

          // Stream final result
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
