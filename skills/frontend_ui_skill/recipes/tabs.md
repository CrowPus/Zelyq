# Recipe: Accessible Tabs

Use tabs when multiple related panels occupy the same region and users benefit from quick switching.

Follow WAI-ARIA APG:
- `tablist`, `tab`, `tabpanel` semantics when native abstraction is unavailable;
- arrow-key navigation within tab list;
- clear selected state;
- correct relationships via IDs/ARIA;
- focus behavior appropriate to automatic or manual activation.

Reference: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/

Do not use tabs to hide unrelated content merely to reduce page length.

When tabs represent meaningful shareable navigation, consider URL state/deep links.
