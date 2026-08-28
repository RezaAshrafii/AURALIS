import type {
  AnswerRecord,
  HealthSnapshot,
  RuntimeEvent,
  TranscriptRevisionRecord,
  TurnIntelligenceRecord,
  TurnRecord,
} from "@auralis/contracts";

export interface RuntimeState {
  health: HealthSnapshot | null;
  turns: Map<string, TurnRecord>;
  answers: Map<string, AnswerRecord>;
  intelligenceByTurn: Map<string, TurnIntelligenceRecord>;
  transcriptBySegment: Map<string, TranscriptRevisionRecord>;
}

export function createRuntimeState(): RuntimeState {
  return {
    health: null,
    turns: new Map(),
    answers: new Map(),
    intelligenceByTurn: new Map(),
    transcriptBySegment: new Map(),
  };
}

export function reduceRuntimeEvent(state: RuntimeState, event: RuntimeEvent): RuntimeState {
  switch (event.type) {
    case 'health.changed':
      return { ...state, health: event.payload };
    case 'transcript.partial':
    case 'transcript.stable':
      // Streaming revisions are transient/protocol events. Canonical final
      // transcript revisions remain the durable UI store for this foundation.
      return state;
    case 'transcript.final': {
      const current = state.transcriptBySegment.get(event.payload.segmentId);
      if (!current || event.payload.revision >= current.revision) {
        const transcriptBySegment = new Map(state.transcriptBySegment);
        transcriptBySegment.set(event.payload.segmentId, event.payload);
        return { ...state, transcriptBySegment };
      }
      return state;
    }
    case 'turn.created': {
      const turns = new Map(state.turns);
      turns.set(event.payload.id, event.payload);
      return { ...state, turns };
    }
    case 'turn.intelligence': {
      const intelligenceByTurn = new Map(state.intelligenceByTurn);
      intelligenceByTurn.set(event.payload.turnId, event.payload.intelligence);
      return { ...state, intelligenceByTurn };
    }
    case 'answer.final': {
      const answers = new Map(state.answers);
      answers.set(event.payload.turnId, event.payload);
      return { ...state, answers };
    }
    case 'answer.started':
    case 'audio.gap':
      return state;
  }
}