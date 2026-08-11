# راهنمای تست v0.10.4 — متن صدا

این نسخه برای اولین بار متن نهایی هر Segment را مستقیماً در صفحه Session قابل مشاهده می‌کند.

## راه‌اندازی سریع
1. تب Brain را باز کن.
2. API Key را در فیلد Gemini Text Brain وارد کن.
3. روی **فعال‌سازی صوت→متن + Brain** بزن.
4. به Session برگرد.
5. Mic را روشن و System Loopback را برای تست اول خاموش کن.
6. Native Capture را شروع کن.
7. یک جمله بگو و حدود یک ثانیه مکث کن.

## چه چیزی باید ببینی؟
در بخش Live Transcript:
- FROZEN: صوت Segment شده و روی دیسک وجود دارد.
- RUNNING: ASR در حال پردازش است.
- FINAL: متن نهایی ثبت شده است.
- FAILED: خطای ASR ثبت شده و باید در Diagnostics قابل مشاهده باشد.

پس از FINAL، Router متن را به question/request/statement تبدیل می‌کند. اگر question/request باشد Turn ساخته می‌شود و در صورت فعال بودن Brain پاسخ همان Turn تولید می‌شود.

## نکته معماری
Gemini Audio در این build فقط adapter آزمایشی segment-final است تا Audio→Text روی سیستم واقعی قابل تست باشد. مطابق معماری اصلی، مسیر production باید به ASR تخصصی streaming و neural VAD منتقل شود.
