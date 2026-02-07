# Grape Voice Playground — Demo Flow

## Scene

The team is sitting together working on Grape, discussing architecture decisions (e.g., "Should we use MongoDB for storing transcripts or is just using Anthropic's Conversations API enough?").

## Flow

### 1. Passive listening
Grape transcribes the conversation in real time. It stays completely silent — no interruptions, no acknowledgments.

### 2. Proactive trigger (silent)
Someone asks a researchable question. Grape detects it and **silently** kicks off background research. No speech — the Grape indicator changes color (e.g., from idle → researching) as the only visual cue.

### 3. Background research in progress
The indicator stays in "researching" state while Grape works in the background (web search, API calls, etc.). The team continues their conversation uninterrupted.

### 4. Research completes
The indicator changes again (e.g., researching → result ready) so the team notices something is pending. Still no speech — Grape waits to be addressed.

### 5. User asks for findings
Someone says: **"Hey Grape, what did you find?"**

### 6. Grape speaks a short recommendation
Grape gives a brief recommendation based on the research — 1-2 sentences max. Then offers available follow-up actions:

> "Based on what I found, the Conversations API should cover your needs for now — it handles storage and retrieval without extra infra. Want me to drill down on the trade-offs, create a Linear ticket for this decision, or email the research summary to the team?"

### 7. User picks an action
User says: **"Yeah, create a ticket"**

### 8. Grape executes and confirms
Grape creates the Linear ticket and speaks a short confirmation:

> "Done — created GRAPE-42: Evaluate transcript storage approach. Anything else?"

---

## Implementation Status

| Step | Status |
|------|--------|
| 1. Passive listening (STT) | Implemented |
| 2. Proactive trigger detection | Not yet — currently requires "Hey Grape" to respond |
| 3-4. Background research + indicator | Not yet |
| 5. Respond when addressed | Implemented (basic) |
| 6. Short recommendation with actions | Not yet — needs prompt tuning |
| 7-8. Execute follow-up actions (Linear, email) | Not yet — needs Linear MCP + email tool |

## Key Principles

- **Never speak unprompted.** Visual indicators only until addressed.
- **Short responses.** 1-2 sentences, then offer actions. Users can ask to drill down.
- **Action-oriented.** Don't just summarize — offer concrete next steps (tickets, emails, docs).
