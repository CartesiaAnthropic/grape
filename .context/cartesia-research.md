# Cartesia API Research for Grape

## What Cartesia Offers

### 1. Ink (Speech-to-Text) - CRITICAL for Grape
- **Model**: `ink-whisper`
- **Pricing**: $0.13/hour ($0.0022/min) - cheapest streaming STT available
- **Capabilities**: Handles telephony artifacts, background noise, accents, proper nouns
- **Two modes**:
  - **Batch API** (`POST /stt`): Upload full audio files, get transcription back
  - **WebSocket Streaming**: Real-time transcription via `SttWebsocket` class

#### JS SDK Streaming STT Usage
```typescript
import { CartesiaClient } from "@cartesia/cartesia-js";

const client = new CartesiaClient({ apiKey: process.env.CARTESIA_API_KEY });

// Create WebSocket for real-time STT
const sttWs = client.stt.websocket({
  model: "ink-whisper",
  language: "en",
  encoding: "pcm_s16le",
  sampleRate: 16000,
  minVolume: 0.1,              // VAD threshold (0.0-1.0)
  maxSilenceDurationSecs: 1.0, // Silence before endpointing
});

await sttWs.connect();

// Listen for transcription results
sttWs.onMessage((result) => {
  // result.type: "transcript" | "flush_done" | "done" | "error"
  // result.text: transcribed text
  // result.isFinal: whether this is a final transcript
  // result.words: word-level timestamps [{word, start, end}]
  // result.duration: audio duration
  if (result.type === "transcript") {
    console.log(result.isFinal ? "[FINAL]" : "[PARTIAL]", result.text);
  }
});

// Send audio chunks from microphone
sttWs.send(audioChunkAsArrayBuffer);

// Or use the convenience async generator:
for await (const result of client.stt.transcribeChunks(audioChunksIterable, options)) {
  console.log(result.text);
}
```

### 2. Sonic (Text-to-Speech)
- **Models**: `sonic-2` (standard), `sonic-3` (90ms TTFB), Sonic Turbo (40ms TTFB)
- **Three output methods**:
  - `client.tts.bytes()` - Full audio file (WAV, MP3)
  - `client.tts.sse()` - Server-Sent Events streaming
  - `client.tts.websocket()` - WebSocket streaming (lowest latency)
- **Voice features**:
  - Clone from audio clip
  - Mix voices
  - Localize to different languages
  - Emotion/speed controls

#### JS SDK Streaming TTS Usage
```typescript
const ttsWs = client.tts.websocket({
  sampleRate: 24000,
  container: "raw",
  encoding: "pcm_f32le",
});

await ttsWs.connect();

const { source } = await ttsWs.send({
  modelId: "sonic-2",
  transcript: "Hello! Here's a summary of the meeting so far.",
  voice: { mode: "id", id: "voice-id-here" },
  language: "en",
});

// Play in browser
const player = new WebPlayer({ bufferDuration: 1 });
await player.play(source);
```

### 3. Line (Voice Agent Platform) - For deploying full voice agents
- **Python-based** deployment platform
- Handles STT (Ink) + TTS (Sonic) + telephony + audio orchestration
- You write Python agent code, Cartesia hosts it
- Supports 100+ LLM providers via LiteLLM
- **Calls API**: WebSocket protocol for web/mobile integration
  - `wss://api.cartesia.ai/agents/stream/{agentId}`
  - Events: start, media_input, media_output, ack, clear, dtmf

### 4. Additional APIs
- **Voice Changer**: Transform audio to different voice (same intonation)
- **Infill**: Generate audio to connect two segments smoothly
- **Auth**: Short-lived access tokens for client-side usage

## Architecture for Grape

```
Browser (Next.js)
├── Microphone capture → PCM audio chunks
├── Cartesia STT WebSocket (ink-whisper) → Real-time transcription
│   ├── Partial transcripts → Live display
│   └── Final transcripts → Meeting context accumulation
├── Anthropic Claude API → Analyze discussions, identify features/tasks
│   ├── Research technical challenges
│   └── Generate structured ticket data
├── Notion API → Create Kanban tickets automatically
└── Cartesia TTS WebSocket (sonic) → Voice feedback (optional)
```

## Environment Variables Needed
- `CARTESIA_API_KEY` - Get at https://play.cartesia.ai/keys
- `ANTHROPIC_API_KEY` - For LLM reasoning
- `NOTION_API_KEY` - For ticket management
- `NOTION_DATABASE_ID` - Target Kanban board

## SDK Installed
- `@cartesia/cartesia-js@2.2.9` (already added to package.json)

## Key Files in SDK
- `CartesiaClient` - Main client (wraps streaming + batch)
- `StreamingSTTClient` - Real-time STT via WebSocket
- `StreamingTTSClient` - Real-time TTS via WebSocket
- `SttWebsocket` - Low-level STT WebSocket management
- `WebPlayer` - Browser audio playback helper
