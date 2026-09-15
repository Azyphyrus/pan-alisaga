/* Shared floating card menu: one menu element appended to <body> and
   positioned next to the ⋯ button that opened it.

   Why this exists: the old per-card menus lived *inside* the card, and the
   gallery grids scroll (overflow-y: auto). An absolutely-positioned child
   of a scrolling container is clipped by that container (and by the card
   itself once alignment flips), so the last options were cut off and needed
   scrolling. A body-level fixed menu floats above everything instead. */
window.PA = window.PA || {};

PA.cardMenu = (function () {
    var menuEl = null;
    var openBtn = null;
    var onDocClick = null;
    var onKey = null;
    var onScrollResize = null;

    function ensure() {
        if (menuEl) {
            return menuEl;
        }
        menuEl = document.createElement("div");
        menuEl.className = "card-menu";
        menuEl.setAttribute("role", "menu");
        menuEl.hidden = true;
        document.body.appendChild(menuEl);

        onDocClick = function (e) {
            if (menuEl.hidden) {
                return;
            }
            if (menuEl.contains(e.target)) {
                return;
            }
            if (openBtn && (openBtn === e.target || openBtn.contains(e.target))) {
                return;
            }
            close();
        };
        onKey = function (e) {
            if (menuEl.hidden) {
                return;
            }
            if (e.key === "Escape") {
                close();
                if (openBtn && openBtn.focus) {
                    openBtn.focus();
                }
            }
        };
        // A scroll or resize moves the anchor, so dismiss rather than float
        // in the wrong place. Capture phase: gallery scrolls don't bubble.
        onScrollResize = function () {
            if (!menuEl.hidden) {
                close();
            }
        };
        document.addEventListener("click", onDocClick);
        document.addEventListener("keydown", onKey);
        document.addEventListener("scroll", onScrollResize, true);
        window.addEventListener("resize", onScrollResize);
        return menuEl;
    }

    function close() {
        if (menuEl) {
            menuEl.hidden = true;
            menuEl.innerHTML = "";
        }
        openBtn = null;
    }

    function isOpenFor(btn) {
        return menuEl && !menuEl.hidden && openBtn === btn;
    }

    /* items: [{label, danger?, onClick}]. Positions under the button,
       flipping above when there is no room below, and clamping sideways. */
    function open(btn, items) {
        var el = ensure();
        if (isOpenFor(btn)) {
            close();
            return false;
        }
        close();
        openBtn = btn;
        for (var i = 0; i < items.length; i++) {
            (function (item) {
                var opt = document.createElement("button");
                opt.className = "card-menu__item"
                    + (item.danger ? " card-menu__item--danger" : "");
                opt.type = "button";
                opt.setAttribute("role", "menuitem");
                opt.textContent = item.label;
                opt.addEventListener("click", function (e) {
                    e.stopPropagation();
                    close();
                    item.onClick();
                });
                el.appendChild(opt);
            })(items[i]);
        }
        el.hidden = false;

        var rect = btn.getBoundingClientRect();
        // Measure after unhiding so the menu has a size.
        var mw = el.offsetWidth;
        var mh = el.offsetHeight;
        var gap = 4;
        var top = rect.bottom + gap;
        if (top + mh > window.innerHeight - 8) {
            top = rect.top - mh - gap;
        }
        if (top < 8) {
            top = 8;
        }
        var left = rect.right - mw;
        if (left < 8) {
            left = 8;
        }
        if (left + mw > window.innerWidth - 8) {
            left = window.innerWidth - mw - 8;
        }
        el.style.top = top + "px";
        el.style.left = left + "px";

        var first = el.querySelector(".card-menu__item");
        if (first && first.focus) {
            first.focus();
        }
        return true;
    }

    return { open: open, close: close, isOpenFor: isOpenFor };
})();
