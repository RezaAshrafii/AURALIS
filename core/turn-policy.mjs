import { normalizeFa } from './persian-router.mjs';

export function roleLabel(role) {
  return role === 'system' ? 'طرف مقابل / صدای سیستم' : role === 'user' ? 'شما / میکروفون' : 'ورودی دستی';
}

export function shouldAutoAnswerTurn(turn, mode = 'study', options = {}) {
  if (!turn || !['question','request'].includes(turn.kind)) return false;
  const role = String(turn.source_role || 'manual');
  if (mode === 'oral_copilot') {
    // Normal oral-copilot ownership: the other side/system asks, the user answers.
    // Practical fallback: when System Audio is explicitly disabled, Mic becomes the
    // question channel so a mic-only oral session still receives automatic answers.
    if (role === 'system' || role === 'manual') return true;
    return role === 'user' && options.loopbackEnabled === false;
  }
  if (mode === 'meeting') return role === 'system' || role === 'user' || role === 'manual';
  if (mode === 'mock_oral_exam') return false;
  return role === 'user' || role === 'manual';
}

export function isRuntimeCapabilityQuestion(text) {
  const t = normalizeFa(text);
  return /(?:صدای?\s*(?:من|سیستم)|میکروفون|لوپ\s*بک|loopback|ضبط|صوت).*(?:داری|می ?شنوی|میگیری|می ?گیری|کار می ?کنه|فعاله|وصله)|(?:می ?شنوی|شنیدی).*(?:من|صدا)/iu.test(t);
}
