# Recipe: State Matrix

For every major screen/component list states before polish.

| State | User Need | UI Response |
|---|---|---|
| First use | Understand what this is | Orientation + primary next step |
| Loading | Know system is working | Progress/skeleton appropriate to latency |
| Populated | Complete task | Normal hierarchy |
| Empty | Understand why empty | Explain + next action |
| Partial | Know what is missing | Preserve usable data + warning |
| Error | Recover | Specific cause/retry/fallback |
| Permission denied | Understand boundary | Explain access + path forward |
| Disabled | Understand why unavailable | Reason if not obvious |
| Pending action | Avoid duplicate action | Feedback + cancellation if possible |
| Success | Confirm completion | Clear result/next step |
| Undo | Recover reversible action | Time-bounded or contextual undo |

Not every screen needs every state. Select based on product behavior.
