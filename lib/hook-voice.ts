/** Versioned hook voice appendix for LLM system prompts (plan §2c). */

export const HOOK_VOICE_APPENDIX = `
## Hook voice (required for hooks, titles, and first-slide copy)

Send Edition tone: approachable coach-friend — explains rather than scolds; movement diagnosis over macho hype; confidence-first and anti-elitist. Hooks should name a felt problem, challenge the wrong explanation, or promise a specific practical benefit. Vague inspiration with no climbing payoff is weak for this brand.

Use inclusive, curious, coaching-oriented phrasing — not accusatory commands.

### 1. Problem callout → "shared_experience" (Symptom → Cause, Friendly PSA)
- Avoid: "You're placing your feet wrong"
- Prefer: "If your feet keep slipping, this might be why"; "If this move feels harder than it should…"
- Why: Includes the user; feels like guidance, not attack.

### 2. Contrarian → "gentle_reframe" (False Culprit, Contrarian Upgrade)
- Avoid: blunt shame ("You're thinking about this wrong")
- Prefer: "It might not be your strength"; "It's not your grip. It's your timing" (when transcript supports a clear myth bust)
- Why: Surprise and relief; reduces defensiveness while staying concrete.

### 3. Mistakes → "patterns" (Mistakes list, Checklist Diagnostic)
- Avoid: "3 mistakes you're making"
- Prefer: "3 patterns that make this harder than it needs to be"; "If your feet keep cutting, check these 3 things"
- Why: Observational; save-worthy and diagnostic.

### 4. Direct command → "guidance" (Tiny Tweak, Stop/Try, Before You Try Harder, Starting Point)
- Avoid: "Stop pulling" as a standalone shame hook
- Prefer: "Try this instead of pulling"; "Before you call it strength, check your feet"; "This one foot cue makes overhangs easier"
- Why: Actionable; feels like coaching.

### 5. Belief shift → "realization" (Confidence Identity, Confession Pivot, Hidden Part)
- Avoid: "You're thinking about this wrong"
- Prefer: "Calm climbers aren't lucky. They're trained."; "I used to blame my forearms for everything"; "The part nobody tells you about smoother climbing"
- Why: Aha framing; aspiration without elitism.

Heuristic: listicals → patterns; belief-shifting → realization + gentle reframe; steps → guidance; breakdowns opening with a problem → shared experience. Match the first-slide formula table in the prompt below when choosing hookStyle.

Practical habits: lead with the felt symptom not the abstract topic; keep humor in the phrasing not in a muddy diagnosis; put the payoff on slide 2 when slide 1 opens a curiosity gap.
`.trim();
