# گزارش تاریخی Audit v0.11.2 — Runtime/Auth Stabilization

این فایل سابقهٔ ممیزی نسخهٔ 0.11.2 است. گزارش معماری جاری در `ARCHITECTURE_AUDIT_FA.md` قرار دارد.

بررسی تصاویر کاربر دو failure واقعی را نشان داد:

1. Header همیشه `DEGRADED` بود. علت در `health()` قطعی بود: هر دو شاخه شرط `degraded` برمی‌گرداندند.
2. UI می‌توانست `AI READY` نشان دهد در حالی که credential واقعاً توسط Provider پذیرفته نشده بود. Quick Setup قبل از اعتبارسنجی upstream runtime را enabled می‌کرد.
3. خطای 401/403 در Brain به پیام عمومی «پاسخ معتبر HTTP ندارد» تبدیل می‌شد و علت واقعی پنهان بود.
4. failureهای ASR مثل `AUTH_REQUIRED` در Live Transcript به‌عنوان محتوای مکالمه تکرار می‌شدند.

v0.11.2 provider preflight، state صریح credential، error mapping، backfill jobs و Live Transcript filtering را اضافه می‌کند. Capture-first و هسته فعلی محصول تغییر معماری نداده‌اند.

نکته: اگر Provider پس از این patch همچنان HTTP 401/403 برگرداند، مشکل credential/permission بیرونی است و نرم‌افزار آن را صریح گزارش می‌کند؛ برنامه نمی‌تواند یک کلید ردشده را معتبر کند.
