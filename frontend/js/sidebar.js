/* Responsive sidebar.

   full    >= 1000px wide          labelled sidebar
   rail    < 1000px wide           icon-only rail (720x480 minimum lands here)
   overlay < 700px or <= 420px tall  off-canvas drawer over a scrim

   Width class comes from matchMedia. Inside full/rail the user can pin a
   preference with the app-bar toggle; overlay always wins when it applies,
   since there is not enough room for a persistent sidebar. */
window.PA = window.PA || {};

PA.sidebar = (function () {
    var app, toggle, collapse, scrim;
    var overlayQuery = window.matchMedia("(max-width: 699px), (max-height: 420px)");
    var railQuery = window.matchMedia("(max-width: 999px)");
    var preference = null; /* "full" | "rail" | null = follow the viewport */

    function listen(mql, handler) {
        if (mql.addEventListener) {
            mql.addEventListener("change", handler);
        } else {
            mql.addListener(handler); /* Chromium 83 fallback */
        }
    }

    function mode() {
        if (overlayQuery.matches) {
            return "overlay";
        }
        if (preference) {
            return preference;
        }
        return railQuery.matches ? "rail" : "full";
    }

    function render() {
        var next = mode();
        app.setAttribute("data-nav", next);
        if (next !== "overlay") {
            close();
        }
        toggle.setAttribute(
            "aria-label",
            next === "overlay" ? "Open navigation" : "Collapse navigation"
        );
    }

    function open() {
        app.setAttribute("data-nav-open", "true");
        toggle.setAttribute("aria-expanded", "true");
    }

    function close() {
        app.setAttribute("data-nav-open", "false");
        toggle.setAttribute("aria-expanded", "false");
    }

    function onToggle() {
        if (mode() === "overlay") {
            if (app.getAttribute("data-nav-open") === "true") {
                close();
            } else {
                open();
            }
            return;
        }
        /* Pin the opposite of whatever is showing now. */
        preference = app.getAttribute("data-nav") === "rail" ? "full" : "rail";
        render();
    }

    function init() {
        app = document.getElementById("app");
        toggle = document.getElementById("navToggle");
        scrim = document.getElementById("scrim");

        toggle.addEventListener("click", onToggle);
        scrim.addEventListener("click", close);

        // The in-sidebar chevron does the same job as the app-bar button;
        // having it on the panel itself is where people look for it.
        collapse = document.getElementById("sidebarCollapse");
        if (collapse) {
            collapse.addEventListener("click", onToggle);
        }

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && mode() === "overlay") {
                close();
            }
        });

        /* A viewport change invalidates a pinned preference only when it
           crosses into overlay; otherwise the pin is intentional. */
        listen(overlayQuery, render);
        listen(railQuery, render);
        /* Belt and braces: an embedded webview can resize without the media
           query flipping (device pixel ratio changes, zoom), so re-render on
           resize too. render() is idempotent. */
        window.addEventListener("resize", render);
        // The widget can still be resizing when scripts first run - the app
        // restores saved geometry after construction - so the first mode can
        // be computed from a stale viewport. Re-check once everything settles.
        window.addEventListener("load", render);

        render();
    }

    return { init: init, close: close, mode: mode, refresh: render, toggle: onToggle };
})();
