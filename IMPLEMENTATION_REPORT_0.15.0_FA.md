# گزارش اصلاح Auralis 0.15.0

## تصمیم پایه

اسناد پیوست به‌عنوان قرارداد معماری و معیار پذیرش خوانده شدند، نه به‌عنوان درخواست مستقل. درخواست کاربر، اصلاح نسخهٔ 15 و آماده‌سازی پایهٔ نسخهٔ 16 بود.

مقایسهٔ دو source نشان داد آرشیو 0.15 اولیه فقط 170 فایل و حدود 1.34MB کد داشت، در حالی‌که 0.14.1 دارای 201 فایل و حدود 4.16MB بود. نسخهٔ 15 اولیه Intelligence، retrieval/citation، تست‌ها و bridge واقعی 0.14 را حذف کرده و capture نمایشی با telemetry تصادفی جایگزین کرده بود. بنابراین مطابق قرارداد، 0.14.1 به‌عنوان baseline انتخاب شد و لایهٔ محصول 0.15 روی آن ادغام گردید.

## اصلاحات اصلی

- `server.mjs`: حفظ runtime امن Bun و کل مسیر واقعی audio → transcript → turn → answer؛ افزودن Schema 10 و routeهای محصول؛ backup پیش از مهاجرت؛ ساخت فوری Conversation متناظر Session؛ اعلام LIVE فقط پس از آمادگی protocol bridge.
- `api/product-routes.mjs`: mutationها پشت state-auth، parser مشترک و محدود JSON، مدیریت خطای یکدست.
- `core/*`: Workspace، Project، People، Conversation، Understanding، Task، Dashboard و FTS5 Search با مدل دادهٔ Schema 10.
- `ui-kit.js`: احترام به `type="submit"`؛ علت مستقیم کارنکردن فرم‌های Project/Person/Task رفع شد.
- `app-react.js`: انتخاب Workspace پایدار، mapping صحیح camelCase، فرم‌های عملیاتی، composer قابل استفاده از Turn اول، پاسخ Brain، Understanding run و تأیید/رد Insight، نگه‌داشتن intelligence/citation inspector نسخهٔ 0.14.1.
- `styles.css`: Conversation Hub چهارردیفه و responsive واقعی؛ navigation در موبایل wrap می‌شود و overflow افقی ندارد.
- `runtime/config.mjs`: endpoint production همچنان رسمی و ثابت است؛ provider آزمون فقط در محیط test و فقط روی loopback مجاز است.
- Rust persistence: marker معمول discontinuity روی نخستین packet WASAPI دیگر به‌اشتباه Gap ناشناخته ثبت نمی‌شود؛ discontinuityهای بعدی همچنان fail-visible و durable باقی می‌مانند.
- Windows scripts: محاسبهٔ SHA256 با API استاندارد .NET تا روی Windows PowerShell موجود در سیستم هم build/gate اجرا شود.

## نگاشت معماری

| لایه | ماژول مالک | مصرف‌کننده |
|---|---|---|
| Capture truth | `native/core`, bridge JSONL | `server.mjs`، ledger و ASR |
| Transcript/Turn/Answer | baseline 0.14 server + contracts | Conversation Hub و Inspector |
| Product data | `schema-v10.mjs` و serviceهای `core` | routeهای `/v1` و UI |
| Understanding/Evidence | `understanding-engine.mjs` | Insight UI و تبدیل اتمیک Task |
| Retrieval/Citation | Intelligence 0.14 + FTS5 product search | Brain، Inspector و Search |
| Security/Runtime | `runtime/config.mjs` و request guard | همهٔ mutationها و providerها |

## وضعیت معیارهای کلیدی

- افزودن Project/Person/Task: اصلاح و E2E PASS.
- شروع/پایان Session و capture واقعی: اصلاح و bridge gate PASS.
- ثبت ورودی و پاسخ مدل: اصلاح و E2E PASS با provider قطعی loopback.
- Transcript archive گیرکرده روی EMPTY/processing: UI دیگر placeholder جعلی تولید نمی‌کند؛ فقط revisionهای واقعی نمایش داده می‌شوند.
- Understanding و اقدام قابل تأیید: API، تست و UI عملیاتی.
- مهاجرت/rollback: مستند و backup قبل از Schema 10.
- performance budget و pagination: PASS؛ Conversation Hub از endpointهای limitدار استفاده می‌کند.
- آماده‌سازی نسخهٔ 16: baseline Intelligence/Audio حذف نشده و گیت‌ها دوباره first-class هستند.

جزئیات عددی در `TEST_EVIDENCE_0.15.0_FA.md` و روش بازگشت در `MIGRATION_AND_ROLLBACK_0.15.0_FA.md` آمده است.
