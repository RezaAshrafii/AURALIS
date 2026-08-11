Auralis v0.10.5 Audio Path Hardening Validation
===============================================

Run:
  Auralis.vbs

Local UI:
  http://127.0.0.1:47827

What this build is for
----------------------
This build fixes the concrete Audio -> VAD break found in v0.10.4 on common Windows WAVEFORMATEXTENSIBLE / 48kHz / stereo float devices, and reduces UI/startup polling overhead.

Fast test
---------
1. Open Brain.
2. Enter the Gemini AI Studio API key.
3. Press "فعال‌سازی صوت→متن + Brain".
4. Return to Session.
5. For the first test: Mic ON, System Loopback OFF.
6. Start Session and Native Capture.
7. Speak clearly: "واریانس در مدل رگرسیون چیست؟"
8. Pause for about 1–2 seconds.

Expected evidence
-----------------
Native Capture should show something similar to:
  user-mic 48000 Hz · 2 ch · float32
  RMS > threshold while speaking
  voice YES

Then Live Transcript should show a FINAL transcript and a selectable Turn card should appear.

If no transcript appears
------------------------
- If encoding is unknown / DECODE_FAILED: keep a screenshot and Diagnostics JSON.
- If RMS stays near zero while seq increases: device/capture data needs inspection.
- If RMS rises and voice=YES but no Segment appears: segmentation is the fault.
- If Segment appears but ASR fails: provider/API path is the fault.

The API key is not stored in localStorage. This validation build still uses the bundled Bun runtime for the local UI/server. The production core target remains Rust as required by the v0.10 architecture document.
