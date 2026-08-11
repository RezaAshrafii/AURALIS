# راهنمای تست Windows — Auralis v0.10.2 Native Capture Validation

این build برای اثبات مرحلهٔ Capture-first ساخته شده است، نه ASR. در نتیجه در این دور مهم‌ترین سؤال این است: «آیا Mic و System Audio بدون حذف پنهانی روی دیسک ثبت و قابل حسابرسی می‌شوند؟»

## تست ۵ دقیقه‌ای سریع

1. `Auralis.vbs` را اجرا کنید.
2. Session را Start کنید.
3. Mic و System Loopback را روشن نگه دارید و Chunk را روی 5s بگذارید.
4. `شروع ضبط Native` را بزنید.
5. 60 ثانیه صحبت کنید و هم‌زمان یک فایل/ویدئو در Windows پخش کنید.
6. Capture را Stop کنید.
7. `Auralis-Audio-Verify.cmd` را اجرا کنید.

انتظار:
- هر دو channel در UI دیده شوند.
- sequence هر دو channel جلو برود.
- `chunks > 0` و `bytes > 0` باشد.
- در اجرای عادی `gaps = 0` باشد.
- verifier باید طول فایل، SHA-256 و continuity chunkهای بسته‌شده را بررسی کند.

## محل داده

`data/audio/<session-id>/`

برای هر channel پوشهٔ مستقل و `native-ledger.jsonl` وجود دارد. فایل‌های `.raw` format native endpoint را حفظ می‌کنند و WAV نیستند.

## هنگام خطا چه بفرستید

- screenshot از Component Health و Native Capture panel
- Session ID
- `data/latest-audio-verification.json`
- Diagnostics export
- اگر ممکن است `native-ledger.jsonl` همان session؛ فایل‌های raw لازم نیستند مگر برای بررسی صریح و با رضایت خودتان.

## محدودیت عمدی

این نسخه هنوز VAD/Streaming ASR ندارد. پس نبود transcript در این build خطا نیست. مرحله بعد از تأیید capture/ledger، segmentation و Streaming ASR است.
