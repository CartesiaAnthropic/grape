import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  canStartResearch,
  startResearch,
  completeResearch,
  failResearch,
  addProgress,
} from "./research-state";

const RESEARCH_SYSTEM_PROMPT = `You are a research assistant. You have been given a question that came up in a product team meeting.
Your job is to research the topic thoroughly using web search and web fetch tools.

Provide a clear, concise summary of your findings (3-5 sentences max) that would be useful to share in the meeting.
Focus on factual, actionable information. Include specific numbers, dates, or names when relevant.
Do NOT use markdown formatting — your output will be spoken aloud.`;

export function runBackgroundResearch(question: string): boolean {
  if (!canStartResearch()) {
    console.log("[research] Skipping — research already in progress");
    return false;
  }

  startResearch(question);
  console.log("[research] Starting background research for:", question);

  // Fire and forget — updates shared state on completion
  (async () => {
    try {
      async function* promptStream(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: "user" as const,
          session_id: "",
          parent_tool_use_id: null,
          message: {
            role: "user" as const,
            content: `Research the following question that came up in a meeting: "${question}"`,
          },
        };
      }

      const agentStream = query({
        prompt: promptStream(),
        options: {
          model: "claude-sonnet-4-5-20250929",
          tools: ["WebSearch", "WebFetch"],
          allowedTools: ["WebSearch", "WebFetch"],
          maxTurns: 10,
          systemPrompt: RESEARCH_SYSTEM_PROMPT,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          env: {
            ...process.env as Record<string, string>,
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
          },
          stderr: (data: string) => console.error("[research-agent]", data),
        },
      });

      let resultText = "";

      for await (const msg of agentStream) {
        // Log agent progress for visibility
        if (msg.type === "assistant") {
          for (const block of msg.message.content) {
            if (block.type === "tool_use") {
              const progressMsg = `Using tool: ${block.name}${block.input && typeof block.input === "object" && "query" in block.input ? ` — "${(block.input as Record<string, string>).query}"` : ""}`;
              addProgress(progressMsg);
              console.log("[research]", progressMsg);
            }
            if (block.type === "text" && block.text) {
              resultText = block.text;
            }
          }
        }

        if (msg.type === "result" && msg.subtype === "success") {
          resultText = msg.result || resultText;
        }

        if (msg.type === "result" && msg.subtype !== "success") {
          throw new Error(`Agent stopped: ${msg.subtype}`);
        }
      }

      const finalResult =
        resultText.trim() || "Research completed but no results were found.";
      completeResearch(finalResult);
      console.log(
        "[research] Completed:",
        finalResult.substring(0, 200) + "..."
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[research] Failed:", errorMsg);
      failResearch(errorMsg);
    }
  })();

  return true;
}
