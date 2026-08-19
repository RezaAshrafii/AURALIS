# برنامه تست Auralis v0.12.0

## 1. Regression نرم‌افزاری
در Source:

```powershell
npm test
npm run verify
```

باید صفر failure فعال داشته باشد.

## 2. Build Rust روی Windows

```powershell
BUILD-V012-RUST-CORE.cmd
```

یا:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-v012-windows-test.ps1
```

## 3. Quick Hardware Gate

```powershell
RUN-V012-QUICK-HARDWARE-GATE.cmd
```

این تست سه run می‌گیرد: Mic 60s، Loopback 60s، Both 120s.
در Loopback/Both باید صدای سیستم پخش شود؛ در Mic/Both باید صحبت کنی.

## 4. 20-minute Gate

```powershell
RUN-V012-20MIN-HARDWARE-GATE.cmd
```

شرط اصلی: queue loss صفر و unknown gap صفر.

## 5. محصول تعاملی
`Auralis.vbs` یا `Auralis-Start.cmd` را اجرا کن. مسیر تعاملی فعلی باید بدون regression کار کند: Mic → Transcript → Turn → Auto Answer.

## گزارش موردنیاز
برای تأیید v0.12 hardware gate این موارد کافی‌اند و لازم نیست Raw Audio خصوصی ارسال شود:
- `capture-summary.json`
- `logs\capture.log`
- `session-state.json`
- SHA-256 فایل `audio-ledger.sqlite`
- screenshot حافظه Task Manager ابتدای/انتهای تست 20 دقیقه‌ای
