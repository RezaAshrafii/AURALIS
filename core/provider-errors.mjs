function extractProviderMessage(rawBody) {
  const raw = String(rawBody || '').trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    const message = parsed?.error?.message ?? parsed?.message ?? parsed?.error_description ?? '';
    return String(message || '').replace(/AIza[\w-]{10,}/g, '[REDACTED]').slice(0, 500);
  } catch {
    return raw.replace(/AIza[\w-]{10,}/g, '[REDACTED]').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]').slice(0, 500);
  }
}

export function classifyGeminiHttpError(status, rawBody = '', retryAfter = null, scope = 'brain') {
  const code = Number(status || 0);
  const providerMessage = extractProviderMessage(rawBody);
  const target = scope === 'asr' ? 'تبدیل صدا به متن' : 'Brain';

  if (code === 401 || code === 403) {
    return {
      error: 'AUTH_REQUIRED',
      providerStatus: code,
      retryAfter,
      providerMessage,
      message: `کلید Gemini نامعتبر است یا اجازهٔ دسترسی ندارد (HTTP ${code}). کلید Google AI Studio را بررسی و دوباره فعال کن.`
    };
  }
  if (code === 400) {
    return {
      error: scope === 'asr' ? 'ASR_PROVIDER_ERROR' : 'PROVIDER_ERROR',
      providerStatus: code,
      retryAfter,
      providerMessage,
      message: `درخواست ${target} توسط Gemini رد شد (HTTP 400). مدل یا پارامترهای درخواست را بررسی کن.${providerMessage ? ` ${providerMessage}` : ''}`.slice(0, 900)
    };
  }
  if (code === 404) {
    return {
      error: scope === 'asr' ? 'ASR_PROVIDER_ERROR' : 'PROVIDER_ERROR',
      providerStatus: code,
      retryAfter,
      providerMessage,
      message: `مدل یا endpoint مربوط به ${target} پیدا نشد (HTTP 404). شناسهٔ مدل را بررسی کن.`
    };
  }
  if (code === 429) {
    return {
      error: 'RATE_LIMITED',
      providerStatus: code,
      retryAfter,
      providerMessage,
      message: `سهمیه یا نرخ درخواست ${target} محدود شده است. کمی بعد دوباره تلاش کن.`
    };
  }
  if (code >= 500) {
    return {
      error: scope === 'asr' ? 'ASR_PROVIDER_ERROR' : 'PROVIDER_ERROR',
      providerStatus: code,
      retryAfter,
      providerMessage,
      message: `سرویس Gemini موقتاً پاسخ سالم نداد (HTTP ${code}). صوت و داده‌های جلسه حفظ می‌شوند.`
    };
  }
  return {
    error: scope === 'asr' ? 'ASR_PROVIDER_ERROR' : 'PROVIDER_ERROR',
    providerStatus: code || null,
    retryAfter,
    providerMessage,
    message: `${target} پاسخ معتبر HTTP نداد${code ? ` (HTTP ${code})` : ''}.`
  };
}

export function runtimeCredentialReady(runtime) {
  if (!runtime || runtime.enabled !== true || runtime.hasCredential !== true) return false;
  const state = String(runtime.lastState || '').toUpperCase();
  return !/(AUTH_REQUIRED|FAILED|ERROR|REJECTED|NOT_CONFIGURED|DISABLED)/.test(state);
}
