# قرارداد مادر معماری و اجرای AURALIS

نسخهٔ سند: 1.0  
Baseline اجباری: AURALIS v0.14.1  
مخاطب: مدل اجرایی کدنویس (Gemini Flash/Pro یا مدل هم‌سطح)  
مالک تصمیم‌های معماری: معمار اصلی پروژه

## 1. نحوهٔ استفاده

این سند همراه با پرامپت نسخهٔ هدف به مدل اجرایی داده می‌شود. قواعد این سند الزام‌آورند. اگر میان این سند و پرامپت نسخه تعارضی وجود داشت، پرامپت نسخه فقط در محدوده‌ای که صریحاً استثنا تعریف کرده اولویت دارد. مدل اجرایی حق تغییر خودسرانهٔ معماری، حذف gate، بازنویسی تاریخچه، یا ادعای قابلیت تست‌نشده را ندارد.

مدل باید کار را اجرا کند، نه اینکه صرفاً پیشنهاد یا pseudo-code تحویل دهد. پرسش فقط زمانی مجاز است که یکی از Stop Conditionهای انتهای سند واقعاً رخ دهد.

## 2. تعریف محصول

```text
AURALIS = Persian-first Personal Intelligence Platform
```

وعدهٔ محصول:

> AURALIS مکالمه‌ها را می‌شنود، شواهد را نگه می‌دارد، مفهوم را استخراج می‌کند، تصمیم‌ها و کارها را قابل پیگیری می‌کند و با کنترل کامل کاربر مانع فراموشی می‌شود.

AURALIS این موارد نیست:

- یک ChatGPT فارسی با پوستهٔ متفاوت؛
- Voice Recorder ساده؛
- Meeting Summarizer بدون حافظه و اقدام؛
- مجموعه‌ای از featureهای مستقل بدون مدل دامنه؛
- محصولی وابسته به نام یک مدل AI یا یک Provider.

## 3. اصل معماری کلان

AURALIS تا پایان v0.17 یک **modular monolith محلی و capture-first** می‌ماند. در v0.18 یک Cloud modular monolith مستقل با API و Worker اضافه می‌شود. microservice فقط با ADR، دادهٔ عملیاتی و تأیید معمار مجاز است؛ «احتمالاً بعداً scale می‌کنیم» دلیل کافی نیست.

مرزهای اصلی:

| Bounded Context | مالکیت | اجازهٔ وابستگی |
| --- | --- | --- |
| Native Capture | WASAPI، صف محدود، raw spool، Gap، native ledger، JSONL bridge | هیچ وابستگی به UI، ASR provider یا Memory ندارد |
| Conversation | Conversation/Session، Channel، Segment، Transcript، Turn | از Native event می‌خواند؛ به Domain Product وابسته نیست |
| Understanding | intent، summary، decision، commitment، action candidate، citation | از Conversation و Knowledge می‌خواند |
| Knowledge | Document، version، chunk، retrieval، citation lineage | مستقل از Provider و UI |
| Action | Task، deadline، assignee، status، provenance | از Understanding candidate می‌پذیرد؛ مالک workflow است |
| Memory | memory candidate/item/revision/evidence/contradiction | فقط از v0.16 فعال می‌شود |
| Workspace | Project، Person، membership/linking، aggregate navigation | Contextهای دیگر را لینک می‌کند؛ مالک raw audio نیست |
| Domain Products | CRM، Assistant، Meeting projection/workflow | Core را مصرف می‌کند؛ Core به آن وابسته نیست |
| Identity/Tenancy | User، Organization، Membership، Role | از v0.18 در Cloud اجباری است |
| Sync | change log، cursor، conflict policy، blob transfer | از v0.18 فعال می‌شود |
| Entitlement/Billing | Plan، entitlement، usage، subscription، webhook ledger | از v0.19 فعال می‌شود |
| Notification | reminder schedule، delivery، receipt | از Action/Memory event مصرف می‌کند |
| Observability | event/metric/trace/audit | payload حساس یا raw audio را جمع نمی‌کند |

قانون وابستگی:

```text
UI -> Application API -> Application Services -> Domain -> Ports
                                                <- Adapters
Native adapters -> Native domain ports
```

Domain نباید Bun/Node/React/SQLite/PostgreSQL/HTTP/Provider SDK را import کند. Route handler نباید business rule یا SQL دامنه‌ای داشته باشد. UI نباید entitlement، capture readiness، memory confidence یا task truth را خودش اختراع کند.

## 4. Source of Truth و lineage

ترتیب اعتبار داده:

1. Raw audio نهایی‌شده + Gap ledger، مرجع شواهد صوتی است.
2. Transcript یک دادهٔ derived و revisioned است؛ raw audio را بازنویسی نمی‌کند.
3. Turn از Transcript final یا ورودی دستی ساخته می‌شود و ownership منبع دارد.
4. Understanding/Task/Memory باید provenance قابل بازگشت به Turn/Segment/Document و در صورت امکان exact quote داشته باشد.
5. ویرایش کاربر revision جدید می‌سازد؛ تاریخچه به‌صورت بی‌صدا overwrite نمی‌شود.
6. Delete منطقی با tombstone انجام می‌شود؛ hard purge فقط از workflow اختصاصی و قابل ممیزی.

هیچ قابلیت derived حق ندارد capture را block کند. شکست شبکه، Provider، retrieval، memory extraction یا notification نباید raw capture را متوقف یا خراب کند.

## 5. قرارداد هویت، زمان و اعداد

- شناسه‌های جدید client-generated و globally unique باشند؛ UUIDv7 ترجیح دارد. شناسهٔ موجود بدون migration plan عوض نشود.
- همهٔ timestampهای پایدار UTC و RFC3339 هستند.
- timezone انتخابی کاربر جداگانه نگه‌داری می‌شود؛ deadline علاوه بر UTC، `original_text` و `parse_confidence` دارد.
- duration بر حسب integer millisecond؛ audio sequence بر حسب frame و integer؛ byte size بر حسب integer byte.
- مبلغ همیشه integer minor unit همراه ISO currency است؛ float برای پول ممنوع.
- confidence عدد محدود `[0,1]` است و null با zero یکی نیست.
- enumهای persisted بسته و versioned باشند؛ مقدار ناشناخته fail-safe شود.

## 6. قرارداد Event

Event پایدار باید envelope زیر را داشته باشد:

```json
{
  "eventId": "uuid",
  "eventType": "context.aggregate.action.v1",
  "aggregateId": "uuid",
  "workspaceId": "uuid-or-null",
  "organizationId": "uuid-or-null",
  "actorId": "uuid-or-system",
  "occurredAt": "RFC3339 UTC",
  "schemaVersion": 1,
  "correlationId": "uuid",
  "causationId": "uuid-or-null",
  "payload": {}
}
```

قواعد:

- Event نام‌گذاری و version می‌شود؛ payload بی‌نسخه ممنوع.
- Consumer حداقل idempotent است و `eventId` را deduplicate می‌کند.
- writeهای مهم DB و outbox در یک transaction انجام می‌شوند.
- PII، secret، transcript کامل و raw audio وارد log عمومی نمی‌شود.
- UI event موقت را با canonical persisted record یکی فرض نمی‌کند.

## 7. قرارداد API

- APIهای جدید زیر `/v1` تا زمان شکستن رسمی major version باقی می‌مانند.
- JSON object-only، UTF-8، اندازه‌محدود و schema-validated است.
- error envelope:

```json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "safe user-facing message",
    "correlationId": "uuid",
    "details": {}
  }
}
```

- `details` secret یا stack trace ندارد.
- mutationهای قابل retry idempotency key می‌پذیرند.
- pagination cursor-based است؛ offset برای collectionهای رو به رشد ممنوع.
- optimistic concurrency با `revision` یا `If-Match` اعمال می‌شود.
- endpointهای legacy تا پایان پنجرهٔ migration adapter باقی می‌مانند و deprecation telemetry دارند.

## 8. Persistence و Migration

- migration append-only است؛ migration منتشرشده edit یا renumber نمی‌شود.
- هر migration forward، rollback/restore strategy، index plan و backfill قابل restart دارد.
- destructive column drop حداقل یک نسخه بعد از dual-read/dual-write انجام می‌شود.
- foreign key، unique constraint، check constraint و indexهای query path در DB وجود دارند؛ validation فقط در UI کافی نیست.
- repositoryها SQL را مالک‌اند. Route/Application Service SQL inline جدید نمی‌پذیرد.
- migration روی fixture نسخهٔ قبلی و DB خالی تست می‌شود.
- backup قبل از migration و recovery evidence جزو release gate است.

## 9. AI و Provider Independence

- مدل AI یک Adapter پشت Port است؛ نام مدل در Domain ذخیره نمی‌شود مگر در execution/audit metadata.
- prompt و output schema version دارند.
- structured output با schema validator بررسی می‌شود؛ parse تقریبی یا regex جای schema را نمی‌گیرد.
- هر extraction دارای `provider`, `model`, `promptVersion`, `inputFingerprint`, `createdAt`, confidence و provenance است.
- retry محدود، backoff و idempotency دارد.
- hallucinated task/memory/decision تا تأیید policy مربوطه canonical نمی‌شود.
- متن Document/Transcript دادهٔ غیرقابل اعتماد است و نمی‌تواند system instruction را override کند.
- تعویض Provider نباید schema دامنه یا UI را تغییر دهد.

## 10. امنیت و حریم خصوصی

- least privilege، deny-by-default و fail-closed.
- secret در source، log، localStorage، diagnostics export یا DB plaintext ممنوع.
- local secret در OS credential vault؛ cloud secret در secret manager.
- تمام tenant-owned queryها در v0.18+ `organization_id`/`workspace_id` scope دارند و تست cross-tenant اجباری است.
- object storage از signed URL کوتاه‌عمر و key غیرقابل حدس استفاده می‌کند.
- upload با MIME allowlist، size limit، hash و malware policy کنترل می‌شود.
- data export، account deletion، retention و audit trail از v0.18 به بعد الزامی است.
- AURALIS به‌علت پردازش server-side AI ادعای E2EE نمی‌کند مگر معماری و threat model جداگانه واقعاً آن را ثابت کند.

## 11. UI Truthfulness و Accessibility

- `LIVE`, `SYNCED`, `SAVED`, `PAID`, `REMEMBERED`, `SENT` فقط از canonical backend state نمایش داده می‌شود.
- loading، empty، partial، stale، degraded و failure state جدا هستند.
- optimistic UI rollback و conflict state دارد.
- Persian RTL و English/LTR mixed content تست می‌شود.
- keyboard navigation، focus management، semantic labels، contrast و screen-sizeهای desktop/tablet/mobile gate دارند.
- dark/light از token system واحد استفاده می‌کند؛ رنگ hard-coded پراکنده ممنوع.
- responsive یعنی workflow کامل، نه صرفاً کوچک‌شدن layout.

## 12. Observability و Audit

حداقل هر workflow:

- correlation ID end-to-end؛
- success/failure/latency metric؛
- structured safe log؛
- retry/dead-letter visibility؛
- user/security-sensitive mutation audit؛
- health/readiness جدا از liveness.

Metric label نباید user ID، transcript، title آزاد یا cardinality نامحدود داشته باشد.

## 13. استراتژی تست

هر نسخه باید این لایه‌ها را متناسب با تغییر خود داشته باشد:

1. Unit: ruleهای Domain و pure transformerها.
2. Contract: schema، event، Provider adapter، API backward compatibility.
3. Repository: constraint، transaction، migration، concurrent update.
4. Integration: workflow واقعی با DB و Adapter fake کنترل‌شده.
5. E2E: مسیرهای اصلی کاربر با stateهای failure/degraded.
6. Security: authz، tenant isolation، upload، SSRF، secret redaction.
7. Performance: query budget، large conversation/document، sync/billing load طبق نسخه.
8. Recovery: crash/restart، retry، backup/restore و idempotency.

Test نباید فقط وجود string در source را اثبات کند اگر رفتار قابل اجراست. Mock نباید همان کد production را دوباره پیاده کند. Gate اجرا نشده با `PASS` گزارش نمی‌شود.

## 14. فرایند اجباری مدل اجرایی

### Phase A — Inspect

1. `AGENTS.md` و دستورهای repository را بخوان.
2. `VERSION`, architecture docs، schema/migrations، contracts، package scripts و test suite را بررسی کن.
3. baseline gate نسخهٔ قبلی را اجرا کن.
4. dirty worktree را ثبت و تغییرات نامرتبط کاربر را حفظ کن.
5. اختلاف baseline با این پرامپت را در `IMPLEMENTATION_NOTES.md` ثبت کن.

### Phase B — Design checkpoint

قبل از mutation گسترده، این artifactها را بساز یا به‌روزرسانی کن:

- ADRهای تصمیم تازه؛
- migration plan؛
- API/event schema؛
- threat/privacy delta؛
- test matrix؛
- rollout/rollback plan.

این checkpoint مجوز توقف برای تأیید نمی‌دهد مگر Stop Condition رخ دهد؛ سپس implementation ادامه پیدا می‌کند.

### Phase C — Implement in vertical slices

ترتیب هر slice:

```text
Domain rule -> Port -> Repository/Adapter -> Application Service -> API -> UI -> Tests -> Evidence
```

placeholder، TODO مسیر اصلی، fake success، dead button، hard-coded demo data و route بدون authorization ممنوع.

### Phase D — Verify

- focused tests بعد از هر slice؛
- full regression؛
- typecheck/lint/build؛
- migration from prior fixture؛
- clean-install smoke؛
- failure/retry/recovery scenario؛
- platform gate روی platform واقعی یا اعلام صریح `NOT_RUN`.

### Phase E — Review packet

مدل باید در پایان این فایل‌ها/خروجی‌ها را تحویل دهد:

1. `IMPLEMENTATION_REPORT_<VERSION>.md`
2. `TEST_EVIDENCE_<VERSION>.md`
3. `MIGRATION_AND_ROLLBACK_<VERSION>.md`
4. فهرست فایل‌های تغییرکرده با دلیل
5. command و exit code واقعی تمام gateها
6. capabilityهای واقعاً فعال و non-capabilityها
7. ریسک‌های باقی‌مانده، `NOT_RUN`ها و blockerها
8. checksum artifact نهایی

## 15. ممنوعیت‌ها

- تغییر scope نسخهٔ بعدی در نسخهٔ فعلی؛
- بازنویسی Native Capture برای feature UI؛
- microservice، event bus یا vector DB بدون نیاز اثبات‌شده و ADR؛
- حذف compatibility adapter پیش از telemetry و migration window؛
- frontend-only authorization/entitlement؛
- memory بدون provenance و کنترل کاربر؛
- task/deadline قطعی از output مدل بدون confidence/policy؛
- ذخیرهٔ API key در browser storage؛
- تست‌سازی برای match کردن implementation غلط؛
- کم‌کردن threshold تست یا حذف gate برای سبزشدن build؛
- ادعای Windows/Android/Cloud/Store gate در محیطی که اجرا نشده است.

## 16. ترتیب نسخه و Scope Lock

| نسخه | هدف | خارج از Scope |
| --- | --- | --- |
| v0.15 | Product Experience محلی | حافظهٔ یادگیرنده، Cloud، Billing |
| v0.16 | Personal Memory محلی و کنترل‌شده | محصول‌های عمودی، Cloud، Billing |
| v0.17 | CRM/Assistant/Meeting روی Core واحد | multi-tenant Cloud، subscription |
| v0.18 | Android + Cloud + Sync + Identity/Tenancy | monetization enforcement کامل |
| v0.19 | Billing/Entitlement/Quota beta | feature جدید بزرگ و redesign Core |
| v1.0 | hardening و commercial release | قابلیت آزمایشی جدید |

هر نسخه فقط وقتی شروع می‌شود که gate نسخهٔ قبل artifact و evidence معتبر داشته باشد.

## 17. Stop Conditions

مدل فقط در این موارد باید متوقف شود و blocker دقیق گزارش کند:

- baseline یا artifact نسخهٔ قبل موجود نیست/هویت آن قابل اثبات نیست؛
- migration باعث حذف غیرقابل‌بازگشت داده بدون backup/approval می‌شود؛
- secret، signing key، Store credential یا Provider انتخاب‌نشده برای gate واقعی لازم است؛
- تصمیم حقوقی/قیمت/retention/region materially architecture را تغییر می‌دهد و در پرامپت تعیین نشده؛
- platform gate فقط روی Windows/Android/Cloud واقعی ممکن است و محیط آن وجود ندارد؛
- تغییر موردنیاز خارج از scope یا ناقض قرارداد مادر است.

در Stop Condition، مدل باید کارهای امن و مستقل از blocker را کامل کند، سپس دقیقاً بگوید چه چیزی `DONE`، چه چیزی `NOT_RUN` و چه تصمیمی لازم است.
