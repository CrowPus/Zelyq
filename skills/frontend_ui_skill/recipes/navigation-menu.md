# Recipe: Navigation vs Action Menu

Do not use ARIA `menu` roles for every site navigation dropdown.

A menu/menubar pattern models application-style command menus and comes with arrow-key focus semantics. Ordinary site navigation can often use links plus disclosure behavior instead.

For an action menu button, APG expects:
- button semantics;
- `aria-haspopup="menu"`/expanded state;
- Enter/Space opens and focuses menu content;
- menu keyboard behavior follows APG.

Reference: https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
