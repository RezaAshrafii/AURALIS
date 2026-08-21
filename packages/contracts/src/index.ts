export type SessionMode = 'study' | 'oral_copilot' | 'meeting' | 'mock_oral_exam';
export type SourceRole = 'user' | 'system' | 'manual' | 'auralis';
export type TurnKind = 'question' | 'request' | 'statement' | 'answer';
export type GroundingState = 'source' | 'mixed' | 'general' | 'insufficient' | 'runtime';
export type HealthState = 'UNKNOWN' | 'READY' | 'CAPTURING' | 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'STOPPED' | 'DISABLED';

export interface SessionRecord {
  id: string;
  startedAt: string;
  endedAt?: string | null;
  mode: SessionMode;
  state: string;
}

export interface AudioChannelRecord {
  id: string;
  sessionId: string;
  sourceKind: 'microphone' | 'system-loopback' | 'process-loopback';
  sampleRate?: number | null;
  channels?: number | null;
  state: string;
  lastSequence: number;
}

export interface SpeechSegmentRecord {
  id: string;
  sessionId: string;
  channelId: string;
  seqStart: number;
  seqEnd: number;
  durationMs: number;
  audioPath: string;
  endpointReason: string;
  state: string;
}

export interface TranscriptRevisionRecord {
  segmentId: string;
  revision: number;
  provider: string;
  providerModel: string;
  textRaw: string;
  textNormalized: string;
  language: string;
  isFinal: boolean;
}


export type TranscriptStreamState = 'PARTIAL' | 'STABLE' | 'FINAL';

export interface TranscriptStreamEventRecord {
  segmentId: string;
  sequence: number;
  state: TranscriptStreamState;
  provider: string;
  providerModel: string;
  text: string;
  language: string;
  confidence?: number | null;
}

export interface TurnRecord {
  id: string;
  sessionId: string;
  ordinal: number;
  sourceRole: SourceRole;
  kind: TurnKind;
  textRaw: string;
  textNormalized: string;
  state: string;
  createdAt: string;
}

export interface CitationRecord {
  chunkId: string;
  documentId?: string;
  title?: string;
  excerpt?: string;
  ordinal?: number;
}

export interface AnswerRecord {
  id: string;
  turnId: string;
  lane: string;
  model: string;
  answerText: string;
  grounding: GroundingState;
  sourceChunkIds: string[];
  citations?: CitationRecord[];
  createdAt: string;
}

export interface GapRecord {
  id: string;
  sessionId: string;
  channelId: string;
  seqStart?: number | null;
  seqEnd?: number | null;
  reason: string;
  status: string;
  createdAt: string;
}

export interface HealthComponent {
  state: HealthState | string;
  critical: boolean;
  engine?: string;
  detail?: string;
}

export interface HealthSnapshot {
  product: 'Auralis' | string;
  version: string;
  status: HealthState | string;
  schemaVersion: number;
  components: Record<string, HealthComponent>;
}

export type RuntimeEvent =
  | { type: 'transcript.partial'; payload: TranscriptStreamEventRecord }
  | { type: 'transcript.stable'; payload: TranscriptStreamEventRecord }
  | { type: 'transcript.final'; payload: TranscriptRevisionRecord }
  | { type: 'turn.created'; payload: TurnRecord }
  | { type: 'answer.started'; payload: { turnId: string; jobId?: string } }
  | { type: 'answer.final'; payload: AnswerRecord }
  | { type: 'audio.gap'; payload: GapRecord }
  | { type: 'health.changed'; payload: HealthSnapshot };
