# Auralis v0.12.0 — Production Audio Core Release Gates

## Contract gates
- Capture-first: Raw Audio قبل از VAD/ASR ماندگار شود.
- Mic و System Loopback channelهای مستقل داشته باشند.
- WASAPI event-driven باشد، نه timer polling.
- هر frame دارای sequence و QPC/audio-clock metadata باشد.
- Queue bounded باشد؛ overflow باید Gap صریح بسازد.
- Spool append-only و chunkها SHA-256 + sequence range داشته باشند.
- SQLite با WAL و schema versioned باشد.
- crash/device interruption بدون silent loss در ledger ثبت شود.
- right-channel-only data حذف نشود.

## Real Windows gates
### Quick
- Mic 60s: durable_sequence > 0, dropped_samples = 0, unknown_gap_count = 0.
- Loopback 60s با صدای در حال پخش: همان شرایط.
- Mic + Loopback 120s: هر دو channel durable و queue loss صفر.

### Lifecycle
- unplug/reconnect یا sleep/resume باید interruption durable ایجاد کند؛ silent gap ممنوع.

### Promotion gate
- Mic + Loopback هم‌زمان 20 دقیقه.
- unknown sample gaps = 0.
- queue dropped buffers/samples = 0.
- memory رشد کنترل‌نشده نداشته باشد.

### Final architecture gate inherited from master plan
- قبل از release نهایی معماری: 120-minute soak نیز لازم است.

## Non-goals of v0.12
این milestone هنوز شامل Neural VAD، Streaming ASR partial/stable/final و local whisper fallback نیست؛ آن‌ها v0.13 هستند.
