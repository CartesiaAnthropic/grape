import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const speakToUser = tool(
  "speak_to_user",
  "Speak a message aloud to the meeting participants. Use this when someone directly addresses Grape (e.g. 'Grape, ...', 'Hey Grape'). Keep responses brief and conversational — 1-2 sentences for natural voice delivery.",
  {
    message: z.string().describe("The message to speak aloud to the user"),
  },
  async (args) => {
    console.log(`[speak_to_user] "${args.message}"`);
    return {
      content: [
        {
          type: "text" as const,
          text: `Spoke to user: "${args.message}"`,
        },
      ],
    };
  }
);

export const playgroundToolsServer = createSdkMcpServer({
  name: "playground-tools",
  version: "1.0.0",
  tools: [speakToUser],
});

export const allowedTools: string[] = ["mcp__playground-tools__*"];
