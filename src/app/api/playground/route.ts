import Anthropic from "@anthropic-ai/sdk";
import { getResearchState, canStartResearch } from "@/app/lib/research-state";
import { runBackgroundResearch } from "@/app/lib/research-runner";

export const maxDuration = 30;

const client = new Anthropic();

// --- State-specific prompts ---
// Each research state gets a different system prompt so Grape behaves differently.

const SPEAK_TOOL: Anthropic.Tool = {
  name: "speak_to_user",
  description:
    "Speak a message aloud to the meeting participants. Use this when someone directly addresses Grape. Keep responses brief — 1-2 sentences for natural voice delivery.",
  input_schema: {
    type: "object" as const,
    properties: {
      message: {
        type: "string",
        description: "The message to speak aloud to the user",
      },
    },
    required: ["message"],
  },
};

const RESEARCH_TOOL: Anthropic.Tool = {
  name: "start_research",
  description:
    "Start background research on a factual question detected in the meeting. This runs silently — do NOT speak to users when calling this.",
  input_schema: {
    type: "object" as const,
    properties: {
      question: {
        type: "string",
        description: "The factual question to research",
      },
    },
    required: ["question"],
  },
};

// IDLE: Scan the full conversation for researchable questions
const IDLE_PROMPT = `You are Grape, a voice AI assistant embedded in product team meetings. You are OVERHEARING the meeting — you are NOT a participant.

Read the FULL meeting transcript below. Your job is to detect researchable questions.

RULES — follow strictly, do NOT generate long text:
1. If there is a researchable question ANYWHERE in the transcript: Call start_research with the question. Do NOT speak. Do NOT output text.
2. If someone addresses you by name ("Grape", "Hey Grape") in the [LATEST SEGMENT]: Call speak_to_user with a 1-2 sentence response.
3. Otherwise: Output ONLY "No action needed."

WHEN TO CALL start_research — be AGGRESSIVE:
- ANY comparison: "X or Y?", "X vs Y", "should we use X or Y", "which is better"
- Market/stats: "What's the market size for X?"
- Technical: "How does X handle Y?", "What are best practices for X?"
- Explicit: "Let's research X", "We should look into X"
- Examples that MUST trigger: "GitHub or GitLab", "Anthropic or OpenAI", "React or Vue", "Postgres or MySQL"
- When in doubt, START RESEARCH. Better to research too much than miss a question.

NOT researchable: pure opinions ("Do you like our logo?"), questions addressed to you by name (respond verbally instead).`;

// DONE: Research complete — listen for "Hey Grape" to present findings
function buildDonePrompt(query: string, result: string): string {
  return `You are Grape, a voice AI assistant embedded in product team meetings. You are OVERHEARING the meeting.

Research has been completed on: "${query}"

RESEARCH FINDINGS:
${result}

RULES — follow strictly, do NOT generate long text:
1. If someone addresses you by name ("Grape", "Hey Grape", "what did you find", "any results") in the [LATEST SEGMENT]: Call speak_to_user with a concise 2-3 sentence summary of the research findings above.
2. Otherwise: Output ONLY "No action needed."

IMPORTANT: Only respond to the [LATEST SEGMENT]. Ignore the conversation history — it was already processed.`;
}

function getPromptAndTools(): { system: string; tools: Anthropic.Tool[] } {
  const researchState = getResearchState();

  if (researchState.status === "done" && researchState.result) {
    return {
      system: buildDonePrompt(researchState.query!, researchState.result),
      tools: [SPEAK_TOOL],
    };
  }

  // idle or error — scan for research questions
  return {
    system: IDLE_PROMPT,
    tools: [SPEAK_TOOL, RESEARCH_TOOL],
  };
}

function buildUserMessage(history: string, latest: string): string {
  let msg = "";
  if (history.trim()) {
    msg += `[CONVERSATION HISTORY]\n${history}\n\n`;
  }
  msg += `[LATEST SEGMENT]\n${latest}`;
  return msg;
}

export async function POST(req: Request) {
  const { history, latest } = await req.json();

  const { system, tools } = getPromptAndTools();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const response = client.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system,
        tools,
        messages: [{ role: "user", content: buildUserMessage(history ?? "", latest) }],
      });

      response.on("text", (text) => {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "text", text })}\n\n`
          )
        );
      });

      // contentBlock fires with the COMPLETE block — tool_use includes full input
      response.on("contentBlock", (block) => {
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

          // Handle start_research tool server-side
          if (block.name === "start_research") {
            const input = block.input as { question: string };
            if (canStartResearch()) {
              runBackgroundResearch(input.question);
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "research_status",
                    status: "researching",
                    question: input.question,
                  })}\n\n`
                )
              );
            }
          }
        }
      });

      try {
        await response.finalMessage();
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
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "result", text: "done" })}\n\n`
          )
        );
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
