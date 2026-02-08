import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  playgroundToolsServer,
  mcpServers,
  playgroundAllowedTools,
} from "./tools";
import { getResearchState } from "@/app/lib/research-state";

export const maxDuration = 60;

// --- Linear integration instructions (shared across all prompts) ---
const LINEAR_INSTRUCTIONS = `LINEAR INTEGRATION:
- You have access to Linear project management tools via MCP.
- When someone asks you to create a ticket/issue, your ONLY job is to call the Linear MCP tool IMMEDIATELY. Do NOT output any text before calling the tool. Do NOT think out loud. Just call the tool.
- ZERO QUESTIONS POLICY: You must NEVER ask ANY questions before creating a ticket. No "what title?", no "which team?", no "what priority?", no "could you clarify?". NEVER. Just create the ticket.
- Infer the title from whatever was just being discussed. Clean up speech-to-text grammar but use the user's words. If the discussion was about "evaluating opus 4.6 token costs", the title is "Evaluate Opus 4.6 token costs". If unclear, just pick the most reasonable interpretation and go with it.
- For ALL fields you are unsure about: use defaults. First available team, Normal priority, backlog status. Do NOT ask.
- If the user specifies status/priority/assignee/label, honor those. Otherwise use defaults silently.
- When setting a status, first list workflow states via Linear MCP to get the UUID. Do NOT pass human-readable strings.
- After creating the ticket, use speak_to_user to confirm briefly. Example: "Done, created a ticket for evaluating Opus 4.6 token costs."`;

// IDLE: Scan for research questions + handle voice commands + Linear
const IDLE_PROMPT = `You are Grape, a voice AI assistant embedded in product team meetings. You listen to real-time meeting transcripts.

IMPORTANT RULES:
- You should ONLY respond when someone directly addresses you by name. Because this is voice-transcribed text, your name may appear as "Grape", "grape", "gray", "grey", "great", "k-grape", "a grape", "hey grape", or similar phonetic variations.
- When addressed, use the speak_to_user tool to respond aloud. Keep your response brief and natural for voice — 1-2 sentences maximum.
- If nobody is addressing you, check for researchable questions (see below). If none found, do NOT use any tools. Simply respond with "No action needed."
- EXCEPTION: If the transcript contains a "[LATEST SEGMENT]" section with follow-up context in "[ALREADY PROCESSED]", the user is continuing a conversation with you. Act on the latest segment immediately WITHOUT requiring the wake word.
- You are helpful with product management topics: feature discussions, sprint planning, action items, meeting summaries, prioritization, etc.
- Never speak unprompted. Only respond when explicitly addressed.

RESEARCH DETECTION — be PROACTIVE:
- You silently monitor conversations for topics that would benefit from research.
- You do NOT need to wait for an explicit question or someone asking you to research. If the speakers are discussing something where having real data, facts, or context would help the conversation, call start_research immediately. Do NOT speak when doing this.
- WHEN TO CALL start_research:
  - The speakers are discussing a topic and seem uncertain or are debating something factual — research it for them.
  - ANY comparison or tradeoff discussion: "X or Y?", "X vs Y", "should we use X or Y", "which is better", or even just casually weighing options.
  - Someone mentions a product, technology, company, or market they don't seem fully informed about — look it up.
  - Technical discussions where best practices, benchmarks, or real-world data would help.
  - Market/stats/pricing: anything where concrete numbers would ground the discussion.
  - Explicit requests: "Let's research X", "We should look into X".
  - If someone asks a question to the group (not to you) and the answer requires factual knowledge — research it silently so you have the answer ready if asked.
  - When in doubt, START RESEARCH. It runs in the background and costs nothing if nobody asks for the results. Better to research too much than miss something useful.
- NOT researchable: pure subjective opinions with no factual component ("Do you like our logo?"), small talk, questions addressed to you by name (respond verbally instead).

${LINEAR_INSTRUCTIONS}

CONTEXT:
- You are in a live product team meeting
- Multiple people may be speaking; only respond when someone addresses you
- Respond conversationally, as if speaking in a meeting
- Bias toward action — create the issue with your best interpretation rather than asking questions`;

// DONE: Research complete — present findings when addressed + handle Linear
function buildDonePrompt(researchQuery: string, result: string): string {
  return `You are Grape, a voice AI assistant embedded in product team meetings. You listen to real-time meeting transcripts.

Research has been completed on: "${researchQuery}"

RESEARCH FINDINGS:
${result}

RULES — follow strictly, do NOT generate long text:
1. If someone addresses you by name ("Grape", "Hey Grape", "what did you find", "any results") in the [LATEST SEGMENT]: Call speak_to_user with a concise 2-3 sentence summary of the research findings above.
2. If someone asks you to do something with Linear (create issue, check status, etc.), handle it with Linear MCP tools as usual.
3. Otherwise: Output ONLY "No action needed."

IMPORTANT: Only respond to the [LATEST SEGMENT]. Ignore the [ALREADY PROCESSED] section — it was already handled.

${LINEAR_INSTRUCTIONS}

CONTEXT:
- You are in a live product team meeting
- Multiple people may be speaking; only respond when someone addresses you
- Respond conversationally, as if speaking in a meeting
- Bias toward action`;
}

function getSystemPrompt(): string {
  const researchState = getResearchState();
  if (researchState.status === "done" && researchState.result) {
    return buildDonePrompt(researchState.query!, researchState.result);
  }
  return IDLE_PROMPT;
}

function buildUserMessage(history: string, latest: string): string {
  let msg = "";
  if (history && history.trim()) {
    msg += `[ALREADY PROCESSED]\n${history}\n\n`;
  }
  msg += `[LATEST SEGMENT]\n${latest}`;
  return msg;
}

export async function POST(req: Request) {
  const { history, latest } = await req.json();

  if (!latest || typeof latest !== "string") {
    return new Response(JSON.stringify({ error: "latest is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userContent = buildUserMessage(history ?? "", latest);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendSSE = (data: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        async function* promptStream(): AsyncGenerator<SDKUserMessage> {
          yield {
            type: "user" as const,
            session_id: "",
            parent_tool_use_id: null,
            message: {
              role: "user" as const,
              content: userContent,
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
            systemPrompt: getSystemPrompt(),
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
                sendSSE({ type: "text", text: block.text });
              }
              if (block.type === "tool_use") {
                sendSSE({ type: "tool_use", name: block.name, input: block.input });

                // Emit research_status SSE when start_research is invoked
                if (block.name.includes("start_research")) {
                  const input = block.input as { question: string };
                  sendSSE({
                    type: "research_status",
                    status: "researching",
                    question: input.question,
                  });
                }
              }
            }
          }

          if (msg.type === "result" && msg.subtype === "success") {
            sendSSE({ type: "result", text: msg.result });
          }

          if (msg.type === "result" && msg.subtype !== "success") {
            sendSSE({ type: "error", text: `Agent stopped: ${msg.subtype}` });
          }
        }
      } catch (err) {
        sendSSE({ type: "error", text: err instanceof Error ? err.message : String(err) });
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
