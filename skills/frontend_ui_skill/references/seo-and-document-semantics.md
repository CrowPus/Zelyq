# SEO and Document Semantics

## Applicability

Use for public/indexable content. Do not turn private/authenticated application screens into SEO projects.

## Search Essentials

Google Search Essentials emphasizes technical eligibility, spam policies, and people-first content. Core best practices include using words people search for in prominent places such as page titles, main headings, alt text, and link text.

Source: https://developers.google.com/search/docs/essentials

## Document basics

Public pages should have:
- meaningful unique title;
- logical headings;
- semantic main/navigation/content structure;
- crawlable links (`<a href>` where navigation is intended);
- descriptive link text;
- appropriate status codes/rendering behavior;
- useful metadata where applicable.

## Titles

Google may generate title links from multiple signals, including `<title>`, visible headings, and other prominent page text. Keep these aligned rather than keyword-stuffing or using generic boilerplate.

Source: https://developers.google.com/search/docs/appearance/title-link

## Meta descriptions

Descriptions can be used to generate snippets but are not guaranteed. Write useful page-specific summaries; do not auto-generate meaningless keyword lists.

Source: https://developers.google.com/search/docs/appearance/snippet

## Canonical / robots

Use canonicalization and robots directives only with a clear indexing strategy. Do not accidentally noindex important pages or canonicalize unrelated pages together.

## Client rendering

Understand how the chosen framework exposes primary content to crawlers. Do not assume “Google executes JavaScript” means rendering strategy never matters for speed, reliability, metadata, links, or non-Google crawlers.

## Structured data

Only add structured data that:
- matches visible page content;
- uses the correct supported schema/search-feature rules;
- is maintained when content changes.

Do not fabricate ratings, prices, authorship, or business information.

## Images

Alt text serves accessibility first and can also help search understand images. Describe meaningful image purpose; do not stuff keywords.
