import type { AnswerRecord, HealthSnapshot, RuntimeEvent, TranscriptRevisionRecord, TurnRecord } from '@auralis/contracts';

export interface RuntimeState {
  health: HealthSnapshot | null;
  turns: Map<string, TurnRecord>;
  answers: Map<string, AnswerRecord>;
  transcriptBySegment: Map<string, TranscriptRevisionRecord>;
}

export function createRuntimeState(): RuntimeState {
  return {
    health: null,
    turns: new Map(),
    answers: new Map(),
    transcriptBySegment: new Map(),
  };
}

export function reduceRuntimeEvent(state: RuntimeState, event: RuntimeEvent): RuntimeState {
  switch (event.type) {
    case 'health.changed':
      state.health = event.payload;
      break;
    case 'transcript.partial':
    case 'transcript.stable':
      // Streaming revisions are transient/protocol events. Canonical final
      // transcript revisions remain the durable UI store for this foundation.
      break;
    case 'transcript.final': {
      const current = state.transcriptBySegment.get(event.payload.segmentId);
      if (!current || event.payload.revision >= current.revision) {
        state.transcriptBySegment.set(event.payload.segmentId, event.payload);
      }
      break;
    }
    case 'turn.created':
      state.turns.set(event.payload.id, event.payload);
      break;
    case 'answer.final':
      state.answers.set(event.payload.turnId, event.payload);
      break;
    case 'answer.started':
    case 'audio.gap':
      break;
  }
  return state;
}
