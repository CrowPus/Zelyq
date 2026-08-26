# Information Architecture

## Goal

Organize information so users can predict where things are, understand where they are, and reach important tasks with minimal unnecessary cognitive work.

## Start from user tasks

Identify:
- top tasks;
- frequency;
- urgency;
- expertise;
- information needed before action;
- objects users think in;
- natural sequence.

Do not mirror backend entities or company org charts unless users genuinely think that way.

## Navigation models

Common patterns:
- global sections;
- object-first navigation;
- task-first navigation;
- hub-and-spoke;
- step-by-step flow;
- search-first;
- dashboard + drilldown.

Choose by user mental model and task frequency.

## Hierarchy

For every screen:
1. What is this?
2. Why am I here?
3. What matters now?
4. What can I do?
5. What happens next?

If the design cannot answer those quickly, styling will not rescue it.

## Progressive disclosure

Hide complexity only when:
- it is secondary;
- users can discover it;
- hiding it does not remove important context.

Do not bury frequent actions in overflow menus merely to make a screen look cleaner.

## Naming

Navigation labels should:
- use user/domain language;
- be mutually distinguishable;
- avoid cleverness;
- remain stable.

## Orientation

Support orientation with:
- meaningful titles;
- active navigation;
- breadcrumbs when hierarchy warrants;
- persistent context for nested objects;
- clear back/up behavior.

## Search

Search becomes important when:
- information space is large;
- users know what they seek;
- browsing hierarchy would be slow.

Search does not compensate for incoherent navigation.

## Review

- Can a new user predict where a top task lives?
- Can an expert reach frequent tasks quickly?
- Are categories mutually understandable?
- Does object hierarchy match the domain?
- Is important context lost after drilldown?
