import type { OutputType } from '../settings.ts';

// ---------- Agent surface ----------

export interface AgentTask {
  /** Stable task kind, e.g. 'style-sample', 'source-report'. Fakes key canned output on it. */
  kind: string;
  /** Full instructions for the agent. */
  prompt: string;
  /** Structured inputs; also written to the workdir as inputs.json. */
  inputs: Record<string, unknown>;
  /** The agent must write its structured result to this file (relative to workdir) as JSON. */
  resultFile?: string;
  /** Extra directories the agent may read (sources, skills). */
  readDirs?: string[];
  /** Files (relative to workdir) the agent must write; a run that doesn't is an invalid-output failure. */
  expectFiles?: string[];
  /** Tools the agent may use. Defaults to file read/write tools only, no shell. */
  tools?: string[];
}

export interface AgentRunOptions {
  workdir: string;
  model: string;
  effort: string;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}

export interface AgentUsage { inputTokens?: number; outputTokens?: number; costUsd?: number; durationMs?: number }

export type AgentFailureKind = 'unavailable' | 'auth' | 'timeout' | 'cancelled' | 'invalid-output' | 'failed';

export type AgentResult =
  | { ok: true; output: any; usage: AgentUsage }
  | { ok: false; error: { kind: AgentFailureKind; message: string }; usage?: AgentUsage };

export interface AgentSurface {
  id: string;
  label: string;
  run(task: AgentTask, opts: AgentRunOptions): Promise<AgentResult>;
}

// ---------- TTS ----------

export interface Voice { id: string; name: string; language: string; gender?: string; engine?: string; description?: string }

export interface ControlRange { min: number; max: number; default: number; step: number; unit: string }

export interface TtsCapabilities {
  controls: Partial<Record<'rate' | 'pitch' | 'volume', ControlRange>>;
  /** Controls this voice can't honor, with the reason shown in the UI. */
  unsupported: Partial<Record<'rate' | 'pitch' | 'volume' | 'style', string>>;
  /** Speaking styles, e.g. 'news'. Empty when none. */
  styles: string[];
  /** 'native' when the engine returns word timings, 'aligned' when we derive them. */
  wordTimings: 'native' | 'aligned';
}

export interface VoiceControls { rate?: number; pitch?: number; volume?: number; style?: string }

export interface WordTiming { text: string; startMs: number; endMs: number }

export interface Narration { audioFile: string; durationMs: number; words: WordTiming[] }

export interface TtsProvider {
  id: string;
  label: string;
  voices(): Promise<Voice[]>;
  capabilities(voiceId: string): Promise<TtsCapabilities>;
  /** Writes audio to outFile (extension chosen by caller: .wav or .mp3). */
  synthesize(text: string, voiceId: string, controls: VoiceControls, outFile: string): Promise<Narration>;
}

// ---------- Renderer ----------

export interface ScenePlan {
  /** Stable scene ID; comments and partial re-renders key on it. */
  id: string;
  title: string;
  narration: string;
  /** What the scene shows, in prose for the agent. */
  visuals: string;
  /** Which elements the scene exercises (opening, transition, text-popups, boxes, diagram, camera). */
  elements?: string[];
}

export interface TimedScene extends ScenePlan {
  audioFile?: string;
  durationMs: number;
  startMs: number;
  words: WordTiming[];
}

export interface RenderRequest {
  outputType: OutputType;
  /** The full DESIGN.md text of the style. */
  style: string;
  title: string;
  /** Video: timed scenes. Others: sections/slides as scenes with no audio. */
  scenes: TimedScene[];
  /** Freeform document body (Markdown) for doc/visual types. */
  document?: string;
  workdir: string;
  /** Scene IDs whose output must be regenerated; others may be reused from cacheDir. */
  dirtyScenes?: string[];
  /** Previous render's workdir, for reusing unchanged scenes. */
  cacheDir?: string;
  agent?: { surface: AgentSurface; model: string; effort: string };
  comments?: string[];
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  /** Main output file (absolute path). */
  primary: string;
  /** All output files (absolute paths), including primary. */
  files: string[];
  durationMs?: number;
  sceneCount: number;
  /** Scene IDs actually (re)rendered this time. */
  rendered: string[];
}

export interface Renderer {
  id: string;
  label: string;
  outputTypes: OutputType[];
  render(req: RenderRequest): Promise<RenderResult>;
}
