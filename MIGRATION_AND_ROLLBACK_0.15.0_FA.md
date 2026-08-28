# مهاجرت و بازگشت Auralis 0.15.0

## سیاست داده

این نسخه Schema 10 را به‌صورت idempotent روی ledger موجود اعمال می‌کند. پیش از نخستین اجرای مهاجرت، سرور یک نسخهٔ پشتیبان از SQLite و فایل‌های همراه WAL/SHM در `data/backups/pre-v0.15.0-auralis-ledger.sqlite*` می‌سازد. دادهٔ کاربر پاک یا بازنویسی نمی‌شود.

مهاجرت، `default-profile` و `default-workspace` را در صورت نبودن ایجاد می‌کند و هر Session قدیمی را فقط یک‌بار به Conversation متناظر `conv-<session-id>` متصل می‌کند. شناسهٔ Session و Turnهای نسخه‌های قبلی ثابت می‌مانند.

## اجرای ارتقا

1. برنامهٔ قبلی را ببندید و از پوشهٔ `data` یک کپی مستقل نگه دارید.
2. نسخهٔ 0.15.0 را اجرا کنید. مهاجرت پیش از bind شدن HTTP کامل می‌شود.
3. `/v1/health`، فهرست Workspace و یک Conversation قدیمی را بررسی کنید.
4. تا پایان بررسی، پوشهٔ `data/backups` را حذف نکنید.

## Rollback به 0.14.1

1. Auralis 0.15.0 را کاملاً متوقف کنید.
2. فایل فعلی `data/auralis-ledger.sqlite` و WAL/SHM آن را به یک پوشهٔ نگهداری منتقل کنید؛ حذف نکنید.
3. سه فایل `pre-v0.15.0-auralis-ledger.sqlite*` را با نام‌های اصلی ledger برگردانید.
4. build نسخهٔ 0.14.1 را اجرا و Health، Sessionها و Transcript را بررسی کنید.

Down-migration خودکار وجود ندارد؛ این تصمیم مانع از دست‌رفتن موجودیت‌های جدید Workspace/Project/People/Task می‌شود. اگر بعداً دوباره 0.15.0 اجرا شود، مهاجرت تکراری رکورد دوگانه نمی‌سازد.
