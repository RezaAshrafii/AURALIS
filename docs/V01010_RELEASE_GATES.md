# Auralis v0.10.11 — UI and answer-flow release gates

These gates define the current product behavior. Future builds must not change the Session UI structure or answer workflow unless a new requirement explicitly asks for it.

## Locked UI behavior

- Keep the current React Session/Sources/Settings/System shell and current visual language.
- Do not replace the Session workspace with another layout or framework migration without an explicit requirement.
- Current Session, processing cycle, transcript, Turn cards, and inspector must never overlap.
- The session rail must not require its own nested scrollbar at 1920×1080, 1440×900, 1366×768, or 1024×768.
- At medium widths the three rail cards move into one full-width row; at small widths they stack vertically.
- Low-level queue/RMS/sequence/chunk telemetry remains in System/technical views.

## Locked answer behavior

- `autoAnswer` defaults to true.
- An eligible audio or manual question/request is queued for an answer automatically when AI is enabled.
- Card selection is read-only with respect to the model: selecting a card must not trigger a provider call.
- Once an answer exists, selecting that card immediately displays the stored answer.
- Inspector follows the latest answerable Turn automatically until the user explicitly pins a historical Turn.
- `Z` manually answers/displays the selected answerable Turn; if none is selected it targets the latest answerable Turn.
- `Z` is ignored while typing in editable controls.
- Background and manual requests use the same answer idempotency key.

## Mode ownership rules

- Study: user/mic and manual question/request Turns auto-answer.
- Oral Copilot: system/opponent question/request Turns auto-answer; user/mic speech does not auto-answer.
- Meeting: question/request Turns from either side can auto-answer.
- Mock Exam: user speech does not auto-answer by policy; `Z` remains a deliberate manual override.

## Regression blockers

A release is blocked if any of these occur:

- Answer generation requires clicking a Turn card.
- Selecting a Turn causes a second provider request.
- A new answer appears under the wrong Turn.
- `Z` fires while the user is typing.
- The right-side live rail overlaps or clips its History/processing cards.
- The main conversation workspace gains technical telemetry or nested diagnostic scroll areas.


## v0.10.11 additional gates
- At desktop widths above 1500px, Current Session / Live Cycle / History MUST use the full-width top rail and MUST NOT revert to the legacy 270px sidebar.
- Rail cards MUST clip their own content; pipeline/history content MUST NOT paint outside card bounds.
- Oral Copilot with System Audio enabled: system questions auto-answer, mic turns do not.
- Oral Copilot with System Audio disabled: mic questions/requests auto-answer by default.
- Manual Z remains an override and must not be required for the default mic-only flow.
