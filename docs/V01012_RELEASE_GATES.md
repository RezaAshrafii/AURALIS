# Auralis v0.10.12 — Release Gates

این نسخه یک UI/state-presentation milestone است. مسیر Audio → Segment → ASR → Turn → RAG → Brain نباید به دلیل تغییر UI تغییر رفتار کند.

## Main workspace gates
- Processing Cycle در Session main render نشود؛ فقط در System diagnostics باقی بماند.
- Recent Sessions در main render نشود؛ فقط Drawer.
- Current Session فقط در horizontal summary strip باشد.
- Live Transcript فقط transcript صوت را نشان دهد، نه answer preview.
- Main Live Transcript اسکرول افقی نداشته باشد.
- Conversation list در main duplicate نشود؛ Conversation Hub modal تنها archive اصلی Turnهاست.

## Answer gates
- Auto Answer server-owned باقی بماند.
- انتخاب Turn هیچ درخواست answer جدیدی ایجاد نکند.
- اگر answer موجود است فوراً نمایش داده شود.
- Z فقط override دستی/فوری باشد و داخل input/textarea فعال نشود.
- پاسخ هر Turn فقط به همان turn_id متصل باشد.

## Grounding gates
- Strict Source citation فقط از retrieved allowlist.
- unsupported fact باید insufficient شود.
- provider JSON خام در UI ممنوع.

## Architecture gates
- Capture-first invariant حفظ شود.
- حذف/تغییر Audio Ledger، ASR retry/retranscribe، Turn ownership یا source index در این milestone ممنوع است.
- low-level telemetry فقط System/Diagnostics.

## Pending production gates from v0.10 architecture
- Neural VAD benchmarked on Persian speech/noise.
- true streaming ASR partial + stable prefix + final.
- local whisper.cpp fallback.
- 20/60/120 minute Windows soak.
- two-device validation.
