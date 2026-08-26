# Motion

## Purpose

Motion should communicate:
- causality;
- continuity;
- hierarchy;
- state;
- feedback.

## Good uses

- expanding/collapsing relationship;
- object moving between states;
- page transition preserving spatial context;
- progress;
- attention to a newly changed item.

## Bad uses

- delaying routine tasks;
- animating every entrance;
- decorative bounce on operational controls;
- background motion competing with reading;
- large parallax/zoom without purpose.

## Duration

No single timing is universally correct.

Choose based on:
- distance;
- complexity;
- platform;
- frequency;
- user control.

Frequent microfeedback should generally feel immediate.

## Interruptibility

Animations tied to user input should handle interruption cleanly.

Do not queue stale motion after rapid interaction.

## Reduced motion

Provide a designed alternative:
- fade;
- cut;
- shorter transition;
- static state.

Apple accessibility guidance specifically recommends reducing zoom/scaling/peripheral motion when Reduce Motion is active.

## Motion tokens

Define:
- duration.fast / normal / slow;
- easing.standard / enter / exit;
- spring/physics values where platform uses them.

Avoid random timing per component.

## Review

- What does this motion explain?
- Does it block input?
- Can it be interrupted?
- Does reduced-motion preserve understanding?
