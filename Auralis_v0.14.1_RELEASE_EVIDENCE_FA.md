# شواهد انتشار AURALIS v0.14.1

## نتیجه

این نسخه patch اصلاحی milestone v0.14 است. مشکل false-LIVE و قطع بودن زنجیرهٔ Rust capture تا Segment/ASR در source اصلاح شده است.

## اصلاح‌های اصلی

- باینری v0.13 دیگر به‌صورت پیش‌فرض product bridge فرض نمی‌شود.
- artifact بسته‌بندی‌شدهٔ v0.14.1 پروتکل session-bound `auralis.native/jsonl-v1` دارد.
- `audio.chunk_closed` فقط بعد از finalize فایل و commit native SQLite منتشر می‌شود.
- eventهای مهم پیش از stdout در `product-events.jsonl` durable می‌شوند و startup آن‌ها را idempotent replay می‌کند.
- raw chunk پیش از تبدیل، از نظر byte length و SHA-256 دوباره اعتبارسنجی می‌شود.
- PCM/float WASAPI پشتیبانی‌شده به WAV مونو PCM16 تبدیل و سپس Segment immutable ساخته می‌شود.
- session فقط بعد از دریافت event شروع همهٔ channelهای درخواستی `CAPTURING/LIVE` می‌شود.
- خطای پنهان import نشدن `node:path.sep` در اولین ASR audio read رفع شد.
- fixed-window segmentation صریح است؛ neural VAD ادعا نشده است.

## Gateهای اجراشده در محیط source

```text
Focused audio bridge tests: 10 passed, 0 failed
Full Node suite:            125 total, 114 passed, 0 failed, 11 platform skips
Citation benchmark:         PASS, precision=1.00, quoteCoverage=1.00
Retrieval benchmark:        PASS
TypeScript strict check:    PASS
Deterministic web build:    PASS
Source verify:              AURALIS_VERIFY_PASS
ZIP CRC:                    PASS
```

Skipهای ثبت‌شده مربوط به probe قدیمی/باینری native بسته‌بندی‌نشده در محیط portable هستند و failure پنهان نیستند.

## Gateهای اجرا نشده در این محیط

- Rust `cargo fmt/clippy/test/build`؛ toolchain در محیط موجود نبود.
- Windows WASAPI hardware product bridge gate؛ Windows و سخت‌افزار صوتی موجود نبود.
- ASR provider live transcription؛ credential/provider call واقعی موجود نبود.
- 20/120-minute Windows soak.

این موارد `NOT_RUN` هستند و PASS محسوب نمی‌شوند.

## Gate نهایی روی Windows

از root پروژه:

```powershell
.\BUILD-V014-PRODUCT-BRIDGE.cmd
.\RUN-V014-PRODUCT-BRIDGE-GATE.cmd
npm ci
npm start
```

سپس در UI:

1. AI را با credential معتبر فعال کن.
2. برای تست کوتاه فقط Microphone را روشن نگه دار.
3. chunk window را 2 یا 3 ثانیه بگذار.
4. Session را شروع کن و یک جملهٔ فارسی 5 تا 8 ثانیه‌ای بگو.
5. باید `LIVE` فقط بعد از event واقعی ظاهر شود، Audio Chunk و Segment افزایش یابد و Transcript final نمایش داده شود.

اگر bridge gate یا live transcript fail شد، نسخه برای شروع v0.15 آماده نیست.
