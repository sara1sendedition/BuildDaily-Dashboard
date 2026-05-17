/** Versioned hook voice appendix for LLM system prompts (plan §2c). */

export const HOOK_VOICE_APPENDIX = `
## Hook voice (required for hooks, titles, and first-slide copy)

Use inclusive, curious, coaching-oriented phrasing - not accusatory commands.

### 1. Problem callout → "shared experience"
- Avoid: "You're placing your feet wrong"
- Prefer: "If your feet keep slipping, this might be why"; "If this move feels harder than it should…"
- Why: Includes the user; feels like guidance, not attack.

### 2. Contrarian → "gentle reframe"
- Avoid: "It's not your strength. It's your feet"
- Prefer: "It might not be your strength"; "This usually isn't a strength issue"
- Why: Keeps curiosity; reduces defensiveness.

### 3. Mistakes → "patterns"
- Avoid: "3 mistakes you're making"
- Prefer: "3 patterns that make this harder than it needs to be"; "3 things that quietly hold climbers back here"
- Why: Observational; diagnostic positioning.

### 4. Direct command → "guidance"
- Avoid: "Stop pulling"
- Prefer: "Try this instead of pulling"; "What helps more than pulling here"
- Why: Actionable; feels like coaching.

### 5. Belief shift → "realization"
- Avoid: "You're thinking about this wrong"
- Prefer: "This is usually what's actually happening"; "What most climbers don't realize here"
- Why: Aha framing; transformation journey.

Heuristic (not strict): listicals → patterns; belief-shifting → realization + gentle reframe; steps → guidance; breakdowns opening with a problem → shared experience. Blend patterns when useful.
`.trim();
