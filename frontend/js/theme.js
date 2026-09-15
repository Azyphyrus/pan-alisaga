/* Theme switch. tokens.css keys off data-theme on the root element; this
   drives that attribute and keeps every toggle control in sync. */
window.PA = window.PA || {};

PA.theme = (function () {
    var root = document.documentElement;

    function store(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            /* storage disabled: the switch still works for this session */
        }
    }

    function read(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    function applyTheme(theme) {
        root.setAttribute("data-theme", theme);
        var label = theme === "dark" ? "Light" : "Dark";
        var labels = document.querySelectorAll("[data-theme-label]");
        for (var i = 0; i < labels.length; i++) {
            labels[i].textContent = label;
        }
        store("theme", theme);
    }


    function init() {
        applyTheme(read("theme") === "dark" ? "dark" : "light");

        var themeButtons = document.querySelectorAll("[data-theme-toggle]");
        for (var i = 0; i < themeButtons.length; i++) {
            themeButtons[i].addEventListener("click", function () {
                applyTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
            });
        }

    }

    return { init: init, applyTheme: applyTheme };
})();
