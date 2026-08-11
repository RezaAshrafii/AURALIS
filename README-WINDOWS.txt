Auralis v0.10.4 Live Transcript Validation
==========================================

RUN
1. Extract the ZIP.
2. Double-click Auralis.vbs.
3. Open Brain tab.
4. Enter your Gemini API key in the Text Brain API Key field.
5. Click: فعال‌سازی صوت→متن + Brain
6. Return to Session.
7. Start Session.
8. For the first test keep Mic ON and System Loopback OFF.
9. Start Native capture.
10. Say one Persian sentence clearly, then stay silent for about 1 second.

EXPECTED
- Live Transcript shows the final recognized text.
- A speech segment appears even before/without an answer.
- If Auto Router marks it as question/request, a Turn card is created.
- If auto Brain is enabled, the same Turn card gets its own answer.
- Click any Turn card to inspect its exact question, answer, segment, ASR provider/model, revision and sequence range.

IMPORTANT
This is a validation build. Raw audio is captured/spooled before VAD/ASR. The final production target remains Rust + neural VAD + dedicated streaming ASR.
