# راهنمای تست v0.10.5 — Audio -> Text

در Session بعد از شروع Capture باید در بخش Native Capture این اطلاعات را ببینی:
- encoding
- RMS
- threshold
- voice

اگر هنگام صحبت RMS بالا می‌رود و voice=YES می‌شود، VAD باید Segment بسازد. بعد از مکث، Live Transcript باید متن Final را نمایش دهد.

تست پایه:
«واریانس در مدل رگرسیون چیست؟»

اگر متن نیامد، Diagnostics را Export کن و وضعیت encoding/RMS/threshold/segment/asr را نگه دار. این نسخه دیگر decode نامعتبر را ساکت رد نمی‌کند و DECODE_FAILED را نشان می‌دهد.
