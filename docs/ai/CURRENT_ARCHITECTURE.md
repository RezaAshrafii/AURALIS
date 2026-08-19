# Auralis current architecture — v0.12.0

v0.12.0 milestone اصلی Production Windows Audio Core است.

## مسیر تعاملی حفظ‌شده
UI / Transcript / Turn / RAG / Brain فعلی حفظ شده‌اند تا migration Native باعث regression در محصول نشود.

## هسته جدید v0.12
`native/core` شامل Rust WASAPI event-driven، bounded handoff، persistent raw spool، SQLite WAL ledger، sequence/QPC، lifecycle/device events و recovery است.

## Integration boundary
Rust hardware runner در این نسخه برای Real Windows Hardware Gate استفاده می‌شود و به‌صورت پیش‌فرض وارد مسیر Live Transcript نمی‌شود. v0.13 باید Neural VAD + Streaming ASR event bridge را روی همین core اضافه کند؛ سپس legacy validation capture bridge حذف می‌شود.

اصل غیرقابل‌تغییر:

> Audio is the source of truth; transcript is derived data.
