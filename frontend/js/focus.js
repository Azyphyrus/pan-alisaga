/* Chromium 83 has no :focus-visible, so a plain :focus ring also fires on
   mouse clicks and stays stuck on the clicked control. Track the input
   modality on the root element and let CSS show the ring for keyboard
   navigation only. */
window.PA = window.PA || {};

PA.focus = (function () {
    var root = document.documentElement;

    function pointer() {
        root.setAttribute("data-input", "pointer");
    }

    function keyboard(event) {
        if (!event.key) {
            return;
        }
        if (event.key === "Tab" || event.key.indexOf("Arrow") === 0) {
            root.setAttribute("data-input", "keyboard");
        }
    }

    function init() {
        pointer();
        /* Capture phase: the modality must be set before focus moves. */
        document.addEventListener("mousedown", pointer, true);
        document.addEventListener("keydown", keyboard, true);
    }

    return { init: init };
})();
