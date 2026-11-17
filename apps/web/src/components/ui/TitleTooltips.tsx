import { useEffect, useRef, useState } from "react";

/**
 * Turns every plain `title="…"` in the app into the same styled tooltip the
 * `Tooltip` component draws: shown on hover *and* on keyboard focus, quickly,
 * in the product's look — instead of the browser's slow, unstyled one that
 * keyboard users never see.
 *
 * The title moves to `data-title` while the tooltip is up, so the browser does
 * not show its own on top. An element that had no other accessible name keeps
 * the words as its `aria-label`, so nothing goes unnamed.
 */
export function TitleTooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(
    null,
  );
  const current = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    function restore() {
      const el = current.current;
      if (el?.dataset.title !== undefined) {
        el.setAttribute("title", el.dataset.title);
        delete el.dataset.title;
      }
      current.current = null;
      window.clearTimeout(timer.current);
      setTip(null);
    }

    function show(target: EventTarget | null, delay: number) {
      const el = (target as HTMLElement | null)?.closest?.<HTMLElement>("[title]");
      if (!el || el.tagName === "IFRAME" || el === current.current) return;
      const text = el.getAttribute("title")?.trim();
      if (!text) return;
      restore();
      current.current = el;
      el.dataset.title = text;
      el.removeAttribute("title");
      const hasName =
        el.getAttribute("aria-label") ||
        el.getAttribute("aria-labelledby") ||
        (el.textContent ?? "").trim().length > 0;
      if (!hasName) el.setAttribute("aria-label", text);
      timer.current = window.setTimeout(() => {
        if (current.current !== el) return;
        const rect = el.getBoundingClientRect();
        const below = rect.top < 48;
        setTip({
          text,
          x: Math.min(Math.max(rect.left + rect.width / 2, 12), window.innerWidth - 12),
          y: below ? rect.bottom + 6 : rect.top - 6,
          below,
        });
      }, delay);
    }

    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      show(event.target, 350);
    };
    const out = (event: PointerEvent) => {
      const el = current.current;
      if (el && !el.contains(event.relatedTarget as Node | null)) restore();
    };
    const focus = (event: FocusEvent) => {
      // Only keyboard focus: a click also focuses, and the pointer path covers it.
      if ((event.target as HTMLElement)?.matches?.(":focus-visible")) show(event.target, 0);
    };
    const blur = () => restore();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") restore();
    };

    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", restore, true);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", restore, true);
      restore();
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[70] max-w-xs rounded-md bg-strong px-2 py-1 text-xs font-medium text-strong-fg shadow-overlay animate-[ui-fade-in_120ms_ease-out]"
      style={{
        left: tip.x,
        top: tip.y,
        transform: `translate(-50%, ${tip.below ? "0" : "-100%"})`,
      }}
    >
      {tip.text}
    </div>
  );
}
