# Internationalization and Localization

## Principle

Do not bake one language, writing direction, date system, number format, or name/address convention into reusable UI.

## Language

Set the document `lang` correctly and mark language changes within content when needed so browsers and assistive technology can interpret pronunciation and typography.

## Formatting

Use locale-aware APIs (for example `Intl`) for:
- dates/times;
- numbers;
- currency;
- relative time;
- lists;
- plural-sensitive messages where the i18n system supports them.

Avoid hand-built formatting like `'$' + amount.toFixed(2)` in international products.

## Text expansion

Translated strings can be substantially longer or shorter.

Avoid:
- fixed-width buttons that clip labels;
- absolute-positioned copy with no room;
- assumptions that one word fits;
- tiny modal widths based on English.

## String construction

Do not concatenate translated fragments such as:

```ts
"Hello " + userName + ", you have " + count + " messages"
```

Use complete messages with interpolation/plural support so translators can reorder grammar.

## RTL

Prefer logical CSS properties (`margin-inline`, `padding-inline`, `inset-inline-start`) where useful.

Do not blindly mirror every icon. Directional arrows may mirror; logos, media controls, charts, clocks, and culturally stable symbols may not.

## Input

Expect:
- Unicode names;
- different address structures;
- non-Latin scripts;
- IME composition;
- decimal/date formats;
- longer legal/business names.

Do not validate human names with simplistic ASCII regexes.

## Layout QA

At minimum test one expansion-heavy locale and RTL when the product supports them.
