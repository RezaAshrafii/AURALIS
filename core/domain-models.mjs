import { randomUUID } from 'node:crypto';

export const ALLOWED_COLOR_TOKENS = ['blue', 'cyan', 'purple', 'emerald', 'amber', 'rose', 'slate'];

export function generateId(prefix = '') {
  const uuid = randomUUID();
  return prefix ? `${prefix}-${uuid}` : uuid;
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeText(text = '') {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function escapeHtml(str = '') {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Deterministic date / deadline parser for Persian & English expressions.
 */
export function parseDeadline(text, baseDate = new Date()) {
  if (!text || typeof text !== 'string') {
    return { dueAtUtc: null, originalText: null, confidence: 0, timezone: 'Asia/Tehran' };
  }
  let clean = text.trim();
  // Convert Persian and Arabic digits to ASCII digits
  clean = clean
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

  const lower = clean.toLowerCase();
  const target = new Date(baseDate.getTime());

  // ISO date format
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    const d = new Date(clean);
    if (!isNaN(d.getTime())) {
      return {
        dueAtUtc: d.toISOString(),
        originalText: clean,
        confidence: 1.0,
        timezone: 'UTC'
      };
    }
  }

  // Persian keywords
  if (clean.includes('امروز') || lower.includes('today')) {
    target.setHours(18, 0, 0, 0);
    return {
      dueAtUtc: target.toISOString(),
      originalText: clean,
      confidence: 0.95,
      timezone: 'Asia/Tehran'
    };
  }

  if (clean.includes('فردا') || lower.includes('tomorrow')) {
    target.setDate(target.getDate() + 1);
    target.setHours(18, 0, 0, 0);
    return {
      dueAtUtc: target.toISOString(),
      originalText: clean,
      confidence: 0.95,
      timezone: 'Asia/Tehran'
    };
  }

  if (clean.includes('پس فردا') || clean.includes('پس‌فردا')) {
    target.setDate(target.getDate() + 2);
    target.setHours(18, 0, 0, 0);
    return {
      dueAtUtc: target.toISOString(),
      originalText: clean,
      confidence: 0.95,
      timezone: 'Asia/Tehran'
    };
  }

  if (clean.includes('آخر هفته') || clean.includes('پایان هفته') || lower.includes('weekend')) {
    // In Iran, Thursday / Friday is weekend. Find next Thursday.
    const day = target.getDay(); // 0 is Sun, 4 is Thu
    const diff = (4 - day + 7) % 7 || 7;
    target.setDate(target.getDate() + diff);
    target.setHours(18, 0, 0, 0);
    return {
      dueAtUtc: target.toISOString(),
      originalText: clean,
      confidence: 0.85,
      timezone: 'Asia/Tehran'
    };
  }

  if (clean.includes('هفته آینده') || clean.includes('هفته بعد') || lower.includes('next week')) {
    target.setDate(target.getDate() + 7);
    target.setHours(18, 0, 0, 0);
    return {
      dueAtUtc: target.toISOString(),
      originalText: clean,
      confidence: 0.85,
      timezone: 'Asia/Tehran'
    };
  }

  // Relative days "X روز دیگر" / "X days"
  const daysMatch = clean.match(/(\d+)\s*(?:روز دیگر|روز بعد|days?)/i);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    target.setDate(target.getDate() + days);
    target.setHours(18, 0, 0, 0);
    return {
      dueAtUtc: target.toISOString(),
      originalText: clean,
      confidence: 0.9,
      timezone: 'Asia/Tehran'
    };
  }

  // If text is ambiguous or general phrase
  return {
    dueAtUtc: null,
    originalText: clean,
    confidence: 0.3,
    timezone: 'Asia/Tehran'
  };
}
