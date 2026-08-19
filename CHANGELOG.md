# Auralis v0.12.0 — Production Audio Core

## هدف این نسخه
v0.12 وارد milestone اصلی Native Windows Audio می‌شود: Rust WASAPI capture، bounded handoff، raw append-only spool، SQLite WAL audio ledger، sequence/QPC integrity، explicit Gap و crash/lifecycle recovery.

## اضافه‌شده
- Rust `auralis-core` v0.12.0 به‌عنوان هسته Production Audio.
- WASAPI event-driven برای Microphone و System Loopback.
- sequence مستقل برای هر channel و QPC/audio-clock metadata.
- bounded capture queue با شمارنده drop و Gap صریح.
- raw audio spool ماندگار قبل از VAD/ASR.
- SQLite WAL ledger و migrations برای session/channel/chunk/gap/lifecycle/recovery.
- recovery scan و resume cursor بعد از interruption/crash.
- Windows hardware-gate runner برای `mic`, `loopback`, `both`.
- verifier خودکار `capture-summary.json`.
- Quick gate و 20-minute gate launchers.

## حفظ‌شده
- UI و workflow نسخه فعلی.
- Live Transcript و Turn/Answer ownership.
- Gemini credential preflight و actionable auth errors.
- Auto Answer، Conversation Hub، Source grounding و Hotkey Z.

## نکته مهم integration
هسته Rust v0.12 هنوز به‌صورت خودکار جایگزین event-producing capture bridge مسیر تعاملی نمی‌شود. دلیل: v0.13 باید bridge نهایی Neural VAD + Streaming ASR + partial/stable/final transcript را روی Rust core اضافه کند. این تصمیم مانع regression در Live Transcript فعلی می‌شود.

## Hardware status
Rust toolchain و Windows hardware در محیط build فعلی موجود نیستند؛ بنابراین Rust compile و Mic/Loopback hardware PASS در این تحویل ادعا نمی‌شود. Scriptهای gate برای اجرای واقعی روی Windows داخل Source/Portable قرار دارند.
