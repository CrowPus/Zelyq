# Forms and Validation

## Forms are workflows

A professional form includes entry, validation, submission, pending state, success, recoverable failure, and sometimes destructive confirmation.

## Native controls

Use appropriate input types and semantics. Native controls provide keyboard, mobile keyboard, autofill, and accessibility behavior that custom replacements must otherwise recreate.

## Labels

Prefer visible labels. Placeholder text is not a label: it disappears during entry and should usually be example/help content instead.

## Autocomplete

Use valid `autocomplete` tokens such as:
- `name` / `given-name` / `family-name`;
- `email`;
- `username`;
- `current-password` / `new-password`;
- `street-address`;
- `postal-code`;
- `cc-number` where appropriate.

MDN advises against broadly disabling autocomplete because users, including people with cognitive/motor disabilities, rely on it.

Source: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete

## Validation timing

Use validation timing deliberately:
- obvious formatting hints can be immediate;
- do not shout errors on untouched fields;
- validate on blur/submit according to task;
- server/business validation remains authoritative.

## Errors

Errors should:
- say what failed;
- say how to correct it when possible;
- be associated with the control;
- remain visible until resolved;
- not depend only on color.

For failed submission, preserve user input unless security/business requirements demand otherwise.

## Submission

Prevent accidental duplicate submission while a non-idempotent action is pending. Do not merely disable everything if the user needs to cancel or inspect information.

Show meaningful pending feedback near the action.

## Focus on failure

For long forms, consider focusing an error summary or first invalid control according to the project's accessibility pattern. Do not move focus unpredictably on every small validation change.

## Authentication

Do not break password managers by disabling paste or using fake fields. WCAG 2.2 includes Accessible Authentication requirements. Support recognized credential workflows and alternatives to cognitive function tests where required.

## Destructive / financial / legal data

Provide review, confirmation, reversal, or correction mechanisms proportional to consequences.

## Multi-step forms

Preserve:
- progress;
- entered values;
- clear back navigation;
- validation ownership;
- resumability when product requirements demand it.

Avoid making users re-enter data unnecessarily; WCAG 2.2 adds Redundant Entry requirements in relevant processes.
