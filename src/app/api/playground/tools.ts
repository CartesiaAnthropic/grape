import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const speakToUser = tool(
  "speak_to_user",
  "Speak a message aloud to the meeting participants. Use this when someone directly addresses Grape. Keep responses brief — 1-2 sentences for natural voice delivery.",
  {
    message: z.string().describe("The message to speak aloud to the user"),
  },
  async (args) => {
    return {
      content: [
        { type: "text" as const, text: `Speaking: ${args.message}` },
      ],
    };
  }
);

export const playgroundToolsServer = createSdkMcpServer({
  name: "playground-tools",
  version: "1.0.0",
  tools: [speakToUser],
});

export const mcpServers: Record<string, McpServerConfig> = {
  ...(process.env.LINEAR_API_KEY
    ? {
        linear: {
          type: "http" as const,
          url: "https://mcp.linear.app/mcp",
          headers: {
            Authorization: `Bearer ${process.env.LINEAR_API_KEY}`,
          },
        },
      }
    : {}),
};

export const playgroundAllowedTools: string[] = [
  "mcp__playground-tools__*",
  ...(process.env.LINEAR_API_KEY ? ["mcp__linear__*"] : []),
];
