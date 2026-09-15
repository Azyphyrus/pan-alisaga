/* In-app reminder banner, shown alongside the desktop notification so the
   reminder is visible even when the window already has focus. */
window.PA = window.PA || {};

PA.toast = (function () {
    var container;

    function dismiss(node) {
        if (node && node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }

    function show(title, message, seconds) {
        if (!container) {
            return;
        }
        var node = document.createElement("div");
        node.className = "toast";
        node.setAttribute("role", "status");
        node.innerHTML = ''
            + '<div class="toast__body">'
            + '<div class="toast__title"></div>'
            + '<div class="toast__message"></div>'
            + '</div>'
            + '<button class="toast__close" type="button" aria-label="Dismiss">&times;</button>';
        // textContent, not innerHTML: event titles are user input.
        node.querySelector(".toast__title").textContent = title;
        node.querySelector(".toast__message").textContent = message || "";
        node.querySelector(".toast__close").addEventListener("click", function () {
            dismiss(node);
        });
        container.appendChild(node);
        window.setTimeout(function () {
            dismiss(node);
        }, (seconds || 15) * 1000);
        return node;
    }

    function init() {
        container = document.getElementById("toasts");
    }

    return { init: init, show: show };
})();
