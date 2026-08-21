# گزارش ممیزی و اصلاح معماری Auralis v0.13.0

## نتیجه

معماری اولیه کاملاً غلط نبود. مرزبندی Rust در بخش‌های domain، audio، storage، VAD و ASR مناسب بود، اما لایهٔ برنامه چند نقص ساختاری و انتشار داشت و برای توسعهٔ مطمئن آماده نبود. این نسخه baseline را بدون تغییر قرارداد محصول سخت‌سازی می‌کند.

## یافته‌های قطعی و اصلاح انجام‌شده

| شدت | یافته | اصلاح |
| --- | --- | --- |
| بحرانی | فایل checksum مربوط به `Auralis_v0.14.0_Intelligence_Layer_Source.zip` است، ولی سورس تحویلی `v0.13.0` است. زنجیرهٔ منشأ قابل تأیید نبود. | mismatch ثبت شد؛ برای خروجی اصلاح‌شده checksum تازه از همان ZIP نهایی تولید می‌شود. |
| زیاد | نسخه در چند فایل تکرار شده و server آن را hard-code می‌کرد. | server نسخه را از `VERSION` می‌خواند و verify تطابق npm workspace، UI metadata و Cargo را کنترل می‌کند. |
| زیاد | `server.mjs` مرز HTTP، config، امنیت و background task را در God Module ادغام کرده بود. | `runtime/config.mjs`، `runtime/http-boundary.mjs` و `runtime/task-supervisor.mjs` استخراج و در composition root تزریق شدند. |
| زیاد | JSON نامعتبر بی‌صدا به `{}` تبدیل می‌شد و سقف ورودی پیش از parse اعمال نمی‌شد. | parser مرکزی با خطاهای 400/413/415، UTF-8 سخت‌گیرانه و سقف byte اضافه شد. |
| زیاد | token با مقایسهٔ رشته‌ای عادی بررسی می‌شد و bootstrap کنترل cross-site صریح نداشت. | token با `timingSafeEqual` مقایسه می‌شود؛ Host، Origin و `Sec-Fetch-Site` در یک guard واحد کنترل می‌شوند. |
| زیاد | promiseهای پس‌زمینه پراکنده بودند و shutdown منتظر آن‌ها نمی‌ماند. | task supervisor مرکزی، ثبت خطای پایدار و shutdown مرحله‌ای اضافه شد. |
| متوسط | migrationهای application با `catch {}` خطاهای واقعی SQLite را پنهان می‌کردند. | وجود ستون با `PRAGMA table_info` بررسی می‌شود و خطاهای migration دیگر بلعیده نمی‌شوند. |
| متوسط | UI واقعی در `app/` بود، ولی ساختار workspace ادعا می‌کرد web app در `apps/web` است. | تمام runtime assets به `apps/web/public` منتقل و server/build/tests به مسیر واقعی متصل شدند. |
| متوسط | build metadata با timestamp جاری، خروجی را غیرقابل‌بازتولید می‌کرد. | build پیش‌فرض deterministic شد؛ timestamp فقط با `SOURCE_DATE_EPOCH` ثبت می‌شود. |
| متوسط | reducer تایپ‌شده state و Mapها را درجا mutate می‌کرد. | reducer immutable شد و فقط برای event مؤثر state تازه می‌سازد. |
| کم | وابستگی‌های React/Vite در npm نصب می‌شدند، در حالی که runtime از React vendored استفاده می‌کند و Vite اجرا نمی‌شود. | وابستگی‌های بلااستفاده حذف شد؛ فقط TypeScript موردنیاز type-check باقی ماند. |
| کم | `apps/web/public/version.json` هنوز نام milestone نسخه 0.12 را داشت. | نام milestone به `Speech Engine Reliability` اصلاح شد. |

## بدهی معماریِ کنترل‌شده

`server.mjs` هنوز orchestration، repositoryهای application، provider adapters و route handlers را در یک فایل نگه می‌دارد. شکستن یک‌بارهٔ آن در این release ریسک regression در capture/ASR را بالا می‌برد. قانون افزوده‌شده این است که منطق دامنهٔ جدید وارد server نشود. مرحلهٔ بعدی باید به‌ترتیب repository، provider adapters، application services و route modules را با contract test استخراج کند.

## محدودیت اعتبارسنجی این محیط

Node tests، syntax check، TypeScript و build در این محیط قابل اجرا هستند. Rust toolchain، Bun runtime و سخت‌افزار Windows/WASAPI موجود نیستند؛ بنابراین ادعای عبور Rust/Windows hardware gates مجاز نیست و این gateها fail-closed باقی می‌مانند.

