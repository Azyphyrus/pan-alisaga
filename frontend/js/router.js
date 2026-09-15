/* Swaps views and keeps the sidebar and title in step.

   Home and Settings have hand-written markup; every tool shares one view
   that is filled from the manifest, so adding a tool needs no new HTML. */
window.PA = window.PA || {};

PA.router = (function () {
    var STATIC_VIEWS = ["home", "settings"];

    var views, title, toolView;
    var mounted = null;   // id of the view module currently mounted

    function isStatic(name) {
        return STATIC_VIEWS.indexOf(name) !== -1;
    }

    function renderTool(tool) {
            if (tool.id === "notepad") {
                toolView.innerHTML = "";
                PA.notesApp.init(toolView);
                return;
            }

            if (tool.id === "checklist") {
                toolView.innerHTML = "";
                PA.checklistApp.init(toolView);
                return;
            }

        var group = PA.tools.groupOf(tool.id);
        toolView.innerHTML = ''
            + '<div class="card">'
            + '<h2 class="card__title">' + tool.label + '</h2>'
            + '<p class="card__subtitle">'
            + (group ? group.label : "") + (tool.hint ? " &middot; " + tool.hint : "")
            + '</p>'
            + '<div class="empty">'
            + '<svg class="empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
            + ' stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + tool.icon + '</svg>'
            + '<p class="empty__text">Not built yet.</p>'
            + '</div>'
            + '</div>';
    }

    function show(name) {
        var tool = PA.tools.find(name);
        if (!tool) {
            return;
        }

        if (mounted && PA.views[mounted] && PA.views[mounted].unmount) {
            PA.views[mounted].unmount();
            mounted = null;
        }

        if (!isStatic(name)) {
            // A tool with a registered view module gets the real UI;
            // everything else falls back to the placeholder card.
            var module = PA.views && PA.views[name];
            if (module) {
                toolView.innerHTML = "";
                module.mount(toolView);
                mounted = name;
            } else {
                renderTool(tool);
            }
        }

        var target = isStatic(name) ? name : "tool";
        for (var i = 0; i < views.length; i++) {
            views[i].hidden = views[i].getAttribute("data-view") !== target;
        }

        var items = document.querySelectorAll(".nav-item[data-view]");
        for (var j = 0; j < items.length; j++) {
            if (items[j].getAttribute("data-view") === name) {
                items[j].setAttribute("aria-current", "page");
                // The list is taller than the sidebar at most window sizes,
                // so make sure the selected item is actually visible.
                if (items[j].scrollIntoView) {
                    items[j].scrollIntoView({ block: "nearest" });
                }
            } else {
                items[j].removeAttribute("aria-current");
            }
        }

        title.textContent = tool.label;

        // On narrow windows the drawer covers the content, so close it.
        if (PA.sidebar.mode() === "overlay") {
            PA.sidebar.close();
        }
    }

    function init() {
        views = document.querySelectorAll(".view");
        title = document.getElementById("viewTitle");
        toolView = document.querySelector('.view[data-view="tool"]');

        // One delegated listener, so nav items rendered later still work.
        document.getElementById("sidebar").addEventListener("click", function (event) {
            var node = event.target;
            while (node && node !== this) {
                if (node.classList && node.classList.contains("nav-item")) {
                    var view = node.getAttribute("data-view");
                    if (view) {
                        show(view);
                    }
                    return;
                }
                node = node.parentNode;
            }
        });

        show("home");
    }

    function current() {
        return mounted;
    }

    return { init: init, show: show, current: current };
})();