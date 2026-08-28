# شواهد آزمون Auralis 0.15.0

تاریخ اجرا: 2026-08-23 — Windows — Node 24 / Bun runtime / Rust stable

## گیت‌های خودکار

| گیت | نتیجه | شاهد |
|---|---:|---|
| `npm run verify` | PASS | 135 آزمون: 124 پاس، 0 شکست، 11 مورد Portable-only با دلیل صریح Skip؛ benchmark استناد و build وب نیز PASS |
| `cargo test --manifest-path native/Cargo.toml --workspace --locked` | PASS | 46 آزمون Rust شامل unit، bin و sequence contract؛ 0 شکست |
| `npm run intelligence:benchmark` | PASS | دقت استناد 1.0، پوشش quote برابر 1.0، retrieval PASS |
| `npm run v015:benchmark` | PASS | Dashboard p95 = 6.243ms؛ Search p95 = 205.172ms |
| `BUILD-V014-PRODUCT-BRIDGE.cmd` | PASS | bridge نسخهٔ 0.15.0 ساخته و SHA256 ثبت شد |
| `RUN-V014-PRODUCT-BRIDGE-GATE.cmd` | PASS | 5 chunk، 32 event، صفر dropped buffer، صفر gap و صفر unknown gap |
| `npm run frontend:typecheck` | PASS | TypeScript بدون خطا |
| `npm run frontend:build` | PASS | `dist/web` به‌صورت deterministic ساخته شد |

## آزمون محصول در مرورگر واقعی

آزمون در Browser داخلی روی runtime واقعی Auralis و provider کنترل‌شدهٔ loopback انجام شد؛ seam مربوط به provider فقط با `NODE_ENV=test` و URL loopback فعال می‌شود و در production قابل استفاده نیست.

- ایجاد Project با نام «پروژه تست رابط»: PASS
- ایجاد Person با نام «کاربر تست»: PASS
- ایجاد Task با نام «تسک تست رابط»: PASS
- تغییر Task به `IN_PROGRESS`: PASS
- شروع Session فقط پس از اعلام آمادگی bridge واقعی: PASS
- ثبت سؤال دستی «لطفاً نتیجه این تست را بگو؟»: PASS
- دریافت پاسخ Brain و اتصال آن به Turn درست: PASS
- استخراج Insight از همان Conversation در تب Understanding: PASS
- دسترسی فرم سؤال در نخستین Turn (بدون قفل zero-state): PASS
- تم روشن و تاریک: PASS
- عرض 320×740: همهٔ 7 بخش قابل دسترس، `scrollWidth <= innerWidth`: PASS
- خطا/هشدار Console در سناریوی اصلی: 0

## حدود ادعا

- تماس با Gemini عمومی با API Key واقعی: `NOT_RUN`؛ به‌جای آن E2E قطعی با provider محلی کنترل‌شده اجرا شد. مسیر production همچنان فقط endpoint رسمی Gemini را قبول می‌کند.
- آزمون soak بیست‌دقیقه‌ای، loopback-only و capture هم‌زمان mic+loopback در این نوبت: `NOT_RUN`؛ suite و فرمان‌های آن موجودند. گیت mic دوازده‌ثانیه‌ای روی سخت‌افزار واقعی پاک اجرا شد.
- فایل صوتی خام و دیتابیس runtime داخل بستهٔ تحویل قرار نگرفته‌اند.
