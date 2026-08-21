# شاخص معماری و اجرای مسیر محصول AURALIS

## جایگاه فعلی

Baseline اصلاح‌شده:

```text
v0.14.1 = Conversation Intelligence + Windows Product Audio Bridge Hotfix
```

این patch مشکل false-LIVE و نبود مسیر واقعی native chunk تا ASR را اصلاح می‌کند، اما neural VAD را ادعا نمی‌کند. قبل از توسعهٔ محصول، Windows bridge gate باید روی سخت‌افزار واقعی اجرا شود.

## ترتیب استفاده از اسناد

برای هر نسخه به مدل اجرایی دقیقاً این دو فایل را بده:

1. `00_AURALIS_MASTER_ARCHITECTURE_AND_EXECUTION_CONTRACT_FA.md`
2. فایل نسخهٔ هدف

مدل نباید هم‌زمان چند نسخه را پیاده کند.

| مرحله | فایل اجرایی | Gate ورودی | خروجی اصلی |
| --- | --- | --- | --- |
| v0.15.0 | `v0.15.0_PRODUCT_EXPERIENCE_IMPLEMENTATION_PROMPT_FA.md` | v0.14.1 Audio/Intelligence | Workspace، Conversation Hub، Action Center |
| v0.16.0 | `v0.16.0_PERSONAL_MEMORY_ENGINE_IMPLEMENTATION_PROMPT_FA.md` | v0.15 Product UX | Memory با provenance/control |
| v0.17.0 | `v0.17.0_DOMAIN_PRODUCT_LAYER_IMPLEMENTATION_PROMPT_FA.md` | v0.16 Memory | CRM، Assistant، Meeting روی Core واحد |
| v0.18.0 | `v0.18.0_MOBILE_CLOUD_PLATFORM_IMPLEMENTATION_PROMPT_FA.md` | v0.17 Domain Products | Android، Cloud، Identity، Sync |
| v0.19.0 | `v0.19.0_MONETIZATION_BETA_IMPLEMENTATION_PROMPT_FA.md` | v0.18 Usage/Tenancy | Billing، Entitlement، Quota beta |
| v1.0.0 | `v1.0.0_COMMERCIAL_RELEASE_IMPLEMENTATION_PROMPT_FA.md` | v0.19 Monetization | hardening، stores، docs، support، launch |

## مدل همکاری پیشنهادی

```text
معمار اصلی
  -> scope/contract/gates
مدل اجرایی
  -> inspect/design/implementation/tests/evidence
معمار اصلی
  -> diff/schema/security/product review
مدل اجرایی
  -> fixes only
معمار اصلی
  -> release decision
```

برای review هر نسخه، بستهٔ کامل source + migration + test evidence + artifact checksum را بده؛ screenshot یا changelog به‌تنهایی برای تأیید نسخه کافی نیست.

## قواعد عبور

- اگر gate نسخهٔ قبل fail است، نسخهٔ بعد شروع نشود.
- feature نسخهٔ بعد وارد نسخهٔ فعلی نشود.
- platform gate اجرا نشده `NOT_RUN` است.
- AI output بدون schema/evidence canonical نیست.
- UI state بدون backend/native truth موفق نیست.
- migration بدون backup/restore evidence release نمی‌شود.
- هر نسخه artifact و SHA-256 مستقل دارد.

## North Star

```text
AURALIS = The operating system for human conversations
```

مزیت دفاع‌پذیر:

```text
Audio Evidence
+ Conversation Intelligence
+ Personal Context
+ Action Extraction
+ Persistent User-Controlled Memory
```

Provider و مدل قابل تعویض‌اند؛ lineage، workflow، memory و اعتماد کاربر دارایی محصول هستند.
