import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { Resend } from "resend";
import { z } from "zod";

const resend = new Resend(process.env.RESEND_API_KEY);

// ============================================================
// Custom tools
// ============================================================

const sendEmail = tool(
  "send_email",
  "Send an email to a recipient via Resend",
  {
    to: z.string().describe("Recipient email address"),
    subject: z.string().describe("Email subject line"),
    body: z.string().describe("Email body as HTML"),
  },
  async (args) => {
    const { data, error } = await resend.emails.send({
      from: "Grape <onboarding@resend.dev>",
      to: ["qba.sobolewski@gmail.com"], //[args.to],
      subject: args.subject,
      html: args.body,
    });

    if (error) {
      console.error("[send_email] Error:", error);
      return {
        content: [
          { type: "text" as const, text: `Failed to send email: ${error.message}` },
        ],
      };
    }

    console.log("[send_email] Sent:", data);
    return {
      content: [
        {
          type: "text" as const,
          text: `Email sent to ${args.to} with subject "${args.subject}" (id: ${data?.id})`,
        },
      ],
    };
  }
);

const updateNotion = tool(
  "update_notion",
  "Create or update a page/item in Notion",
  {
    database: z.string().describe("Notion database or page name"),
    title: z.string().describe("Title of the item"),
    content: z.string().describe("Content or notes to add"),
    status: z
      .string()
      .optional()
      .describe("Status to set, e.g. 'In Progress', 'Done'"),
  },
  async (args) => {
    console.log(
      `[update_notion] DB: ${args.database}, Title: ${args.title}, Status: ${args.status ?? "N/A"}`
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `Notion updated: "${args.title}" in ${args.database}${args.status ? ` (status: ${args.status})` : ""}`,
        },
      ],
    };
  }
);

const createTask = tool(
  "create_task",
  "Create a task or action item from the conversation",
  {
    title: z.string().describe("Task title"),
    assignee: z.string().optional().describe("Person assigned to this task"),
    due_date: z.string().optional().describe("Due date if mentioned"),
    priority: z
      .enum(["low", "medium", "high", "urgent"])
      .optional()
      .describe("Task priority"),
  },
  async (args) => {
    console.log(
      `[create_task] "${args.title}" -> ${args.assignee ?? "unassigned"}`
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `Task created: "${args.title}"${args.assignee ? ` assigned to ${args.assignee}` : ""}${args.due_date ? ` due ${args.due_date}` : ""}`,
        },
      ],
    };
  }
);

const sayHello = tool(
  "say_hello",
  "Say hello — prints a greeting to the server console",
  {
    name: z.string().optional().describe("Name to greet"),
  },
  async (args) => {
    const greeting = args.name ? `Hello, ${args.name}!` : "Hello!";
    console.log(`[say_hello] ${greeting}`);
    return {
      content: [{ type: "text" as const, text: greeting }],
    };
  }
);

export const customToolsServer = createSdkMcpServer({
  name: "custom-tools",
  version: "1.0.0",
  tools: [sendEmail, updateNotion, createTask, sayHello],
});

// ============================================================
// MCP servers
// ============================================================

export const mcpServers: Record<string, McpServerConfig> = {
  ...(process.env.NOTION_TOKEN
    ? {
        notion: {
          command: "npx",
          args: ["-y", "@notionhq/notion-mcp-server"],
          env: {
            NOTION_TOKEN: process.env.NOTION_TOKEN,
          },
        },
      }
    : {}),
};

// ============================================================
// Allowed tools
// ============================================================

export const allowedTools: string[] = [
  "mcp__custom-tools__*",
  ...(process.env.NOTION_TOKEN ? ["mcp__notion__*"] : []),
];
