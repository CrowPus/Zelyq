# Recipe: Accessible Modal Dialog

Use a native `<dialog>` where it satisfies product/browser requirements, or an established accessible dialog primitive.

Required behavior:
- opening action is a button;
- dialog has a visible title/accessibility name;
- focus moves inside when opened;
- Tab/Shift+Tab remain within modal content;
- Escape closes unless preventing dismissal is essential;
- background is inert/non-interactive;
- closing returns focus to a logical control;
- scrolling works for long content;
- close action is visible.

Do not implement a modal as an absolutely positioned `<div>` plus `aria-modal` and assume the job is done.

Reference: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
