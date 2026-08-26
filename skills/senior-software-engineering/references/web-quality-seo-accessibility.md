# Web Quality: SEO, Accessibility, and Browser Correctness

## Applicability

Apply SEO requirements only to content that is intended to be publicly discoverable. Private dashboards do not need search indexing, but accessibility and web correctness still apply.

## Semantic HTML first

Use native elements for native behavior:
- headings in logical hierarchy;
- buttons for actions;
- anchors for navigation;
- labels for controls;
- lists/tables where the content is actually list/tabular.

Do not recreate button/link semantics with clickable `div`s unless there is a strong reason and complete keyboard/ARIA behavior.

## Accessibility baseline

WCAG 2.2 organizes accessibility under four principles: perceivable, operable, understandable, robust.

For normal professional web work target applicable WCAG 2.2 AA requirements unless project/regulatory requirements specify another target.

### Keyboard

Every interactive feature must be usable without a mouse where appropriate.

Check:
- tab order;
- visible focus;
- modal focus containment/return;
- skip/navigation behavior;
- escape/cancel behavior;
- no keyboard traps.

### Names and relationships

Controls need programmatic accessible names. Form errors must be associated with fields and communicated in a usable way.

Use ARIA to fill semantic gaps, not replace correct HTML.

### Images/media

Provide meaningful alt text for informative images and empty alt for decorative images.

Captions/transcripts/audio-description needs depend on media and project requirements.

### Motion

Respect reduced-motion preferences for non-essential motion.

### Contrast and zoom

Ensure readable contrast and layouts that survive zoom/reflow without hiding core content.

### Touch targets

WCAG 2.2 includes target-size guidance; avoid tiny controls and controls packed too closely for touch.

## SEO baseline for public pages

Google's current technical minimum for indexing is straightforward:
1. crawler is not blocked;
2. page returns a successful HTTP status;
3. page contains indexable content.

Professional implementation should additionally consider the page's actual search intent and duplicate/canonical structure.

### Crawlability

Use crawlable `<a href>` links for navigable destinations.

Important screens/content should have stable URLs when they represent distinct public content.

Do not hide all meaningful text in canvas/video/images or require unsupported interaction to reveal the only textual representation.

### Index controls

Understand the difference:
- `robots.txt` controls crawling requests;
- `noindex` controls indexing and generally requires the crawler to access the page to see it.

Do not accidentally block pages that are intended to rank.

### Status codes

Return real HTTP semantics:
- 200 for working canonical pages;
- redirects for moved content;
- 404/410 for truly unavailable content where appropriate.

Do not serve every missing page as a fake 200.

### Metadata

For indexable pages consider:
- unique descriptive `<title>`;
- useful meta description;
- canonical URL when duplicate variants exist;
- robots directives;
- language metadata;
- Open Graph/social metadata where product needs it.

### Canonicalization

Avoid uncontrolled duplicate URL variants.

Google documents redirects and `rel=canonical` as strong canonical signals and sitemap inclusion as a weaker signal.

### Structured data

Add structured data only when it matches visible page content and an applicable supported type. Validate it.

Do not manufacture rich-result markup that does not represent actual content.

### Sitemap

Provide/update sitemap when it helps discovery of indexable URLs. Exclude URLs intentionally unavailable to search where appropriate.

### JavaScript SEO

Google executes JavaScript, but client-rendering still introduces failure modes and delays.

For important public content prefer a rendering strategy that delivers meaningful HTML reliably (SSR/SSG/server rendering as project architecture permits).

Never make an indexable page's only meaningful content dependent on a failing client API without fallback.

## Browser behavior

Test:
- narrow and wide viewport;
- keyboard;
- slow network/loading states;
- no-JS/degraded behavior where the architecture warrants it;
- errors/empty states;
- long content;
- localization/long strings;
- browser autofill/form behavior.

## Forms

Professional forms need:
- labels;
- required/optional clarity;
- server-side validation;
- useful field/global errors;
- duplicate-submission protection for meaningful side effects;
- loading state;
- success confirmation;
- preserved/recoverable user input when safe.

## Sources

- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Google Search Essentials: https://developers.google.com/search/docs/essentials
- Google developer SEO guide: https://developers.google.com/search/docs/fundamentals/get-started-developers
- Google canonicalization: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
