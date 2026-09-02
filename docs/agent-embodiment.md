# Giving the agent a body

**Status:** channel 1 built. Written and implemented 2026-09-02.

Today the only way to know what the agent is doing is to read. A spinner, a tool name, and whatever
the model chose to narrate. The live browser view changed that for one tool, and the reaction to it
is the whole reason for this document: showing the thing beat describing it, immediately and
without argument.

This asks whether that generalises. Not "more status text" — a body. Something you read the way you
read a person holding a phone to their ear.

## Why that example works

A phone at an ear needs no caption. Pull it apart and there are three things happening at once:

- **A recognisable object.** You know what a phone is before you see who is holding it.
- **A relationship between body and object.** Not "phone" — *phone at ear*. The posture is the verb.
- **It persists.** It stays true while the call lasts. You can look away and look back.

And a fourth, easy to miss: you read it **peripherally**. Nobody studies a person to work out they
are on the phone. It arrives without attention being spent.

Text fails all four. A log line is not an object, has no posture, scrolls away, and costs a read.

## What the agent actually does

Grounding this in real turns rather than imagination. From the sessions in this instance:

```
list_files → read_file ×4 → use_design_ref → use_skill → write_file ×6
use_skill → capture_reference → list_files ×2 → read_file ×9 → use_skill ×2 → read_file ×6
```

Those are already narratives. The first is *look around → read → consult a reference → build*. The
second is *study something → go look at it → read a lot*. The structure is there; nothing surfaces
it.

## The finding that reorganised this

Measured across every recorded tool call in this instance:

| Tool | Calls | Median | Slowest |
|---|---:|---:|---:|
| `read_file` | 563 | **3 ms** | 0.0s |
| `write_file` | 510 | **4 ms** | 0.1s |
| `edit_file` | 431 | **5 ms** | 0.1s |
| `search_files` | 152 | 151 ms | 7.0s |
| `run_command` | 203 | **2.8 s** | 28.1s |
| `typecheck_project` | 137 | 5.3 s | 15.7s |
| `check_console_errors` | 105 | 2.8 s | 5.7s |
| `test_responsive_layout` | 43 | 7.1 s | 10.4s |
| `dispatch_task` | 66 | **61 s** | 300s |

These are not one kind of thing. They are three, and conflating them is why a tool log reads as
noise:

**Hand movements (3–5 ms, hundreds of them).** Reading and writing files. You cannot animate 563
discrete events — at 3 ms each they are not events, they are *one continuous activity*. A person
typing is not performing four hundred gestures; they are typing. This is a **held posture**, and its
only useful variable is intensity.

**Watchable actions (2–7 s).** Running a command, typechecking, auditing a page. Long enough to
have a beginning and an end, and to be worth showing individually. These are the **discrete
gestures** — the cup going to the mouth.

**Delegation (61 s median, up to five minutes).** `dispatch_task` hands work to a specialist. This
is not the agent doing something; it is the agent *not* doing something while somebody else does.
Physically that is a different thing entirely — handing over a folder and waiting.

There is a fourth, invisible in the table because it is the gap between rows: **the model thinking**.
Between tool calls, nothing happens for seconds at a time. In a body that is the pause before
speaking, and it is information — but today it is indistinguishable from being stuck.

## The proposal: three channels, composed

Human body language is readable because independent channels combine. Walking, plus a phone at the
ear, plus a hurried pace, reads as *late for a call* — and none of those three needed a label.

Give the agent the same structure.

### Channel 1 — what it is holding (activity)

A small vocabulary of props, each unmistakable in silhouette, mapped from the tool families above:

| Posture | Tools | Reads as |
|---|---|---|
| Holding an open page | `read_file`, `list_files`, `search_files` | reading |
| Hands at a keyboard | `write_file`, `edit_file` | writing |
| Turning a crank / at a machine | `run_command`, `typecheck_project` | running something |
| Holding a magnifier to a screen | `inspect_page`, `accessibility_audit`, `check_console_errors` | checking its work |
| At a window, looking out | `capture_reference`, browsing | looking at the world |
| Consulting a manual | `use_skill`, `use_design_ref` | looking something up |
| Handing a folder to a second figure | `dispatch_task` | delegating |
| Still, looking up | model thinking between calls | thinking |

Eight postures cover every tool in the product. That is small enough to learn without being taught —
which is the bar, because nobody reads a legend for body language.

### Channel 2 — where it is looking (locus)

The posture says *what*. The workspace already on screen says *where*. The file tree, the preview,
the terminal — these are the room the agent is working in, and today they sit inert while it works.

Make attention physical: the file being read lights up in the tree; the file being written shows
text arriving; the preview pane is where its gaze goes when it checks its work. Not a new widget —
the existing UI *becoming* the body.

This is the part nobody else does. Editors show you diffs after the fact. The live browser view
already proved the appetite for watching instead of reading.

### Channel 3 — how it is moving (state)

Tempo and tension, continuous, never labelled:

- **Rate** — how fast the posture cycles, driven by actual tool frequency. A burst of writes looks
  busy because it *is*.
- **Tension** — retries, errors, the loop guards tripping, an approaching turn cap. A body that is
  struggling holds itself differently, and the agent has all of this data and currently shows none
  of it.
- **Breath** — the idle state. Something alive is never perfectly still. This is what makes the
  difference between "working" and "hung", which today is a coin flip.

Channel 3 is the one that answers a question text never does: *is this going well?*

## Why this is not a mascot

The obvious version of "give it a body" is a cartoon character, and that is the trap. A mascot is
decoration: it performs an animation that was chosen to look busy, and after a week you stop seeing
it because it never told you anything.

The difference is that **every channel here is driven by a real signal**. The posture comes from the
tool actually running. The tempo comes from measured call frequency. The tension comes from real
retry counts. If the agent is stuck, the body is visibly stuck, because there is nothing else it
could be doing.

A body that can only look busy is worse than a spinner. A body that can look *stuck* is the feature.

## What already exists to build on

| | |
|---|---|
| `tool.start` / `tool.end` | already streamed, already carry name and duration |
| `agent.activity` | specialists already emit `start`/`step`/`end` with a title |
| `browser.frame` | the live browser view, shipped — the precedent |
| `ZelyqThinking` | today's indicator: a Z that animates and a text status |

The event stream needed for channel 1 is **already there**. Channel 3 needs retry and loop-guard
signals surfaced, which the session has and does not emit. Channel 2 is the largest piece and the
most valuable.

## Honest risks

**It can become noise.** Eight postures changing hundreds of times a turn is a strobe. The 3 ms
finding is the guard: fast tools are a held state, not a sequence of gestures. Anything under a
threshold aggregates.

**It can lie.** If the posture lags the real state, or shows "working" while the agent is wedged, it
is worse than nothing — a status that cannot show failure is decoration. Tension has to be wired to
real failure signals before this ships, not after.

**Accessibility.** A purely physical language excludes anyone who cannot see it. The text log does
not go away; this sits alongside it, and every posture needs an accessible name.

**Taste.** This is the risk with no technical answer. Done well it is the thing people show their
friends. Done badly it is Clippy. The difference is entirely in restraint and in whether it is
telling the truth.

## What was built

Channel 1, and enough of channel 3 to come with it. Channel 2 — the workspace itself becoming the
body — is not started, and is worth doing only now that the vocabulary has proven legible.

| | |
|---|---|
| `apps/web/src/lib/posture.ts` | tool stream → posture, tempo, tension, focus |
| `apps/web/src/components/AgentBody.tsx` | the nine poses |
| `apps/web/src/index.css` | breath, per-pose motion, the reduced-motion fallback |
| `apps/web/src/hooks/useChatSocket.ts` | `body` folded from the same events as the transcript |
| `apps/web/src/components/ChatPanel.tsx` | `AgentPresence`, where the spinner was |

**The body is the mark.** Zelyq's logo is already one stroke broken at its own corners into three
segments. Those three segments are the body: they re-pose into what the agent is doing, and nothing
is added. Every pose is `M x,y L x,y L x,y` — always three points — so the browser interpolates `d`
and a change of activity is a movement rather than a swap. A body that teleported between icons
would be a slideshow.

`ZelyqThinking` is gone, replaced rather than sat beside. It was the same mark animating on a timer;
this is the same mark animating on the truth.

### Nine postures, not eight

`thinking` had to become a real pose rather than the absence of one, and `browsing` and `inspecting`
turned out to be different activities that a single "looking" pose blurred together.

Three of them were redrawn after seeing them rendered side by side, which is the only way to judge
this. `reading` and `writing` were both flat horizontal lines and could not be told apart — they are
the two commonest things the agent does, so writing became a page corner with a nib working
diagonally across it. `consulting` went from an arrow to a `running` glyph upside down before
landing on a bookmark; the metaphor is looser than an open book, but it collides with nothing, and
in a vocabulary this small collision is the only real failure.

### Two rules that make it readable rather than a strobe

**The dwell floor.** Read and write calls take 3–5 ms and interleave. Without a floor the body would
change pose hundreds of times a second. A posture is held 600 ms before another can take it —
long enough to see, short enough that a real change of activity still feels immediate. `delegating`
is exempt: it lasts a minute, and showing it late would show it wrong.

**Tempo is measured between calls, not since the pose was adopted.** A posture is held across a
whole burst, so the moment it was adopted stops moving while the work continues. Reading the rate
from it made a sustained run of fast reads look like it was winding down — a body that gets calmer
the harder it works.

### Why it cannot lie

Every channel is folded from the same event stream the transcript is built from. There is no second
signal that could disagree with it: the posture is the tool that is actually running, the tempo is
the measured interval between calls, the tension is real `isError` results, and a turn that ends in
an error rests visibly strained rather than settling like one that did not. A body that can only
look busy is worse than a spinner. A body that can look *stuck* is the feature.

## Open questions

- Channel 2 remains the largest and most striking piece: the file tree lighting up where the agent
  is reading, the preview being where its gaze goes.
- `delegating` shows one stroke leaving the mark, but the specialist's own work is still only the
  `agent.activity` text thread. A second body would be the honest version.
- Between turns the body rests and breathes rather than disappearing. Whether that is right over a
  long idle period is a judgement nobody has made yet with real use behind them.
