import Anthropic from "@anthropic-ai/sdk";
import { getResearchState, canStartResearch } from "@/app/lib/research-state";
import { runBackgroundResearch } from "@/app/lib/research-runner";

export const maxDuration = 30;

const client = new Anthropic();

const SYSTEM_PROMPT = `You are Grape, a voice AI assistant embedded in product team meetings. You listen to real-time meeting transcripts.

CRITICAL: You MUST follow these rules strictly. Do NOT generate long text responses.

RULES:
1. ADDRESSED BY NAME ("Grape", "Hey Grape"): Call speak_to_user with a 1-2 sentence response. Nothing else.
2. RESEARCHABLE QUESTION DETECTED: Call start_research with the question. Do NOT speak. Do NOT output text.
3. ASKED FOR FINDINGS ("what did you find?"): Call speak_to_user with a concise summary from the research results below.
4. OTHERWISE: Output ONLY "No action needed." — nothing else, no commentary, no suggestions.

WHAT COUNTS AS RESEARCHABLE:
- Factual comparisons: "Should we use X or Y?", "What's better, X or Y?"
- Market/stats questions: "What's the market size for X?"
- Technical questions: "How does X handle Y?", "What are best practices for X?"
- Explicit requests: "Let's research X", "We should look into X"

WHAT IS NOT RESEARCHABLE:
- Internal team questions, opinions, or discussions about their own product
- Questions directed at you by name (respond verbally instead)

CONTEXT:
- You are OVERHEARING a product team meeting — you are NOT a participant
- The message contains [CONVERSATION HISTORY] (past, already processed) and [LATEST SEGMENT] (new speech)
- ONLY act on the [LATEST SEGMENT]. Ignore everything in [CONVERSATION HISTORY] — it was already handled.
- Only speak when explicitly addressed by name in the LATEST SEGMENT`;

const tools: Anthropic.Tool[] = [
  {
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
  },
  {
    name: "start_research",
    description:
      "Start background research on a factual question detected in the meeting. This runs silently — do NOT speak to users when calling this. Only call this if no research is already in progress.",
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
  },
];

function buildSystemPrompt(): string {
  const researchState = getResearchState();
  let researchContext = "";

  if (researchState.status === "researching") {
    researchContext = `\n\nRESEARCH STATUS: Currently researching "${researchState.query}". Do NOT call start_research — research is already running.`;
  } else if (researchState.status === "done" && researchState.result) {
    researchContext = `\n\nPREVIOUS RESEARCH on "${researchState.query}":\n${researchState.result}\n\nWhen someone asks about findings, use speak_to_user to share a concise summary. You MAY call start_research for a NEW, DIFFERENT question — but do NOT re-research "${researchState.query}".`;
  } else if (researchState.status === "error") {
    researchContext = `\n\nRESEARCH FAILED for "${researchState.query}". If asked, let the user know it didn't complete. You may start_research on a different question.`;
  }

  return SYSTEM_PROMPT + researchContext;
}

function buildUserMessage(history: string, latest: string): string {
  const researchState = getResearchState();
  let statusNote = "";

  if (researchState.status === "researching") {
    statusNote = `\n[STATUS: Research in progress for "${researchState.query}". Do NOT call start_research.]`;
  } else if (researchState.status === "done") {
    statusNote = `\n[STATUS: Previous research done for "${researchState.query}". Do NOT re-research same topic.]`;
  } else if (researchState.status === "error") {
    statusNote = `\n[STATUS: Previous research failed for "${researchState.query}".]`;
  }

  let msg = "";
  if (history.trim()) {
    msg += `[CONVERSATION HISTORY — for context only, already processed]\n${history}\n\n`;
  }
  msg += `[LATEST SEGMENT — act on THIS only]\n${latest}`;
  msg += statusNote;
  return msg;
}

export async function POST(req: Request) {
  const { history, latest } = await req.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const response = client.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: buildSystemPrompt(),
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
            // If research can't start (already done or in progress), don't send
            // any event — let the polling handle accurate state.
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
