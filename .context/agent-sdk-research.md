# Claude Agent SDK - Implementation Patterns Research

**Research Date:** 2026-02-07
**Documentation Sources:** Claude Platform Agent SDK Documentation

---

## Table of Contents

1. [Custom Tools Definition and Usage](#1-custom-tools-definition-and-usage)
2. [Streaming Output](#2-streaming-output)
3. [TypeScript Configuration](#3-typescript-configuration)
4. [System Prompts and Conversation Context](#4-system-prompts-and-conversation-context)

---

## 1. Custom Tools Definition and Usage

### Core API Pattern

Custom tools are created using two key functions:

```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// 1. Define individual tools with type-safe schemas
const weatherTool = tool(
  "get_weather",                                    // Tool name
  "Get current temperature for a location",         // Description
  {                                                  // Zod schema for inputs
    latitude: z.number().describe("Latitude coordinate"),
    longitude: z.number().describe("Longitude coordinate")
  },
  async (args) => {                                 // Handler function
    // Implementation
    return {
      content: [{
        type: "text",
        text: `Temperature: ${data.temperature}°F`
      }]
    };
  }
);

// 2. Create MCP server with tools
const customServer = createSdkMcpServer({
  name: "my-custom-tools",
  version: "1.0.0",
  tools: [weatherTool]
});
```

### Tool Naming Convention

**CRITICAL:** MCP tools follow a specific naming pattern when exposed to Claude:

```
Pattern: mcp__{server_name}__{tool_name}
Example: mcp__my-custom-tools__get_weather
```

This naming is important for:
- Configuring `allowedTools` in options
- Debugging which tools are being called
- Setting up permissions

### Using Custom Tools with Query

**Important Requirements:**

1. **Streaming Input Required:** Custom MCP tools MUST use async generator for prompt
2. **Pass as Dictionary/Object:** Use `mcpServers` as object, not array
3. **Control Access:** Use `allowedTools` to specify which tools Claude can use

```typescript
// REQUIRED: Async generator for streaming input
async function* generateMessages() {
  yield {
    type: "user" as const,
    message: {
      role: "user" as const,
      content: "What's the weather in San Francisco?"
    }
  };
}

for await (const message of query({
  prompt: generateMessages(),  // Must be async generator
  options: {
    mcpServers: {
      "my-custom-tools": customServer  // Pass as object
    },
    allowedTools: [
      "mcp__my-custom-tools__get_weather",  // Full tool name
    ],
    maxTurns: 3
  }
})) {
  // Process messages
}
```

### Type Safety Patterns

#### TypeScript with Zod

```typescript
tool(
  "process_data",
  "Process structured data with type safety",
  {
    data: z.object({
      name: z.string(),
      age: z.number().min(0).max(150),
      email: z.string().email(),
      preferences: z.array(z.string()).optional()
    }),
    format: z.enum(["json", "csv", "xml"]).default("json")
  },
  async (args) => {
    // args is fully typed based on the schema
    // TypeScript knows: args.data.name is string, args.data.age is number
    console.log(`Processing ${args.data.name}'s data as ${args.format}`);

    return {
      content: [{
        type: "text",
        text: `Processed data for ${args.data.name}`
      }]
    };
  }
)
```

### Error Handling Pattern

**Best Practice:** Return structured error messages, don't throw exceptions

```typescript
tool(
  "fetch_data",
  "Fetch data from an API",
  {
    endpoint: z.string().url().describe("API endpoint URL")
  },
  async (args) => {
    try {
      const response = await fetch(args.endpoint);

      if (!response.ok) {
        return {
          content: [{
            type: "text",
            text: `API error: ${response.status} ${response.statusText}`
          }]
        };
      }

      const data = await response.json();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Failed to fetch data: ${error.message}`
        }]
      };
    }
  }
)
```

### Multi-Tool Server Pattern

```typescript
const multiToolServer = createSdkMcpServer({
  name: "utilities",
  version: "1.0.0",
  tools: [
    tool("calculate", "Perform calculations", { /* ... */ }, async (args) => { /* ... */ }),
    tool("translate", "Translate text", { /* ... */ }, async (args) => { /* ... */ }),
    tool("search_web", "Search the web", { /* ... */ }, async (args) => { /* ... */ })
  ]
});

// Selectively allow tools
for await (const message of query({
  prompt: generateMessages(),
  options: {
    mcpServers: { utilities: multiToolServer },
    allowedTools: [
      "mcp__utilities__calculate",
      "mcp__utilities__translate",
      // search_web is NOT allowed
    ]
  }
})) {
  // Process
}
```

### Key Best Practices

1. **Always use descriptive tool names** - They help Claude understand when to use the tool
2. **Provide detailed descriptions** - Include purpose, parameters, and expected behavior
3. **Use Zod schema descriptions** - Help Claude understand parameter meanings
4. **Return structured content** - Use the content array format consistently
5. **Handle errors gracefully** - Return error messages as content, don't throw
6. **Use type safety** - Leverage Zod for runtime validation and TypeScript types

---

## 2. Streaming Output

### Core Concepts

**Two types of streaming:**
- **Input streaming:** How you send messages (async generator vs single string)
- **Output streaming:** How you receive responses (partial vs complete messages)

**This section covers output streaming** - receiving tokens in real-time.

### Enabling Streaming

Set `includePartialMessages: true` to receive `StreamEvent` messages:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Explain how databases work",
  options: {
    includePartialMessages: true
  }
})) {
  if (message.type === "stream_event") {
    // Handle streaming events
  }
}
```

### StreamEvent Message Structure

```typescript
type SDKPartialAssistantMessage = {
  type: 'stream_event';
  event: RawMessageStreamEvent;    // Raw Claude API event
  parent_tool_use_id: string | null;
  uuid: UUID;
  session_id: string;
}
```

**Key Event Types:**

| Event Type | Description |
|:-----------|:------------|
| `message_start` | Start of a new message |
| `content_block_start` | Start of text or tool use block |
| `content_block_delta` | Incremental content updates |
| `content_block_stop` | End of a content block |
| `message_delta` | Message-level updates |
| `message_stop` | End of the message |

### Pattern: Streaming Text

**Critical Nested Type Checks Required:**
1. Check message type is `stream_event`
2. Check event type is `content_block_delta`
3. Check delta type is `text_delta`

```typescript
for await (const message of query({
  prompt: "Explain how databases work",
  options: { includePartialMessages: true }
})) {
  if (message.type === "stream_event") {
    const event = message.event;
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      // Print each text chunk as it arrives
      process.stdout.write(event.delta.text);
    }
  }
}
```

### Pattern: Streaming Tool Calls

Track tool execution in real-time by monitoring three event types:

```typescript
let currentTool: string | null = null;
let toolInput = "";

for await (const message of query({
  prompt: "Read the README.md file",
  options: {
    includePartialMessages: true,
    allowedTools: ["Read", "Bash"],
  }
})) {
  if (message.type === "stream_event") {
    const event = message.event;

    if (event.type === "content_block_start") {
      // Tool call starting
      if (event.content_block.type === "tool_use") {
        currentTool = event.content_block.name;
        toolInput = "";
        console.log(`Starting tool: ${currentTool}`);
      }
    }
    else if (event.type === "content_block_delta") {
      // Tool input streaming in
      if (event.delta.type === "input_json_delta") {
        const chunk = event.delta.partial_json;
        toolInput += chunk;
        console.log(`  Input chunk: ${chunk}`);
      }
    }
    else if (event.type === "content_block_stop") {
      // Tool call complete
      if (currentTool) {
        console.log(`Tool ${currentTool} called with: ${toolInput}`);
        currentTool = null;
      }
    }
  }
}
```

### Pattern: Building a Streaming UI

Combine text and tool streaming with status indicators:

```typescript
let inTool = false;

for await (const message of query({
  prompt: "Find all TODO comments in the codebase",
  options: {
    includePartialMessages: true,
    allowedTools: ["Read", "Bash", "Grep"],
  }
})) {
  if (message.type === "stream_event") {
    const event = message.event;

    if (event.type === "content_block_start") {
      if (event.content_block.type === "tool_use") {
        // Show status indicator
        process.stdout.write(`\n[Using ${event.content_block.name}...]`);
        inTool = true;
      }
    }
    else if (event.type === "content_block_delta") {
      // Only stream text when not executing a tool
      if (event.delta.type === "text_delta" && !inTool) {
        process.stdout.write(event.delta.text);
      }
    }
    else if (event.type === "content_block_stop") {
      if (inTool) {
        console.log(" done");
        inTool = false;
      }
    }
  }
  else if (message.type === "result") {
    console.log("\n\n--- Complete ---");
  }
}
```

### Message Flow with Streaming

**With `includePartialMessages: true`:**

```
StreamEvent (message_start)
StreamEvent (content_block_start) - text block
StreamEvent (content_block_delta) - text chunks...
StreamEvent (content_block_stop)
StreamEvent (content_block_start) - tool_use block
StreamEvent (content_block_delta) - tool input chunks...
StreamEvent (content_block_stop)
StreamEvent (message_delta)
StreamEvent (message_stop)
AssistantMessage - complete message
... tool executes ...
ResultMessage - final result
```

**Without streaming (default):**

```
AssistantMessage - complete message
... tool executes ...
ResultMessage - final result
```

### Known Limitations

**Incompatible with streaming:**

1. **Extended thinking** - When `maxThinkingTokens` is explicitly set, `StreamEvent` messages are not emitted
2. **Structured output** - JSON result appears only in final `ResultMessage.structured_output`, not as deltas

### Best Practices

1. **Always check nested types** - Don't assume event structure without checking
2. **Accumulate state carefully** - Track current block context (text vs tool)
3. **Handle all event types** - Don't ignore start/stop events for proper UI
4. **Reset state on boundaries** - Clear tool tracking between content blocks
5. **Flush output appropriately** - Use `process.stdout.write` with flush for real-time display

---

## 3. TypeScript Configuration

### Installation

```bash
npm install @anthropic-ai/claude-agent-sdk
```

### Core Query Function Signature

```typescript
function query({
  prompt,
  options
}: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query
```

**Returns:** `Query` object (extends `AsyncGenerator<SDKMessage, void>`)

### Essential Options Interface

```typescript
interface Options {
  // Model & Budget
  model?: string;
  fallbackModel?: string;
  maxBudgetUsd?: number;

  // Tools & Permissions
  allowedTools?: string[];
  disallowedTools?: string[];
  canUseTool?: CanUseTool;
  permissionMode?: PermissionMode;

  // MCP Servers
  mcpServers?: Record<string, McpServerConfig>;

  // System Prompt
  systemPrompt?: string | {
    type: 'preset';
    preset: 'claude_code';
    append?: string;
  };

  // Streaming & Output
  includePartialMessages?: boolean;
  outputFormat?: { type: 'json_schema', schema: JSONSchema };

  // Execution Control
  maxTurns?: number;
  maxThinkingTokens?: number;

  // Environment
  cwd?: string;
  env?: Dict<string>;
  additionalDirectories?: string[];

  // Session Management
  continue?: boolean;
  resume?: string;
  resumeSessionAt?: string;
  forkSession?: boolean;

  // Settings & Configuration
  settingSources?: SettingSource[];
  plugins?: SdkPluginConfig[];
  agents?: Record<string, AgentDefinition>;

  // Hooks & Events
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
}
```

### SettingSource Pattern (CRITICAL)

**Default behavior:** When `settingSources` is **omitted or undefined**, the SDK loads **NO filesystem settings**

```typescript
type SettingSource = 'user' | 'project' | 'local';
```

| Value | Location | Purpose |
|:------|:---------|:--------|
| `'user'` | `~/.claude/settings.json` | Global user settings |
| `'project'` | `.claude/settings.json` | Shared project settings (version controlled) |
| `'local'` | `.claude/settings.local.json` | Local project settings (gitignored) |

**Loading CLAUDE.md files:**

```typescript
// CRITICAL: Must specify 'project' to load CLAUDE.md
const result = query({
  prompt: "Add a new feature",
  options: {
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code'  // Not enough! Must also set settingSources
    },
    settingSources: ['project']  // Required to load CLAUDE.md
  }
});
```

### Query Return Type and Methods

```typescript
interface Query extends AsyncGenerator<SDKMessage, void> {
  // Control methods (available in streaming input mode)
  interrupt(): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;

  // File checkpointing (requires enableFileCheckpointing: true)
  rewindFiles(userMessageUuid: string): Promise<void>;

  // Information methods
  supportedCommands(): Promise<SlashCommand[]>;
  supportedModels(): Promise<ModelInfo[]>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
  accountInfo(): Promise<AccountInfo>;
}
```

### Message Type Union

```typescript
type SDKMessage =
  | SDKAssistantMessage      // Claude's responses
  | SDKUserMessage           // User inputs
  | SDKUserMessageReplay     // Replayed messages
  | SDKResultMessage         // Final results
  | SDKSystemMessage         // System initialization
  | SDKPartialAssistantMessage  // Streaming events
  | SDKCompactBoundaryMessage;  // Conversation compaction
```

### Permission System

```typescript
type PermissionMode =
  | 'default'           // Standard permission behavior
  | 'acceptEdits'       // Auto-accept file edits
  | 'bypassPermissions' // Bypass all permission checks
  | 'plan'              // Planning mode - no execution

type CanUseTool = (
  toolName: string,
  input: ToolInput,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
  }
) => Promise<PermissionResult>;

type PermissionResult =
  | {
      behavior: 'allow';
      updatedInput: ToolInput;
      updatedPermissions?: PermissionUpdate[];
    }
  | {
      behavior: 'deny';
      message: string;
      interrupt?: boolean;
    }
```

### AgentDefinition Pattern (Subagents)

```typescript
type AgentDefinition = {
  description: string;  // When to use this agent
  tools?: string[];     // Allowed tools (inherits all if omitted)
  prompt: string;       // Agent's system prompt
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
}

// Usage
const result = query({
  prompt: "Analyze this codebase",
  options: {
    agents: {
      'security-reviewer': {
        description: 'Reviews code for security vulnerabilities',
        tools: ['Read', 'Grep', 'Glob'],
        prompt: 'You are a security expert. Focus on finding vulnerabilities.',
        model: 'opus'
      }
    }
  }
});
```

### Hook System Pattern

```typescript
type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PermissionRequest';

// Usage
const result = query({
  prompt: "Build the project",
  options: {
    hooks: {
      PreToolUse: [{
        matcher: 'Bash',  // Optional: filter by tool name
        hooks: [async (input, toolUseID, options) => {
          console.log(`About to run: ${input.tool_input.command}`);
          return { continue: true };
        }]
      }]
    }
  }
});
```

### Sandbox Configuration

```typescript
type SandboxSettings = {
  enabled?: boolean;
  autoAllowBashIfSandboxed?: boolean;
  excludedCommands?: string[];  // Always bypass sandbox
  allowUnsandboxedCommands?: boolean;  // Model can request bypass
  network?: NetworkSandboxSettings;
  ignoreViolations?: SandboxIgnoreViolations;
  enableWeakerNestedSandbox?: boolean;
}

type NetworkSandboxSettings = {
  allowLocalBinding?: boolean;
  allowUnixSockets?: string[];
  allowAllUnixSockets?: boolean;
  httpProxyPort?: number;
  socksProxyPort?: number;
}
```

### Best Practices

1. **Use TypeScript strict mode** - Catch type errors at compile time
2. **Import specific types** - Don't use `any` for SDK types
3. **Check message types** - Use type guards for message handling
4. **Handle async properly** - Always await query iteration
5. **Specify settingSources explicitly** - Don't rely on defaults for settings loading
6. **Use Zod for custom tool schemas** - Get runtime validation + TypeScript types

---

## 4. System Prompts and Conversation Context

### Default Behavior (IMPORTANT)

**The SDK uses a minimal system prompt by default:**
- Contains only essential tool instructions
- NO Claude Code coding guidelines
- NO Claude Code response style
- NO project context (CLAUDE.md)

**To get full Claude Code behavior:**

```typescript
options: {
  systemPrompt: {
    type: 'preset',
    preset: 'claude_code'
  }
}
```

### Four Approaches to System Prompts

| Approach | Persistence | Scope | Use Case |
|:---------|:------------|:------|:---------|
| **CLAUDE.md** | Filesystem | Project/User | Project conventions, team standards |
| **Output Styles** | Filesystem | User/Project | Reusable specialized behaviors |
| **systemPrompt with append** | Session | Code | Adding to Claude Code prompt |
| **Custom systemPrompt** | Session | Code | Complete control |

### Method 1: CLAUDE.md Files

**Location:**
- Project: `CLAUDE.md` or `.claude/CLAUDE.md`
- User: `~/.claude/CLAUDE.md`

**CRITICAL:** Must explicitly load via `settingSources`:

```typescript
const result = query({
  prompt: "Add a new feature",
  options: {
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code'
    },
    settingSources: ['project']  // REQUIRED to load CLAUDE.md
  }
});
```

**Example CLAUDE.md:**

```markdown
# Project Guidelines

## Code Style
- Use TypeScript strict mode
- Prefer functional components in React
- Always include JSDoc comments for public APIs

## Testing
- Run `npm test` before committing
- Maintain >80% code coverage
- Use jest for unit tests

## Commands
- Build: `npm run build`
- Dev server: `npm run dev`
```

**When to use:**
- ✅ Team-shared context
- ✅ Project conventions
- ✅ Common commands
- ✅ Long-term memory
- ✅ Version-controlled instructions

### Method 2: Output Styles

**Creating an output style:**

```typescript
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

async function createOutputStyle(
  name: string,
  description: string,
  prompt: string
) {
  const outputStylesDir = join(homedir(), ".claude", "output-styles");
  await mkdir(outputStylesDir, { recursive: true });

  const content = `---
name: ${name}
description: ${description}
---

${prompt}`;

  const filePath = join(outputStylesDir, `${name.toLowerCase().replace(/\s+/g, "-")}.md`);
  await writeFile(filePath, content, "utf-8");
}

// Create a code review specialist
await createOutputStyle(
  "Code Reviewer",
  "Thorough code review assistant",
  `You are an expert code reviewer.

For every code submission:
1. Check for bugs and security issues
2. Evaluate performance
3. Suggest improvements
4. Rate code quality (1-10)`
);
```

**Activation:**
- CLI: `/output-style [style-name]`
- Settings: `.claude/settings.local.json`
- SDK loads when `settingSources` includes `'user'` or `'project'`

**When to use:**
- ✅ Persistent behavior changes
- ✅ Specialized assistants
- ✅ Team-shared configurations
- ✅ Complex prompts needing versioning

### Method 3: systemPrompt with append

**Extends Claude Code's default prompt:**

```typescript
const result = query({
  prompt: "Write a Python function",
  options: {
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: "Always include detailed docstrings and type hints in Python code."
    }
  }
});
```

**Characteristics:**
- ✅ Preserves all Claude Code tools
- ✅ Maintains built-in safety
- ✅ Keeps environment context
- ✅ Adds session-specific instructions

**When to use:**
- ✅ Adding coding standards
- ✅ Customizing output formatting
- ✅ Domain-specific knowledge
- ✅ Modifying verbosity
- ✅ Enhancing Claude Code without losing tools

### Method 4: Custom systemPrompt

**Complete control:**

```typescript
const customPrompt = `You are a Python coding specialist.
Follow these guidelines:
- Write clean, well-documented code
- Use type hints for all functions
- Include comprehensive docstrings
- Prefer functional programming patterns
- Always explain your code choices`;

const result = query({
  prompt: "Create a data processing pipeline",
  options: {
    systemPrompt: customPrompt
  }
});
```

**Characteristics:**
- ⚠️ Loses default tools (unless included)
- ⚠️ Must add safety instructions manually
- ⚠️ Must provide environment context
- ✅ Complete control over behavior

**When to use:**
- ✅ Specialized single-session tasks
- ✅ Testing new prompt strategies
- ✅ Situations where default tools aren't needed
- ✅ Building unique specialized agents

### Combining Approaches

**Example: CLAUDE.md + session-specific append:**

```typescript
const result = query({
  prompt: "Review this authentication module",
  options: {
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `
        For this review, prioritize:
        - OAuth 2.0 compliance
        - Token storage security
        - Session management
      `
    },
    settingSources: ['project']  // Loads CLAUDE.md conventions
  }
});
```

### System Prompt Component Breakdown

**Full Claude Code system prompt includes:**

1. **Tool usage instructions** - How to use available tools
2. **Code style guidelines** - Formatting, naming conventions
3. **Response tone** - Verbosity, explanation level
4. **Security instructions** - Safety guardrails
5. **Environment context** - CWD, available commands
6. **Project instructions** - From CLAUDE.md (if loaded)

### Settings Precedence

**When multiple sources are loaded:**

1. Local settings (`.claude/settings.local.json`) - Highest
2. Project settings (`.claude/settings.json`)
3. User settings (`~/.claude/settings.json`) - Lowest

**Programmatic options always override filesystem settings**

### Best Practices

1. **Start with Claude Code preset** - Use `claude_code` unless you have specific needs
2. **Use append for extensions** - Don't recreate the wheel
3. **Load project settings** - Include `settingSources: ['project']` for CLAUDE.md
4. **Version control CLAUDE.md** - Share conventions with team
5. **Keep output styles focused** - One purpose per style
6. **Test custom prompts thoroughly** - Ensure tool access works
7. **Document your choices** - Explain why you chose each approach

---

## Implementation Checklist

### For Custom Tools

- [ ] Import `tool` and `createSdkMcpServer` from SDK
- [ ] Define tools with Zod schemas for type safety
- [ ] Create MCP server with descriptive name and version
- [ ] Use async generator for prompt (streaming input required)
- [ ] Pass MCP servers as object in `mcpServers` option
- [ ] Configure `allowedTools` with full `mcp__server__tool` names
- [ ] Implement error handling in tool handlers
- [ ] Return structured content in tool responses

### For Streaming Output

- [ ] Set `includePartialMessages: true` in options
- [ ] Check message type is `stream_event`
- [ ] Check event type (e.g., `content_block_delta`)
- [ ] Check delta type (e.g., `text_delta`)
- [ ] Track state (current tool, text accumulation)
- [ ] Handle all event types (start, delta, stop)
- [ ] Reset state appropriately at boundaries
- [ ] Flush output for real-time display

### For System Prompts

- [ ] Decide on approach (CLAUDE.md, output style, append, or custom)
- [ ] Use `claude_code` preset unless custom is needed
- [ ] Set `settingSources: ['project']` to load CLAUDE.md
- [ ] Create CLAUDE.md with project conventions
- [ ] Test that tools are available with custom prompts
- [ ] Document system prompt choices
- [ ] Version control CLAUDE.md files

### For TypeScript Configuration

- [ ] Install `@anthropic-ai/claude-agent-sdk`
- [ ] Import specific types needed
- [ ] Configure `Options` object appropriately
- [ ] Handle all message types in iteration
- [ ] Use type guards for message checking
- [ ] Specify `settingSources` explicitly if needed
- [ ] Configure permissions appropriately
- [ ] Test async iteration behavior

---

## Common Patterns Summary

### Pattern: Simple Custom Tool

```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const server = createSdkMcpServer({
  name: "my-tools",
  version: "1.0.0",
  tools: [
    tool("greet", "Greet a user",
      { name: z.string() },
      async (args) => ({
        content: [{ type: "text", text: `Hello, ${args.name}!` }]
      })
    )
  ]
});

async function* messages() {
  yield {
    type: "user" as const,
    message: { role: "user" as const, content: "Greet Alice" }
  };
}

for await (const msg of query({
  prompt: messages(),
  options: {
    mcpServers: { "my-tools": server },
    allowedTools: ["mcp__my-tools__greet"]
  }
})) {
  console.log(msg);
}
```

### Pattern: Streaming UI with Status

```typescript
let inTool = false;

for await (const message of query({
  prompt: "Analyze the codebase",
  options: { includePartialMessages: true }
})) {
  if (message.type === "stream_event") {
    const event = message.event;

    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      process.stdout.write(`\n[${event.content_block.name}...]`);
      inTool = true;
    }
    else if (event.type === "content_block_delta" && event.delta.type === "text_delta" && !inTool) {
      process.stdout.write(event.delta.text);
    }
    else if (event.type === "content_block_stop" && inTool) {
      console.log(" ✓");
      inTool = false;
    }
  }
}
```

### Pattern: Project with CLAUDE.md

```typescript
// .claude/CLAUDE.md
// # Project Standards
// - Use async/await
// - TypeScript strict mode
// - Test coverage >80%

const result = query({
  prompt: "Add a new API endpoint",
  options: {
    systemPrompt: {
      type: "preset",
      preset: "claude_code"
    },
    settingSources: ["project"],  // Loads CLAUDE.md
    allowedTools: ["Read", "Write", "Edit", "Bash"]
  }
});
```

### Pattern: Custom Permission Handler

```typescript
const result = query({
  prompt: "Deploy the application",
  options: {
    permissionMode: "default",
    canUseTool: async (tool, input, options) => {
      if (tool === "Bash" && input.command.includes("rm -rf")) {
        return {
          behavior: "deny",
          message: "Dangerous command blocked",
          interrupt: true
        };
      }
      return {
        behavior: "allow",
        updatedInput: input
      };
    }
  }
});
```

---

## References

- [Custom Tools Documentation](https://platform.claude.com/docs/en/agent-sdk/custom-tools.md)
- [Streaming Output Documentation](https://platform.claude.com/docs/en/agent-sdk/streaming-output.md)
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/agent-sdk/typescript.md)
- [System Prompts Documentation](https://platform.claude.com/docs/en/agent-sdk/modifying-system-prompts.md)

---

## Key Takeaways

1. **Custom tools require streaming input** - Use async generators for prompt
2. **Tool naming matters** - Use `mcp__server__tool` format in allowedTools
3. **Streaming needs nested type checks** - Always check message → event → delta types
4. **Default prompt is minimal** - Use `claude_code` preset for full capabilities
5. **CLAUDE.md needs explicit loading** - Set `settingSources: ['project']`
6. **Type safety is built-in** - Leverage Zod schemas for validation + types
7. **Permissions are flexible** - Use `canUseTool` for custom logic
8. **Combine approaches** - Mix CLAUDE.md + append for best results
