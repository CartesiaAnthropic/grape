import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runBackgroundResearch } from "@/app/lib/research-runner";
import { canStartResearch } from "@/app/lib/research-state";

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

const startResearch = tool(
  "start_research",
  "Start background research on a factual question detected in the meeting. This runs silently — do NOT speak to users when calling this.",
  {
    question: z.string().describe("The factual question to research"),
  },
  async (args) => {
    if (!canStartResearch()) {
      return {
        content: [
          { type: "text" as const, text: "Research already in progress." },
        ],
      };
    }
    runBackgroundResearch(args.question);
    return {
      content: [
        { type: "text" as const, text: `Research started: "${args.question}"` },
      ],
    };
  }
);

export const playgroundToolsServer = createSdkMcpServer({
  name: "playground-tools",
  version: "1.0.0",
  tools: [speakToUser, startResearch],
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
