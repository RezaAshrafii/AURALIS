# برنامه تست Auralis v0.13.0

## 1) تست نرم‌افزاری
در PowerShell داخل پوشه Source/Portable:

```powershell
npm test
npm run frontend:typecheck
npm run frontend:build
npm run verify
```

یا یکجا:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-v013-speech-gate.ps1
```

## 2) تست fallback محلی whisper.cpp
`whisper-server` را فقط روی loopback اجرا کن. Auralis عمداً URL شبکه/LAN/اینترنت را برای fallback محلی رد می‌کند.

در Settings:
1. `Fallback محلی whisper.cpp` را روشن کن.
2. آدرس پیش‌فرض `http://127.0.0.1:8080` را نگه دار.
3. `تست whisper.cpp` را بزن.
4. `ذخیره ASR محلی` را بزن.
5. یک قطعه صوت فارسی ثبت کن و Cloud ASR را عمداً unavailable کن؛ eventهای `asr.fallback_started` و `asr.fallback_completed` باید ثبت شوند.

طبق مستند رسمی whisper.cpp، endpoint محلی inference از `multipart/form-data` و `/inference` استفاده می‌کند.

## 3) Windows audio regression
```powershell
.\RUN-V013-HARDWARE-GATE.cmd
```

## 4) معیارهای عدم قبولی
- ASR error به‌عنوان متن مکالمه ظاهر شود.
- FINAL یک segment دوبار Turn بسازد.
- local ASR بتواند به host غیر-loopback متصل شود.
- drop/gap نامشخص در hardware gate دیده شود.
- stable transcript با متن ناسازگار به عقب برگردد.
