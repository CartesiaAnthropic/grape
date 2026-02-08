export type ResearchStatus = "idle" | "researching" | "done" | "error";

export interface ResearchState {
  status: ResearchStatus;
  query: string | null;
  result: string | null;
  error: string | null;
  progress: string[];
  startedAt: number | null;
  completedAt: number | null;
}

const DEFAULT_STATE: ResearchState = {
  status: "idle",
  query: null,
  result: null,
  error: null,
  progress: [],
  startedAt: null,
  completedAt: null,
};

// Use globalThis to share state across all Next.js route modules in dev mode.
// Module-level variables get duplicated per-route in Turbopack; globalThis doesn't.
declare global {
  // eslint-disable-next-line no-var
  var __grapeResearchState: ResearchState | undefined;
}

function state(): ResearchState {
  if (!globalThis.__grapeResearchState) {
    globalThis.__grapeResearchState = { ...DEFAULT_STATE };
  }
  return globalThis.__grapeResearchState;
}

function setState(next: ResearchState): void {
  globalThis.__grapeResearchState = next;
}

export function getResearchState(): Readonly<ResearchState> {
  return { ...state() };
}

export function canStartResearch(): boolean {
  return state().status !== "researching";
}

export function addProgress(message: string): void {
  const s = state();
  setState({ ...s, progress: [...s.progress, message] });
}

export function startResearch(query: string): void {
  setState({
    status: "researching",
    query,
    result: null,
    error: null,
    progress: ["Research started"],
    startedAt: Date.now(),
    completedAt: null,
  });
}

export function completeResearch(result: string): void {
  const s = state();
  setState({
    ...s,
    status: "done",
    result,
    completedAt: Date.now(),
  });
}

export function resetResearch(): void {
  setState({ ...DEFAULT_STATE });
}

export function failResearch(error: string): void {
  const s = state();
  setState({
    ...s,
    status: "error",
    error,
    completedAt: Date.now(),
  });
}
