import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 30;

const client = new Anthropic();

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
];

export async function POST(req: Request) {
  const { transcript } = await req.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const response = client.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        tools,
        messages: [{ role: "user", content: transcript }],
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
