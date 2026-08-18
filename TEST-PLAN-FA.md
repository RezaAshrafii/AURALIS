# Auralis v0.11.2 — Test Plan

## تست 1 — وضعیت سلامت
1. برنامه را اجرا کن.
2. بدون خطای runtime، Header نباید به‌صورت دائمی DEGRADED باشد.
3. اگر AI هنوز تنظیم نشده، AI READY نباید نمایش داده شود.

## تست 2 — API Key نامعتبر
1. یک کلید عمداً نادرست وارد کن.
2. «فعال‌سازی AI» را بزن.
3. انتظار: فعال‌سازی رد شود و پیام روشن درباره کلید نامعتبر/HTTP 401 یا 403 نمایش داده شود.
4. انتظار: AI READY روشن نشود.
5. انتظار: Live Transcript با کارت‌های `AUTH_REQUIRED` پر نشود.

## تست 3 — API Key معتبر
1. کلید Google AI Studio معتبر را وارد کن.
2. مدل `gemini-3.1-flash-lite` را انتخاب کن.
3. «تست Brain» و سپس «فعال‌سازی AI» را بزن.
4. انتظار: AI READY روشن شود.
5. Session را شروع کن و یک سؤال کوتاه فارسی بگو.
6. انتظار: Transcript واقعی، Turn مستقل و Answer ساخته شود.

## تست 4 — بازیابی پس از خطای Auth
1. با کلید نامعتبر چند ثانیه صحبت کن تا Raw Audio ذخیره شود.
2. کلید معتبر را وارد و AI را فعال کن.
3. انتظار: قطعه‌های ASR_FAILED قبلی مجدداً رونویسی شوند.
4. Turnهای سؤال/درخواست بدون پاسخ باید پس از فعال‌سازی معتبر Answer بگیرند.

## تست 5 — Settings UX
1. به Settings برو.
2. انتظار: cardهای سه‌گانه scrollbar داخلی مستقل نداشته باشند؛ خود صفحه در صورت نیاز scroll شود.

## Gate
- Node regression tests: 0 FAIL
- frontend:typecheck: PASS
- frontend:build: PASS
- verify: PASS
- Windows/Gemini live smoke test: نیازمند سیستم کاربر
