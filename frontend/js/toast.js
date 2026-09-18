/* In-app reminder banner, shown alongside the desktop notification. */
window.PA = window.PA || {};

PA.toast = (function () {
    var container;

    function dismiss(node, onDismiss) {
        if (node && node.parentNode) {
            node.parentNode.removeChild(node);
        }

        if (typeof onDismiss === "function") {
            onDismiss();
        }
    }

    /*
     * seconds:
     *   undefined or greater than 0 = automatically dismiss
     *   0 = stay visible until the X button is clicked
     *
     * onDismiss:
     *   optional callback called when the toast is dismissed
     */
    function show(title, message, seconds, onDismiss) {
        if (!container) {
            return null;
        }

        var node = document.createElement("div");
        node.className = "toast";
        node.setAttribute("role", "status");

        node.innerHTML = ""
            + '<div class="toast__body">'
            + '<div class="toast__title"></div>'
            + '<div class="toast__message"></div>'
            + "</div>"
            + '<button class="toast__close" type="button" aria-label="Dismiss">'
            + "&times;"
            + "</button>";

        // Use textContent because event titles and descriptions are user input.
        node.querySelector(".toast__title").textContent = title || "";
        node.querySelector(".toast__message").textContent = message || "";

        var dismissed = false;

        function closeToast() {
            if (dismissed) {
                return;
            }

            dismissed = true;
            dismiss(node, onDismiss);
        }

        node.querySelector(".toast__close").addEventListener(
            "click",
            closeToast
        );

        container.appendChild(node);

        /*
         * A value of 0 means this is a persistent reminder.
         * It will remain until the user clicks X.
         */
        if (seconds === undefined) {
            seconds = 15;
        }

        if (seconds > 0) {
            window.setTimeout(closeToast, seconds * 1000);
        }

        return {
            node: node,
            close: closeToast
        };
    }

    function init() {
        container = document.getElementById("toasts");
    }

    return {
        init: init,
        show: show
    };
})();