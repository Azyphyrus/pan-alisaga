/* Shared in-app confirm dialog: a body-level modal that replaces the
   native window.confirm() so destructive actions stay inside the app's
   design system (theming, fonts, focus rings) instead of the browser's
   generic chrome dialog.

   API:
     PA.dialog.confirm(message, options, callback)
       message  — the question shown in the dialog body
       options  — optional: {title?, confirmLabel?, cancelLabel?, danger?}
                  danger defaults to true (every current call site is a
                  destructive action); pass danger:false for neutral confirms
       callback — function(ok): called with true/false on user choice;
                  dismissing via Esc or the overlay counts as cancel (false)

   Accessibility: the dialog is role=alertdialog, Esc cancels, Enter
   confirms, focus starts on the confirm button and returns to the
   previously focused element after dismissal. Focus is trapped while
   the dialog is open. */

window.PA = window.PA || {};

(function (PA) {
    "use strict";

    var overlayEl = null;
    var dialogEl = null;
    var restoreFocusTo = null;
    var activeCallback = null;

    function ensureDom() {
        if (dialogEl) {
            return;
        }

        overlayEl = document.createElement("div");
        overlayEl.className = "dialog";
        overlayEl.hidden = true;

        dialogEl = document.createElement("div");
        dialogEl.className = "dialog__box";
        dialogEl.setAttribute("role", "alertdialog");
        dialogEl.setAttribute("aria-modal", "true");

        overlayEl.appendChild(dialogEl);
        document.body.appendChild(overlayEl);

        // Esc = cancel, Enter = confirm.
        overlayEl.addEventListener("keydown", function (e) {
            if (overlayEl.hidden) {
                return;
            }
            if (e.key === "Escape") {
                e.stopPropagation();
                dismiss(false);
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (dialogEl.querySelector(".dialog__confirm")) {
                    dismiss(true);
                }
            }
        });

        // Overlay click = cancel (unless the press is inside the box).
        overlayEl.addEventListener("mousedown", function (e) {
            if (!overlayEl.hidden && !dialogEl.contains(e.target)) {
                dismiss(false);
            }
        });

        // Simple focus trap while open.
        overlayEl.addEventListener("focusin", function (e) {
            if (overlayEl.hidden || dialogEl.contains(e.target)) {
                return;
            }
            var confirmBtn = dialogEl.querySelector(".dialog__confirm");
            if (confirmBtn) {
                confirmBtn.focus();
            }
        });
    }

    function dismiss(result) {
        if (!overlayEl || overlayEl.hidden) {
            return;
        }
        var callback = activeCallback;
        activeCallback = null;
        overlayEl.hidden = true;
        dialogEl.innerHTML = "";
        if (restoreFocusTo && restoreFocusTo.focus) {
            try {
                restoreFocusTo.focus();
            } catch (err) {
                /* the anchor may be gone (view switched) — ignore */
            }
        }
        restoreFocusTo = null;
        if (callback) {
            callback(result);
        }
    }

    /* message: string, options: {title?, confirmLabel?, cancelLabel?, danger?},
       callback: function(ok). Returns true if the dialog opened. */
    function confirm(message, options, callback) {
        if (typeof options === "function") {
            callback = options;
            options = null;
        }
        options = options || {};

        ensureDom();

        if (!overlayEl.hidden) {
            // A dialog is already open: treat the new request as cancelled
            // rather than stacking dialogs.
            if (callback) {
                callback(false);
            }
            return false;
        }

        var title = options.title || "Are you sure?";
        var confirmLabel = options.confirmLabel || "Confirm";
        var cancelLabel = options.cancelLabel || "Cancel";
        var danger = options.danger !== false;

        activeCallback = callback;
        restoreFocusTo = document.activeElement;

        function el(className, tagName, text) {
            var node = document.createElement(tagName || "div");
            node.className = className;
            if (text) {
                node.textContent = text;
            }
            return node;
        }

        var heading = el("dialog__title", "h2", title);
        var body = el("dialog__message", "p", message);
        var actions = el("dialog__actions", "div");

        var cancelBtn = el("dialog__cancel dialog__btn", "button", cancelLabel);
        cancelBtn.type = "button";
        cancelBtn.addEventListener("click", function () {
            dismiss(false);
        });

        var confirmBtn = el(
            "dialog__confirm dialog__btn"
                + (danger ? " dialog__btn--danger" : ""),
            "button",
            confirmLabel
        );
        confirmBtn.type = "button";
        confirmBtn.addEventListener("click", function () {
            dismiss(true);
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);

        dialogEl.appendChild(heading);
        dialogEl.appendChild(body);
        dialogEl.appendChild(actions);

        overlayEl.hidden = false;
        confirmBtn.focus();
        return true;
    }

    PA.dialog = {
        confirm: confirm,
        close: function () {
            dismiss(false);
        },
        isOpen: function () {
            return !!(overlayEl && !overlayEl.hidden);
        }
    };
})(window.PA);