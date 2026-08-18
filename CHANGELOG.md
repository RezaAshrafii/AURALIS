# Auralis v0.11.2 — Runtime Auth Stabilization

## Fixed

- رفع باگ `HEALTH` که وضعیت کلی را در همه شرایط `DEGRADED` گزارش می‌کرد.
- `AI READY` دیگر صرفاً از enabled بودن runtime نتیجه‌گیری نمی‌شود؛ credential معتبر و state سالم لازم است.
- قبل از فعال شدن همزمان ASR و Brain، دسترسی Gemini با همان API key و model بررسی می‌شود.
- خطاهای 401/403، 400، 404، 429 و 5xx به پیام‌های قابل اقدام تبدیل شدند.
- `AUTH_REQUIRED` دیگر به شکل چند کارت جعلی داخل Live Transcript نمایش داده نمی‌شود.
- بعد از خطای احراز هویت، ASR/Brain خودکار متوقف می‌شوند تا درخواست‌های نامعتبر پشت‌سرهم تولید نشود؛ Raw Audio و Ledger حفظ می‌شوند.
- پس از وارد کردن credential معتبر، Speech Segmentهای قبلی و Turnهای بدون پاسخ دوباره در صف پردازش قرار می‌گیرند.
- تنظیمات از اسکرول داخلی جداگانه در هر card خارج شد و page-level scrolling دارد.
- API-key-like material در provider diagnostics redacted می‌شود.

## Preserved

- Focused Workspace v0.10.12 / v0.11.1
- WASAPI validation capture path
- Capture-first raw spool and ledger
- Turn isolation and ownership
- Auto Answer and Z hotkey
- Source grounding, citation allowlist and FTS5 retrieval
- v0.12 Rust hardware-gate binary remains opt-in only

## Not claimed

- API key validity cannot be guaranteed by the application; invalid/revoked keys are now detected and reported accurately.
- Real Windows microphone/loopback and real Gemini requests still require Windows/user credential validation.
- Production Rust audio + neural VAD + streaming partial ASR remain later milestones.
