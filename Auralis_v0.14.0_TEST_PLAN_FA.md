# برنامهٔ تست Auralis v0.14.1

## ۱. هوش Turn

- سؤال مستقل، درخواست، statement و continuation فارسی را بررسی کن.
- continuation باید به آخرین Turn قابل‌پاسخ متصل شود؛ مرجع بدون والد باید `ambiguous=true` بماند.
- intent، confidence، topic و retrieval query پس از restart از ledger قابل بازیابی باشند.

## ۲. منبع و RAG

- فایل‌های TXT/Markdown/CSV/JSON تا سقف ۸ MB وارد شوند.
- chunkها offset دقیق، overlap قطعی، SHA و ordinal پایدار داشته باشند.
- ورود محتوای یکسان deduplicate شود.
- نسخهٔ جدید با عنوان یکسان نسخهٔ قبلی را `SUPERSEDED` کند؛ حذف باید `DELETED` و غیرمخرب باشد.
- retrieval فقط source فعال را ببیند و رتبه، coverage، matched terms و run ID را ثبت کند.

## ۳. citation

- chunk ناشناخته، quote خالی، quote ساختگی و citation تکراری رد شوند.
- تفاوت نویسه‌های فارسی/عربی پس از normalization معتبر بماند.
- پاسخ `source` یا `mixed` بدون citation معتبر به `grounding_unverified` تنزل کند.
- benchmark committed باید precision و quote coverage برابر ۱٫۰۰ داشته باشد.

## ۴. رگرشن

- capture-first، spool، gap ledger، ASR retry/retranscribe، immutable segment، Turn ownership و idempotency پاسخ بدون تغییر پاس شوند.
- UI اصلی بازطراحی نشود؛ Intelligence فقط در Inspector و Sources افزوده شود.
- TypeScript، build قطعی و تمام تست‌های v0.10–v0.13 بدون failure پاس شوند.

## ۵. مرز محیط

- تست Rust/Clippy و WASAPI فقط روی Windows با toolchain و سخت‌افزار واقعی معتبر است.
- نبود hardware gate نباید به‌عنوان PASS گزارش شود.
