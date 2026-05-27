/** LLM + validator guidance for slide-1 carousel hooks (imported by llm + validate-slides). */

export const FIRST_SLIDE_HOOK_COPY_APPENDIX = `
First-slide hook (slide with minimum \`order\` only — yellow headline on image 1; set hookStyle on this slide):

Brand voice (@sara.sendedition): a smart climbing friend diagnosing the real issue — warm, practical, confidence-first, movement-focused, beginner/intermediate-friendly, anti-shame and anti-elitist. Concrete and self-relevant at a glance. Not macho hype, not vague "you got this" inspiration, not shame hooks. Witty phrasing is welcome; the diagnosis itself must stay clear and safe.

Pick ONE hook formula for slide 1 (headline must be a complete phrase within the character cap; put mechanism, payoff, or longer template tail in \`body\`):

| Carousel goal | Formula | Template (compress for cap) |
| Diagnose a felt problem | Symptom → Cause | If your [thing] feels [symptom], this might be why |
| Bust a wrong assumption | False Culprit | It's not [obvious]. It's [actual] |
| Nuanced myth bust | Contrarian Upgrade | [Common advice] sounds smart. [Better] works better |
| One cue / quick win | Tiny Tweak Big Payoff | This one [change] makes [result] easier |
| Confidence / mindset | Confidence Identity | [Trait] climbers aren't [luck]. They're [trained behavior] |
| Saveable education | Mistakes list | [X] mistakes costing you [outcome] (or softer "patterns" wording) |
| Self-coaching checklist | Checklist Diagnostic | If [symptom], check these [2–4] things |
| Before more effort | Before You Try Harder | Before you [effort], check [lever] |
| Habit swap | Stop This Try This | Stop [habit]. Try [better] instead |
| Plateau / grade stall | Plateau Decoder | Stuck at [grade/result]? Start here |
| Beginner on-ramp | Starting Point | Starting [goal]? Do this first |
| Story / belief shift | Confession Pivot | I used to think [belief]. I was wrong about [thing] |
| Community reminder | Friendly PSA | Friendly PSA for climbers who [behavior] |
| Deeper nuance | Hidden Part | The part nobody tells you about [topic] |

Highest-fit families for this account (when transcript fits): Symptom → Cause, False Culprit, Mistakes/patterns lists, Confidence Identity, Tiny Tweak Big Payoff.

hookStyle mapping (slide 1): shared_experience → Symptom → Cause, Friendly PSA; gentle_reframe → False Culprit, Contrarian Upgrade; patterns → Mistakes list, Checklist; guidance → Tiny Tweak, Stop/Try, Before You Try Harder, Starting Point; realization → Confidence Identity, Confession Pivot, Hidden Part.

Slide-1 writing rules:
- Lead with a **felt symptom** or **named frustration**, not an abstract topic ("Footwork tips" is weak; "If your feet keep slipping" is strong).
- **One idea** on slide 1; if two claims compete, split into another carousel.
- Promise one payoff (diagnose, fix, reframe, or simplify); slide 2 should reward the hook immediately.
- Prefer "If your…" or "Climbers who…" over accusatory "you're doing X wrong."
- **Catchy** = one sharp beat: specific problem, question, or contrast — not a slow setup.
- Never write a headline longer than the cap expecting truncation.

Sara-style headline seeds (shorten to fit cap; adapt to transcript facts):
- "If your feet keep slipping" / "Climbing feels stop-and-go?"
- "It's not your grip." / "Not a strength issue?"
- "Calm isn't luck. It's trained."
- "Stuck at V3? Start here."
- "Stop pulling. Try hips first."
- "7 mistakes stealing sends" → shorten or move count to \`body\` if over cap.

Avoid on slide 1:
- Gerund openers ("Reaching for…", "Going for…", "Trying to…") and vague motion ("working on", "adjusting") — put mechanism in \`body\`.
- Abstract category hooks ("Movement tips", "Project advice"), cryptic poetry, vague inspiration with no climbing payoff, macho flex, shame framing.
`.trim();

/** Weak openers that often produce bland first-slide hooks (slide 1 only). */
export const WEAK_FIRST_HOOK_OPENERS: { pattern: RegExp; label: string }[] = [
  {
    pattern: /^reaching for\b/i,
    label:
      "gerund setup 'Reaching for…' — open with a sharp question or problem snap instead",
  },
  {
    pattern: /^going for\b/i,
    label:
      "gerund setup 'Going for…' — open with a sharp question or problem snap instead",
  },
  {
    pattern: /^trying to\b/i,
    label:
      "gerund setup 'Trying to…' — open with a sharp question or problem snap instead",
  },
  {
    pattern: /^working on\b/i,
    label:
      "vague setup 'Working on…' — name the specific problem or question in the headline",
  },
  {
    pattern: /^(footwork|climbing|movement|technique|training|project)\s+tips\b/i,
    label:
      "abstract topic label — lead with a felt symptom or named frustration, not a category",
  },
  {
    pattern: /^you(?:'re| are)\s+(doing|getting|making)\b/i,
    label:
      "accusatory 'you're doing…' — use shared experience or gentle reframe instead",
  },
  {
    pattern: /^(level up|unlock your|transform your|master your)\b/i,
    label:
      "generic motivation — promise a specific climbing payoff (diagnose, fix, reframe)",
  },
];
