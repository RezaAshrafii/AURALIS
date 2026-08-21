# انتشار AURALIS v0.13.0 روی GitHub

Repository:
`https://github.com/RezaAshrafii/AURALIS.git`

## روش پیشنهادی — یک دستور
Source ZIP را Extract کن، PowerShell را داخل پوشه Source باز کن و اجرا کن:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\PUBLISH-V013-GITHUB.ps1
```

اسکریپت قبل از هر تغییر این موارد را چک می‌کند:
- مسیر `AURALIS-FIX` واقعاً Git repo باشد.
- remote دقیقاً repo اصلی AURALIS باشد.
- working tree تمیز باشد.
- `main` با `origin/main` fast-forward شود.
- tag `v0.13.0` از قبل وجود نداشته باشد.
- تست و verify قبل از commit پاس شوند.

Commit نهایی:
`release: AURALIS v0.13.0 speech engine reliability`

Tag:
`v0.13.0`

## ساخت GitHub Release با gh CLI
بعد از push و وقتی ZIPهای Source و Portable در Downloads هستند:

```powershell
$src="$env:USERPROFILE\Downloads\Auralis_v0.13.0_Speech_Engine_Reliability_Source.zip"
$portable="$env:USERPROFILE\Downloads\Auralis_v0.13.0_Speech_Engine_Reliability_Windows_x64_Portable.zip"

gh release create v0.13.0 $src $portable `
  --repo RezaAshrafii/AURALIS `
  --title "AURALIS v0.13.0 — Speech Engine Reliability" `
  --notes "Transcript revision protocol, loopback-only whisper.cpp fallback, neural-VAD contracts, durable speech ledger, and v0.12 audio-core regressions preserved."
```

اگر `gh` نصب یا login نشده است، tag روی GitHub باقی می‌ماند و می‌توان Release را از صفحه Releases با همان tag ساخت و دو ZIP را به‌عنوان asset آپلود کرد.
