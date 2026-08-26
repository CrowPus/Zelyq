# Forms and Error Design

## Forms are conversations

Ask only what is needed and explain why sensitive/unusual information is required.

## Structure

Prefer:
- one clear label per field;
- helper text before error where needed;
- logical grouping;
- appropriate field width;
- natural sequence.

## Validation

Design:
- pre-submit prevention for obvious constraints;
- field-level error;
- summary for complex/long forms where useful;
- server-side failure;
- resubmission.

Do not punish users with validation before they have had a chance to complete the field.

## Errors

Errors should:
- be visually associated with field;
- be specific;
- not rely only on red;
- preserve entered values;
- explain recovery.

## Long flows

Show progress only if steps are meaningful and stable.

Do not create artificial "5 easy steps" when the process actually branches unpredictably.

## Checkout/high-value

Reduce:
- surprise costs;
- unnecessary account creation;
- ambiguous payment status;
- loss of cart/form state.

Domain research (e.g. Baymard) can inform e-commerce-specific decisions, but do not universalize checkout findings to unrelated forms.

## Review

- Is every question necessary?
- Can users understand expected format?
- What happens after network failure?
- Is duplicate submission handled?
- Can users recover without retyping?
