import { t } from "../lib/i18n";

/*
 * The app's frame in grey while it loads: the same drawing as the one in
 * index.html (whose <style> holds the zs- classes), so the page does not jump
 * when React takes over from the static one.
 */
const bar = "zs-b";

export function AppSkeleton({ variant = "frame" }: { variant?: "frame" | "card" }) {
  return (
    <div role="status" aria-label={t("Loading")}>
      {variant === "card" ? (
        <div className="zs-cardview zs-show">
          <div className="zs-auth">
            {[0, 1, 2, 3].map((i) => (
              <i key={i} className={bar} />
            ))}
          </div>
        </div>
      ) : (
        <div className="zs">
          <div className="zs-side">
            <i className={`${bar} zs-logo`} />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <i key={i} className={`${bar} zs-nav`} />
            ))}
          </div>
          <div className="zs-main">
            <div className="zs-top">
              <i className={`${bar} zs-crumb`} />
              <i className={`${bar} zs-av`} />
            </div>
            <div className="zs-page">
              <i className={`${bar} zs-title`} />
              <i className={`${bar} zs-desc`} />
              <div className="zs-cards">
                {[0, 1, 2].map((i) => (
                  <i key={i} className={`${bar} zs-card`} />
                ))}
              </div>
              <div>
                {[0, 1, 2, 3].map((i) => (
                  <i key={i} className={`${bar} zs-row`} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
