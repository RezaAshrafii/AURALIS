# AURALIS — Codex Master Execution Packet

## Authority / Precedence

This packet contains two layers:

1. **Current-State Continuation Brief** — operational truth for the repository as it exists now.
2. **Original Master Implementation Mission** — product architecture, version roadmap, quality gates, and release goals.

If they differ because work has already been completed, the **Current-State Continuation Brief wins for repository state, completed tasks, Git safety, and immediate next actions**.

The Original Master Mission remains authoritative for product intent, architecture, quality targets, milestone goals, and v1 release gates unless the Continuation Brief explicitly adapts sequencing to the current repository.

Do not re-run completed AUR-1101/AUR-1102 work.

Do not push, publish, merge protected branches, or create final version tags without explicit human approval.

---

# AURALIS — Codex Continuation Brief

## Purpose

This file is the execution overlay for the existing **Auralis — Master Implementation Mission**.
The Master Mission remains the product roadmap. This file tells Codex how to continue from the repository's **current real state** without repeating completed work.

---

## Current Repository State

Worktree:

`C:\Users\Reza\Desktop\AURALIS-AUR-1101`

Current branch:

`dev/AUR-1102-contracts`

Current HEAD:

`1ac530ee4e59e52c931313fa3b3366a06e497e87`

Completed work:

- AUR-1101 — source/repository foundation — DONE
- AUR-1102 — authoritative CURRENT contract extraction — DONE

Known verification after AUR-1102:

- `node --test "tests/*.test.mjs"` → 65 total / 54 pass / 11 skip / 0 fail
- `npm run verify` → PASS
- `git diff --check` → PASS
- clean worktree

AUR-1101/AUR-1102 intentionally did **not** redesign the UI or materially change runtime behavior.

The development worktree may not contain `runtime/bun.exe`. A trusted Bun binary from the prior portable build may be used to execute this worktree's `server.mjs` for local smoke testing, but runtime binaries must not be committed to source.

Rollback anchor:

`1ac530ee4e59e52c931313fa3b3366a06e497e87`

---

# Execution Rules

1. Do not redo AUR-1101 or AUR-1102.
2. Do not restart architecture discovery from zero.
3. Read the Master Mission once, then maintain compact state files:
   - `docs/ai/CURRENT_ARCHITECTURE.md`
   - `docs/ai/IMPLEMENTATION_STATUS.md`
   - `docs/ai/MASTER_ROADMAP.md`
4. Use the latest handoff plus those three files for future milestones.
5. Do not repeatedly scan `runtime/`, `releases/`, `data/`, `node_modules/`, binaries, large audio, SQLite runtime DBs, or unrelated filesystem locations.
6. Preserve stable behavior. For each subsystem classify once as:
   - PRESERVE
   - HARDEN
   - REPLACE
7. Do not ask for a new prompt for normal implementation.
8. Stop only for:
   - real Windows hardware validation;
   - new credential/API key;
   - new paid service/credit;
   - destructive migration;
   - destructive Git action;
   - architecture contract conflict;
   - security-sensitive action requiring human approval;
   - a release gate that cannot be verified automatically.
9. Never hardcode or print secrets.
10. Never use `git add .`.
11. Never force-push or rewrite completed history.
12. Do not push, publish releases, merge protected branches, or create final milestone/version tags without explicit human approval.

---

# Immediate Next Actions

Starting from HEAD `1ac530e`:

1. Verify branch, HEAD, and clean worktree.
2. Run the current deterministic baseline.
3. Perform one targeted PRESERVE/HARDEN/REPLACE audit for:
   - UI
   - local server
   - WASAPI capture
   - audio spool
   - ledger
   - VAD
   - ASR
   - transcript
   - turn engine
   - mode policies
   - RAG
   - Brain
   - storage
   - security
   - packaging
   - tests
4. Record results in the three `docs/ai/*` state files.
5. Begin AUR-1103 immediately.
6. Finish v0.11.
7. Continue to v0.12 automatically unless a defined blocker is reached.

---

# v0.11.0 — Complete Engineering Foundation

AUR-1101 and AUR-1102 are complete.

## AUR-1103 — Incremental TypeScript + Vite Foundation

Goal:

- React + TypeScript + Vite
- preserve current UI
- preserve current `/v1` runtime behavior
- deterministic frontend build
- deterministic typecheck
- frontend tests
- no aesthetic redesign
- no dependency explosion
- no production WebSocket implementation merely to satisfy future architecture
- CURRENT contract remains authoritative; future realtime schemas remain TARGET/FUTURE until runtime implementation exists

Acceptance:

- existing regression suite remains green
- frontend typecheck PASS
- frontend build PASS
- frontend tests PASS
- no accidental endpoint/event drift
- current UI can still be run and smoke-tested

## AUR-1104 — Source Layout + v0.11 Gate

Move incrementally toward:

- `apps/`
- `packages/`
- `crates/`
- `tests/`
- `docs/`
- `scripts/`

Only move code when it reduces real architectural drift. Do not rename the entire repository for aesthetics.

v0.11 gate:

- clean source repository
- repeatable build
- versioned contracts
- deterministic frontend build
- all current regression tests green
- source/runtime separation
- portable smoke-build procedure documented
- runnable v0.11 test artifact/procedure available to the user

At gate: report the exact commit ready for `v0.11.0`. Do not tag without approval.

---

# v0.12.0 — Production Windows Audio Core

This is the first major runtime milestone.

Target stack:

- Rust stable
- Tokio
- windows-rs
- Axum
- SQLite WAL
- Serde
- tracing

## AUR-1201 — Audio Core Domain + Persistence

Create/solidify production entities and ports for:

- Session
- AudioChannel
- AudioChunk
- Gap
- CaptureState
- DeviceState
- RecoveryState

Per-channel metadata must include, where supported:

- channel_id
- source_kind
- sample_rate
- channel_count
- channel_mask
- sample_format
- sequence
- QPC timestamp
- device position

## AUR-1202 — Event-Driven WASAPI Mic

Implement real microphone capture.

Capture callback must never block on:

- database
- network
- UI
- ASR
- LLM

Use bounded handoff to persistence.

## AUR-1203 — System Loopback + Dual Capture

Support:

- mic only
- loopback only
- mic + loopback

Keep Mic and System channels independent before ASR.

## AUR-1204 — Persistent Raw Spool + Ledger + Gap

Required:

- raw audio persisted before analysis
- append/finalize chunk lifecycle
- monotonic per-channel sequence
- bounded queues
- persistent Gap on overflow/loss
- no silent drop
- provider/VAD/ASR failure never deletes raw audio

## AUR-1205 — Device Lifecycle + Crash Recovery

Handle:

- unplug
- default-device change
- sleep/resume
- reconnect
- restart
- ledger scan
- incomplete chunk detection
- recoverable job restoration

## AUR-1206 — Windows Hardware Gate

Automated deterministic tests first, then REAL_WINDOWS_HARDWARE:

- Mic only PASS
- Loopback only PASS
- Mic + Loopback PASS
- right-channel-only PASS
- 44.1 kHz PASS
- 48 kHz PASS
- device change PASS
- crash recovery PASS
- 20-minute capture PASS
- unknown sample gaps = 0

At this point provide an exact runnable build path and exact manual checklist.

Do not call v0.12 final until the real Windows gate is executed.

---

# v0.13.0 — Production Speech Engine

## AUR-1301 — Derived Audio

Derived stream for VAD/ASR:

- mono
- 16 kHz
- PCM16 or float32
- proper band-limited resampling
- raw source remains immutable

## AUR-1302 — Neural VAD

Preferred baseline:

- Silero VAD
- ONNX Runtime

or a benchmarked equivalent.

Separate Mic/Loopback thresholds.

## AUR-1303 — Immutable Segmenter

Baseline:

- pre-roll ≈ 300 ms
- endpoint silence ≈ 450–650 ms
- max segment ≈ 15–25 s
- split overlap ≈ 1 s

Frozen segments are immutable.

## AUR-1304 — ASR Port + Providers

Create `AsrPort`.

At least:

- Cloud ASR adapter
- Local ASR/worker boundary

Do not spread provider-specific logic through the domain.

## AUR-1305 — Transcript Revisions

Persist/emit:

- PARTIAL
- STABLE_PREFIX
- FINAL

## AUR-1306 — Retry / Outage / Fallback

Semantics:

- 400 → terminal request error
- 401/403 → AUTH_REQUIRED
- 429 + Retry-After → scheduled retry
- quota exhausted → RETRY_WAIT
- timeout/5xx → bounded exponential backoff + jitter

No infinite retry.

Cloud ASR failure must not stop capture or destroy pending audio/segments.

Credentials are a blocker only for live provider validation, not for provider-independent implementation/tests.

## AUR-1307 — Dedupe + Benchmark

Prevent overlap duplicates and obvious cross-channel echo duplicates.

Build Persian corpus and measure actual performance.

Targets from Master Mission remain authoritative.

Produce a runnable test build.

---

# v0.14.0 — Turn Intelligence + RAG

## AUR-1401
TranscriptRevision → deterministic Turn assembly.

## AUR-1402
Speaker ownership:

- USER
- SYSTEM
- AURALIS

Primary router remains deterministic:

- question
- request
- statement
- answer

Support colloquial Persian.

## AUR-1403
Mode policies + persisted AnswerJob semantics:

- Study
- Oral Copilot
- Meeting
- Mock Exam

Answer jobs must be persisted, idempotent, retryable, and cancelable.

Selecting an existing card must not call the provider again.

## AUR-1404
Unified source ingestion:

- PDF
- DOCX
- TXT
- MD
- CSV where sensible

Preserve document/page/section/paragraph/chunk/span metadata.

## AUR-1405
Retrieval + citation authority:

- Persian normalization
- SQLite FTS5
- BM25
- neighbor expansion

Embeddings only if benchmark improves recall.

Strict source mode returns `INSUFFICIENT_SOURCE` when evidence is insufficient.

## AUR-1406
Gold RAG benchmark + turn gate.

Required invariants:

- cross-turn leakage = 0
- duplicate answers = 0
- wrong speaker ownership = 0
- invalid citation = 0
- Brain outage does not stop ASR
- ASR outage does not stop Capture

---

# v0.15.0 — Production UI + Shared Web Platform

Preserve current visual identity.

## AUR-1501
Consolidate production React + TypeScript + Vite frontend.

## AUR-1502
Implement actual WebSocket runtime + reconnect + state reconciliation.

Only after runtime implementation should CURRENT contracts change from polling semantics.

## AUR-1503
Primary Workspace:

- Current Session
- Live Transcript
- Turn Inspector

Developer details stay in Developer/Health.

## AUR-1504
Conversation Hub + full Transcript History:

- search
- filters
- speaker
- answer state
- jump to turn
- virtualization for long sessions

## AUR-1505
Shared Web capture adapter:

Windows → WASAPI

Web → getUserMedia / getDisplayMedia

Do not claim browser system audio equals Windows capability.

PWA where practical.

## AUR-1506
Accessibility/performance:

- keyboard
- visible focus
- ARIA
- modal focus trap
- reduced motion
- light/dark contrast
- 100+ Turns responsive

Use Master Mission performance targets.

---

# v0.16.0 — Security / Reliability / Packaging

No major new features.

## AUR-1601 — Secrets
Use Windows Credential Manager or DPAPI.

Never persist API keys in:

- localStorage
- plaintext SQLite
- logs
- diagnostics
- URLs

## AUR-1602 — Local API Security

- 127.0.0.1 only
- launch token
- Origin validation
- Host validation
- CSP
- provider allowlist
- SSRF protection
- redirect validation

## AUR-1603 — Observability

Independent health for:

- Mic
- Loopback
- Spool
- Ledger
- VAD
- ASR Cloud
- ASR Local
- Turn Engine
- Retrieval
- Brain
- Storage
- WebSocket

Private diagnostics must not leak secrets/private data.

## AUR-1604 — Retention

Configurable:

- audio retention
- transcript retention
- source retention

## AUR-1605 — Packaging

Generate:

- Windows Portable x64
- Source ZIP
- CHANGELOG
- TEST_REPORT
- BUILD_VERIFICATION
- SHA256SUMS
- handoff

Portable must be self-contained.

## AUR-1606 — Soak

Run/prepare:

- 20-minute daily
- 60-minute pre-release
- 120-minute release gate

Measure:

- memory slope
- DB growth
- queue high-water
- spool lag
- thread leaks
- handle leaks
- ASR reconnects
- answer jobs

---

# v1.0.0 — Stable Release

Feature freeze.

Only:

- P0/P1 fixes
- profiling
- documentation
- packaging
- release QA

All global gates from the Master Mission remain authoritative.

Final release outputs include:

- `Auralis_v1.0.0_Windows_x64_Portable.zip`
- `Auralis_Setup_v1.0.0_x64.exe`
- `Auralis_v1.0.0_Source.zip`
- `Auralis_v1.0.0_Web.zip`
- `CHANGELOG.md`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `BENCHMARKS.md`
- `RELEASE_NOTES.md`
- `SHA256SUMS.txt`

Do not push/tag/release without human approval.

---

# Failure Isolation

Always preserve:

- Brain FAIL != ASR FAIL
- ASR FAIL != Capture FAIL
- UI FAIL != Audio loss

Each subsystem must be independently recoverable.

---

# Job Semantics

ASR and Answer jobs must be:

- persisted
- idempotent
- retryable
- cancelable

A global `busy=true` is not a production queue.

Protect against out-of-order async completion.

---

# Bug Policy

Every reproducible bug:

reproduction → regression test → fix → targeted test → regression suite.

Do not close a real bug without a regression test unless it is strictly hardware-only; then document a hardware reproduction procedure.

---

# Testing Labels

Every result must be labeled:

- UNIT
- FIXTURE
- INTEGRATION
- REAL_WINDOWS_HARDWARE

Never report a fixture as Windows hardware validation.

---

# Milestone Handoff

At each major milestone write a compact handoff:

```json
{
  "version": "v0.13.0",
  "base_commit": "...",
  "head_commit": "...",
  "implemented": [],
  "tests_passed": [],
  "windows_tests_pending": [],
  "known_issues": [],
  "next_milestone": "v0.14.0"
}
```

The next milestone reads this first instead of replaying old development transcripts.

---

# Manual User Test Format

When real user validation is required, return:

```text
TEST BUILD:
<exact path>

START:
<exact command>

TEST:
1. ...
2. ...
3. ...

EXPECTED:
...

FAILURE DATA TO RETURN:
...
```

Do not say only “please test it.”

---

# BLOCKER Format

If and only if a mandatory stop condition is reached:

```text
BLOCKER
Cause:
Evidence:
Required user action:
Work already complete:
Safe next step after unblock:
```

---

# Initial Codex Instruction

Read this file together with the original Master Implementation Mission, `AGENTS.md`, `CLAUDE.md`, latest handoffs, and only the source needed for the current task.

Expected HEAD:

`1ac530ee4e59e52c931313fa3b3366a06e497e87`

AUR-1101 and AUR-1102 are DONE.

Start by verifying the repository and running the baseline. Perform the one-time PRESERVE/HARDEN/REPLACE audit, create/update the compact `docs/ai/*` state files, and immediately begin AUR-1103.

From there continue milestone-by-milestone toward v1.0 without asking for new prompts for routine implementation.

Do not repeatedly scan unrelated or generated content.

Do not expose secrets.

Do not push, tag, publish, or perform destructive Git actions without human approval.

When a real Windows test is needed, stop with the exact test build and exact checklist.

Goal: a real, measured, stable Auralis v1.0.0 — not cosmetic preview versions.


---

# ORIGINAL MASTER IMPLEMENTATION MISSION

# Auralis — Master Implementation Mission

## مأموریت

تو مسئول رساندن پروژه **Auralis** از baseline فعلی:

**Auralis v0.10.12 — Focused Workspace & Conversation Hub**

به:

**Auralis v1.0.0 — Stable Public Release**

هستی.

این مأموریت یک «آپدیت کوچک» نیست.

قرار نیست فقط چند CSS rule، یک دکمه یا یک قابلیت جزئی اضافه کنی و کار را تمام‌شده اعلام کنی.

باید پروژه را به‌صورت مرحله‌ای و مهندسی‌شده از وضعیت فعلی به یک محصول واقعی، پایدار و قابل انتشار تبدیل کنی.

---

# اصل اجرایی

قرار نیست برای هر milestone از کاربر prompt جدید بگیری.

بعد از Audit اولیه:

```text
v0.11
↓
v0.12
↓
v0.13
↓
v0.14
↓
v0.15
↓
v0.16
↓
v1.0
```

را به ترتیب اجرا کن.

فقط در این شرایط متوقف شو:

- blocker واقعی سخت‌افزاری
- نیاز به API/credential جدید
- عملیات destructive
- نیاز به هزینه پولی جدید
- تصمیم معماری‌ای که قراردادهای اصلی را تغییر می‌دهد
- تستی که فقط کاربر می‌تواند روی Windows واقعی انجام دهد

برای تغییرات عادی implementation از کاربر تأیید مجدد نگیر.

---

# قانون مصرف Context و Token

این پروژه بزرگ است. Context را هدر نده.

## هرگز repeatedly scan نکن:

```text
runtime/
releases/
data/
audio spool/
node_modules/
*.zip
*.exe
large wav fixtures
SQLite runtime databases
generated build output
```

مگر همان فایل مشخص برای یک bug لازم باشد.

## منبع حقیقت development

از این‌ها استفاده کن:

```text
source repository
Git history
AGENTS.md
docs/
tests/
package manifests
Cargo manifests
source fixtures کوچک
```

یک بار معماری را بفهم و نتیجه را در:

```text
docs/ai/CURRENT_ARCHITECTURE.md
docs/ai/IMPLEMENTATION_STATUS.md
docs/ai/MASTER_ROADMAP.md
```

ثبت کن.

در milestoneهای بعدی دوباره کل پروژه را از صفر کشف نکن.

---

# Baseline Preservation

UI فعلی v0.10.12 باید baseline محصول باشد.

ظاهر کلی فعلی را بدون دلیل redesign نکن.

موارد فعلی که باید حفظ شوند:

- Workspace مینیمال
- Live Transcript
- Conversation Hub
- Turn Inspector
- Light/Dark theme
- Auto Answer
- Hotkey workflow
- Modeهای Study / Oral Copilot / Meeting / Mock Exam
- Source grounding
- Current Turn isolation
- selectable Turns
- persistent audio philosophy

Refactor مجاز است.

بازطراحی ظاهری سلیقه‌ای ممنوع است.

---

# معماری نهایی غیرقابل مذاکره

اصل:

> Audio is the source of truth. Transcript is derived data.

معماری هدف:

```text
Mic ────────────────┐
                    │
System Loopback ────┼──→ Native Audio Capture
                    │
Process Audio ──────┘
                         ↓
                 Persistent Raw Spool
                         ↓
                  Persistent Audio Ledger
                         ↓
                    Derived Audio
                         ↓
                     Neural VAD
                         ↓
                 Immutable Segments
                         ↓
                   Streaming ASR
                  ↙             ↘
          Cloud Primary       Local ASR
                  ↘             ↙
                Transcript Revisions
                         ↓
                    Turn Assembly
                         ↓
                 Ownership + Router
                         ↓
                 Source Retrieval
                         ↓
                   Text-only Brain
                         ↓
                    Answer Job
                         ↓
                       UI
```

Brain نباید raw audio را در مسیر production دریافت کند.

LLM نباید مسئول:

- Capture
- VAD
- Speech segmentation
- ASR
- primary speaker ownership

باشد.

---

# معماری Process

برای v1 از microservice zoo استفاده نکن.

ساختار مطلوب:

```text
auralis-core.exe
```

وظایف:

- WASAPI
- sessions
- audio ledger
- spool
- VAD
- online ASR orchestration
- turns
- retrieval
- local API
- WebSocket
- health
- persistence

Process جدا فقط در صورت نیاز:

```text
auralis-asr-worker.exe
```

برای:

```text
whisper.cpp / local inference
```

است.

Kafka، gRPC mesh، Electron و سرویس‌های متعدد غیرضروری ممنوع.

---

# Version Strategy

از اینجا releaseهای اصلی به شکل زیر ساخته شوند.

---

# v0.11.0 — Engineering Foundation

هدف:

**تبدیل repository فعلی به پایه‌ای که مدل‌ها و انسان‌ها بتوانند بدون drift روی آن کار کنند.**

این milestone feature-heavy نیست، ولی پایه بقیه پروژه است.

## اقدامات

Repository را تمیز کن.

Binaryها و runtime artifactها از Source tree اصلی جدا شوند.

نباید در context عادی development وجود داشته باشند:

```text
bun.exe
release ZIP
generated EXE
runtime database
raw session audio
large WAV
build artifacts
```

Git structure حرفه‌ای ایجاد شود.

حداقل:

```text
apps/
packages/
crates/
tests/
docs/
scripts/
```

یا نزدیک‌ترین ساختار منطقی متناسب با repo فعلی.

---

## TypeScript Foundation

Frontend فعلی را بدون redesign به TypeScript منتقل کن.

هدف:

```text
React
TypeScript
Vite
```

UI فعلی حفظ شود.

---

## Shared Contracts

یک package مشترک برای قراردادها ایجاد شود:

```text
Session
AudioChannel
SpeechSegment
TranscriptRevision
Turn
Answer
Source
Citation
Gap
HealthState
```

Backend و UI نباید schemaهای جدا و driftدار داشته باشند.

---

## REST / WebSocket Contract

Commands:

```text
start session
stop session
update settings
import source
retry
retranscribe
request answer
```

Events:

```text
audio.level
audio.gap
segment.started
segment.finalized
transcript.partial
transcript.final
turn.created
answer.started
answer.partial
answer.final
device.changed
health.changed
```

---

## CI

حداقل:

```text
Rust fmt
Rust clippy
Rust tests

TypeScript check
Frontend tests
Frontend build

contract tests
integration tests
```

---

## v0.11 Gate

نباید به v0.12 بروی مگر:

```text
clean Git repository
repeatable build
contracts versioned
frontend build deterministic
all current regression tests green
Windows portable baseline still builds
```

---

# v0.12.0 — Production Windows Audio Core

این milestone مهم‌ترین بازنویسی سیستم است.

هدف:

**جایگزینی validation audio implementation فعلی با Production Rust WASAPI Core.**

---

## Rust Runtime

استفاده کن:

```text
Rust stable
Tokio
windows-rs
Axum
SQLite WAL
Serde
tracing
```

---

## Native WASAPI

پشتیبانی:

```text
user-mic
system-loopback
process-loopback when supported
```

Mic و Loopback مستقل باشند.

هر channel:

```text
channel_id
sample_rate
channel_count
channel_mask
sample_format
sequence
QPC timestamp
device position
```

داشته باشد.

---

## Event-driven Capture

WASAPI باید event-driven باشد.

Polling زمانی برای capture ممنوع.

Capture callback نباید منتظر:

```text
database
network
UI
ASR
LLM
```

بماند.

---

## Persistent Spool

Raw audio قبل از هر تحلیل ذخیره شود.

مثلاً chunkهای چندثانیه‌ای:

```text
session/
  user-mic/
  system-loopback/
```

Audio خام نباید به‌دلیل:

```text
silence
low confidence
ASR error
VAD error
provider outage
```

حذف شود.

---

## Sequence Integrity

هر sample range باید sequence داشته باشد.

هر loss باید:

```text
Gap
```

ایجاد کند.

Silent drop ممنوع.

---

## Device Handling

پشتیبانی:

```text
device unplug
default device change
sleep
resume
device reconnect
```

Session نباید بدون ثبت علت خراب شود.

---

## Crash Recovery

پس از crash:

```text
restart
↓
ledger scan
↓
recover completed chunks
↓
mark incomplete state
↓
resume recoverable jobs
```

---

## v0.12 Gate

اجباری:

```text
Mic only PASS
Loopback only PASS
Mic + Loopback PASS
right-channel-only PASS
44.1 kHz PASS
48 kHz PASS
device change PASS
crash recovery PASS
```

و:

```text
20-minute Windows capture
unknown sample gaps = 0
```

تا این تست واقعی روی Windows پاس نشده v0.12 نهایی اعلام نشود.

---

# v0.13.0 — Production Speech Engine

هدف:

**رونویسی فارسی بلادرنگ و پایدار.**

این milestone باید جای segment-final Gemini audio validation فعلی را بگیرد.

---

## Neural VAD

استفاده از:

```text
Silero VAD
ONNX Runtime
```

یا جایگزین benchmarkشده.

Threshold مستقل برای:

```text
Mic
Loopback
```

---

## Derived Audio

ASR/VAD stream:

```text
mono
16 kHz
PCM16 / float32
```

Resampling باید band-limited و benchmarkشده باشد.

box-average ممنوع.

---

## Segmenter

Baseline:

```text
pre-roll ≈ 300ms
endpoint silence ≈ 450–650ms
max segment ≈ 15–25s
split overlap ≈ 1s
```

Segment بعد از freeze:

```text
immutable
```

است.

---

## Streaming ASR

Interface مستقل:

```text
AsrPort
```

حداقل دو implementation:

```text
Cloud Streaming ASR
Local ASR
```

---

## Cloud Provider

Provider فارسی را با benchmark انتخاب کن.

نام جدیدتر مدل به تنهایی معیار انتخاب نیست.

Corpus فارسی بساز شامل:

```text
فارسی رسمی
فارسی محاوره‌ای
سرعت بالا
صدای آرام
نویز
سکوت
اصطلاح دانشگاهی
اعداد
نام‌ها
فارسی + English
جمله بلند
Mic + System overlap
```

---

## Partial / Stable / Final

UI باید events واقعی دریافت کند:

```text
PARTIAL
STABLE PREFIX
FINAL
```

مثلاً:

```text
رگرسیون...

رگرسیون خطی...

رگرسیون خطی ساده چیست؟

FINAL
```

---

## Local Fallback

Worker محلی:

```text
whisper.cpp
```

یا ASR محلی benchmarkشده.

Cloud outage نباید باعث از دست رفتن Audio شود.

Audio segment:

```text
pending
```

بماند و بعداً retranscribe شود.

---

## Retry Policy

```text
400
→ no retry

401 / 403
→ AUTH_REQUIRED

429 + Retry-After
→ scheduled retry

quota exhausted
→ RETRY_WAIT

timeout / 5xx
→ bounded exponential backoff + jitter
```

Retry نامحدود ممنوع.

---

## Dedupe

Overlap segmentation نباید duplicate sentence تولید کند.

Mic و System echo نیز باید قابل تشخیص باشد.

---

## v0.13 Gates

هدف:

```text
missed utterance >700ms <1%
duplicate transcript <0.5%

p95 partial <1s
p95 final after endpoint <2s

clean Persian WER target <12%
noisy/conversational WER target <22%
```

برای v1 gate سخت‌تر جداگانه وجود دارد.

---

# v0.14.0 — Turn Intelligence + Knowledge Brain

هدف:

**Auralis بفهمد چه کسی چه چیزی گفته و فقط وقتی لازم است جواب بدهد.**

---

## Turn Assembly

Turn باید از:

```text
TranscriptRevision
```

ساخته شود.

نه از cumulative transcript UI.

---

## Speaker Ownership

مالک:

```text
USER
SYSTEM
AURALIS
```

بر اساس channel + mode مشخص شود.

Mic و System قبل از ASR با هم mix نشوند.

---

## Deterministic Router

Router اولیه بدون LLM:

```text
question
request
statement
answer
```

فارسی محاوره‌ای پشتیبانی شود.

Regression:

```text
چرا
چی شد
کجا بود
کی میاد
آیا درست است
چند نفر هستند
چقدر طول می‌کشد
فرق این دوتا چیه
```

---

## Mode Policies

### Study

Mic question/request:

```text
Auto Answer
```

### Oral Copilot

System فعال:

```text
System question → Auto Answer
Mic → User response
```

System خاموش:

```text
Mic question → Auto Answer
```

### Meeting

هر speaker ownership مستقل.

Question/request هر طرف قابلیت Answer دارد.

### Mock Exam

```text
Auralis asks
↓
User answers
↓
Evaluation
↓
Adaptive follow-up
```

جواب صحیح نباید هم‌زمان لو داده شود.

---

## Answer Jobs

هر Answer:

```text
turn_id
answer_job_id
state
retrieval evidence
provider
result
```

داشته باشد.

انتخاب کارت نباید Provider را دوباره صدا بزند.

---

## Auto Answer

Default:

```text
Turn created
↓
eligible?
↓
Answer queued automatically
```

Hotkey `Z` فقط override دستی باشد.

---

# RAG / Document Intelligence

در همین milestone Knowledge Engine را production-grade کن.

یک ingestion pipeline واحد:

```text
PDF
DOCX
TXT
MD
CSV when sensible
```

---

## Documents

Metadata:

```text
document
page
section
paragraph
chunk
span
```

Citation باید بتواند به محل واقعی سند اشاره کند.

---

## Retrieval

پایه:

```text
Persian normalization
SQLite FTS5
BM25
neighbor expansion
```

Embedding فقط اگر benchmark ثابت کند Recall را بهبود می‌دهد.

نه صرفاً چون مد روز است.

---

## Large Sources

منبع چندصد صفحه‌ای نباید برای هر سؤال کامل به مدل ارسال شود.

Pipeline:

```text
Question
↓
Retrieve
↓
Evidence Pack
↓
Brain
```

---

## Citation Allowlist

مدل فقط اجازه citation به chunkهایی را دارد که واقعاً retrieve شده‌اند.

Invalid citation:

```text
0
```

---

## Strict Source

اگر پاسخ در Source نیست:

```text
INSUFFICIENT_SOURCE
```

نه hallucination.

---

## RAG Benchmark

Gold dataset بساز.

حداقل:

```text
50–100 questions
```

شامل:

```text
exact facts
definitions
conceptual questions
cross-section questions
unknown facts
rare markers
```

اندازه بگیر:

```text
Recall@K
citation precision
unsupported answer rate
```

---

## v0.14 Gate

اجباری:

```text
cross-turn leakage = 0
duplicate answers = 0
wrong speaker ownership = 0
invalid citation = 0

Brain outage does not stop ASR
ASR outage does not stop Capture
```

---

# v0.15.0 — Product UI + Shared Web Platform

هدف:

**همین UI فعلی را به frontend production-grade مشترک Windows/Web تبدیل کن.**

ظاهر کلی فعلی را حفظ کن.

---

## Frontend

```text
React
TypeScript
Vite
```

Static build.

Next.js لازم نیست.

SSR لازم نیست.

Electron لازم نیست.

---

## Workspace

صفحه اصلی فقط:

```text
Current Session
Live Transcript
Turn Inspector
```

جزئیات فنی:

```text
Developer / Health
```

---

## Conversation Hub

Drawer/Modal:

```text
all Turns
search
filter
speaker
answer status
jump to turn
```

برای session طولانی virtualization استفاده کن.

---

## Transcript History

Transcript کامل در Modal/Drawer.

صفحه اصلی فقط latest activity.

---

## WebSocket Store

Frontend state از WebSocket events تغذیه شود.

Polling سنگین حذف شود.

Reconnect با state reconciliation پیاده شود.

---

## Web Edition

همان UI.

Capture adapter متفاوت:

Windows:

```text
WASAPI
```

Web:

```text
getUserMedia
getDisplayMedia
```

Browser limitation باید صریح نمایش داده شود.

نسخه Web نباید ادعا کند System Audio capability آن معادل Windows است.

---

## PWA

قابل نصب باشد.

اما capture permission limitations مرورگر حفظ شوند.

---

## Accessibility

- keyboard
- visible focus
- ARIA
- modal focus trap
- reduced motion
- light/dark contrast

---

## Performance

100+ Turn باید روان باشد.

اهداف UI:

```text
Turn select <100ms
Modal open <150ms
UI command response <200ms
```

---

# v0.16.0 — Security, Reliability & Release Hardening

هیچ feature بزرگ جدیدی در این نسخه اضافه نشود.

---

## Secret Storage

Windows:

```text
Credential Manager
or DPAPI
```

API key هرگز:

```text
localStorage
SQLite plaintext
logs
diagnostics
URL
```

نباشد.

---

## Local API

فقط:

```text
127.0.0.1
```

با:

```text
launch token
Origin validation
Host validation
CSP
```

---

## Provider Security

Provider endpoint allowlist.

SSRF protection.

Redirect validation.

---

## Crash Diagnostics

Crash dump بدون:

```text
API key
raw audio
private transcript
```

---

## Retention

قابل تنظیم:

```text
audio retention
transcript retention
source retention
```

---

## Installer

Windows:

```text
Portable x64
Installer x64
```

همراه:

```text
VERSION
CHANGELOG
SHA-256
```

در صورت امکان code signing.

---

## Soak

اجباری:

```text
20 minutes daily
60 minutes pre-release
120 minutes release gate
```

اندازه بگیر:

```text
memory slope
DB growth
queue high-water
audio spool lag
thread leaks
handle leaks
ASR reconnects
answer jobs
```

---

# v1.0.0 — Stable Release

از این نقطه Feature Freeze.

هیچ capability جدید اضافه نکن.

فقط:

```text
P0/P1 bug fixes
profiling
documentation
packaging
release QA
```

---

# Global v1 Release Gates

نسخه v1.0 فقط وقتی مجاز است که:

```text
unreported sample gaps = 0

simultaneous mic + loopback soak = 120 min

lost speech segments = 0

false Turns during 60 min controlled silence = 0

right-channel-only fixtures = 100%

out-of-order Turn corruption = 0

ASR outage segment loss = 0

invalid citation = 0

secret leakage = 0
```

Performance target نهایی:

```text
p95 partial transcript <700ms

p95 final transcript after speech end <1200ms

p95 first answer token <2500ms
```

Speech detection target:

```text
clean segmentation recall >=99.5%

noisy segmentation recall >=98%
```

Technical terms / numbers / names:

```text
clean recall >=98%

noisy recall >=95%
```

---

# Long Session Definition

Auralis باید حداقل یک Session دو ساعته را مدیریت کند.

در طول Session:

```text
capture continues
transcription continues
answers continue
UI remains responsive
memory bounded
DB usable
```

دو ساعت Audio نباید داخل RAM نگهداری شود.

---

# Failure Isolation

اصل مهم:

```text
Brain FAIL
≠
ASR FAIL
```

```text
ASR FAIL
≠
Capture FAIL
```

```text
UI FAIL
≠
Audio loss
```

هر subsystem باید independently recoverable باشد.

---

# Observability

Health کلی کافی نیست.

باید health مستقل داشته باشیم:

```text
Mic
Loopback
Spool
Ledger
VAD
ASR Cloud
ASR Local
Turn Engine
Retrieval
Brain
Storage
WebSocket
```

ولی این اطلاعات فقط Developer Mode نمایش داده شوند.

---

# Database

SQLite WAL برای Windows local product کافی است.

حداقل entities:

```text
Session
AudioChannel
AudioChunk
Gap
SpeechSegment
TranscriptRevision
Turn
AnswerJob
Answer
SourceDocument
SourceChunk
Citation
ProviderState
```

---

# Job Semantics

ASR و Answer jobها:

```text
persisted
idempotent
retryable
cancelable
```

باشند.

Global:

```text
busy = true
```

جای queue واقعی نیست.

---

# Cancellation

لغو UI باید تا request واقعی Provider propagate شود.

نه فقط fetch client.

---

# Duplicate Protection

هر Job idempotency key داشته باشد.

برای مثال Answer:

```text
turn_id
model
lane
grounding policy
```

---

# Testing Philosophy

Unit test به تنهایی اثبات product quality نیست.

تست‌ها را چهار دسته گزارش کن:

```text
Unit
Fixture
Integration
Real Windows Hardware
```

هیچ Fixture test را «Windows Audio PASS» اعلام نکن.

---

# Bug Policy

هر bug واقعی:

```text
reproduction
↓
regression test
↓
fix
↓
test
```

بدون regression test بسته نشود.

---

# Git Policy

هر major milestone commit/tag مشخص داشته باشد:

```text
v0.11.0
v0.12.0
v0.13.0
v0.14.0
v0.15.0
v0.16.0
v1.0.0
```

از commitهای:

```text
fix stuff
update files
misc
```

استفاده نکن.

---

# Context Efficiency

بعد از هر milestone یک handoff کوتاه تولید کن:

```json
{
  "version": "v0.13.0",
  "base_commit": "...",
  "head_commit": "...",
  "implemented": [],
  "tests_passed": [],
  "windows_tests_pending": [],
  "known_issues": [],
  "next_milestone": "v0.14.0"
}
```

Milestone بعدی ابتدا همین handoff را بخواند.

کل transcript توسعه قبلی را دوباره وارد Context نکن.

---

# مدل نباید وقت صرف کارهای زیر کند

مگر blocker واقعی:

```text
redesign UI from scratch
rewrite RAG because embeddings look fashionable
add microservices
add Kafka
add Kubernetes
add Electron
add Next.js
replace SQLite
rewrite stable features
rename entire repository
format thousands of unrelated lines
```

---

# مدل باید مستقل کار کند

بعد از Audit اولیه و پذیرش baseline:

هر milestone را:

```text
plan
↓
implement
↓
test
↓
fix
↓
document
↓
commit/tag
↓
continue
```

کند.

برای هر تغییر کوچک از کاربر سؤال نپرس.

---

# توقف اجباری

فقط اگر:

```text
real Windows hardware test required
credential required
paid service required
destructive migration required
architecture contract conflict
release gate genuinely cannot pass
```

متوقف شو.

در صورت توقف، دقیقاً بگو:

```text
BLOCKER
Cause
Evidence
Required action
What is already complete
```

---

# خروجی هر Major Version

برای هر نسخه:

```text
Auralis_vX.Y.Z_Windows_x64_Portable.zip
Auralis_vX.Y.Z_Source.zip
CHANGELOG.md
TEST_REPORT.md
BUILD_VERIFICATION.txt
SHA256SUMS.txt
handoff.json
```

نسخه Windows Portable باید self-contained باشد.

کاربر نباید Node یا Python نصب کند.

---

# خروجی v1.0

حداقل:

```text
Auralis_v1.0.0_Windows_x64_Portable.zip

Auralis_Setup_v1.0.0_x64.exe

Auralis_v1.0.0_Source.zip

Auralis_v1.0.0_Web.zip

CHANGELOG.md

ARCHITECTURE.md

SECURITY.md

BENCHMARKS.md

RELEASE_NOTES.md

SHA256SUMS.txt
```

---

# GitHub Readiness

Repository عمومی نباید شامل:

```text
API keys
user audio
private transcripts
runtime databases
release binaries
node_modules
private sources
```

باشد.

README باید توضیح دهد:

```text
Problem
Architecture
Audio-first design
Streaming ASR
Turn isolation
RAG
Windows vs Web differences
Benchmarks
Quick Start
Privacy
Roadmap
```

---

# Portfolio Quality

پروژه را به‌عنوان:

> AI wrapper

معرفی نکن.

Auralis باید به شکل یک:

> source-grounded, audio-first live copilot with persistent audio capture, streaming Persian speech recognition, deterministic conversational turns, retrieval-grounded reasoning and long-session recovery

قابل ارائه باشد.

---

# مهم‌ترین اصل

هدف این مأموریت تولید تعداد زیادی Version نیست.

هدف:

```text
v0.10.12
↓
stable engineering foundation
↓
production audio
↓
production speech
↓
conversation intelligence
↓
shared product UI
↓
hardening
↓
v1.0
```

است.

اگر بخشی از milestone بعدی در baseline فعلی از قبل وجود دارد:

**آن را دوباره نساز.**

ابتدا verify کن.

اگر gate را پاس می‌کند:

```text
PRESERVE
```

اگر تقریباً درست است:

```text
HARDEN
```

اگر validation-only یا معیوب است:

```text
REPLACE
```

---

# First Action

قبل از coding:

Baseline فعلی v0.10.12 را بررسی کن و برای هر subsystem فقط یکی از این سه وضعیت را بده:

```text
PRESERVE
HARDEN
REPLACE
```

برای:

```text
UI
WASAPI capture
Audio spool
Ledger
VAD
ASR
Transcript
Turn engine
Mode policies
RAG
Brain
Storage
Security
Packaging
Tests
```

سپس بدون بازنویسی دوباره کل roadmap، ساخت milestoneهای بالا را شروع کن.

هدف نهایی:

**یک Auralis v1.0 واقعی، نه مجموعه‌ای از Previewهای پشت‌سرهم.**