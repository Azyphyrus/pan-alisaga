/* Builds the sidebar DOM from PA.tools, and owns section collapsing. */
window.PA = window.PA || {};

PA.nav = (function () {
    var SVG_OPEN = '<svg class="nav-item__icon" viewBox="0 0 24 24" fill="none"'
        + ' stroke="currentColor" stroke-width="1.6" stroke-linecap="round"'
        + ' stroke-linejoin="round" aria-hidden="true">';

    function itemMarkup(tool) {
        // title= gives a native tooltip, which is how labels stay reachable
        // in rail mode where the text is hidden.
        return '<button class="nav-item" type="button" data-view="' + tool.id + '"'
            + ' data-label="' + tool.label + '" title="' + tool.label + '">'
            + SVG_OPEN + tool.icon + '</svg>'
            + '<span class="nav-item__label">' + tool.label + '</span>'
            + '</button>';
    }

    var COLLAPSED_KEY = "nav.collapsedGroups";

    function readCollapsed() {
        try {
            return JSON.parse(localStorage.getItem(COLLAPSED_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function writeCollapsed(map) {
        try {
            localStorage.setItem(COLLAPSED_KEY, JSON.stringify(map));
        } catch (e) {
            /* storage disabled: collapsing still works for this session */
        }
    }

    var CHEVRON = '<svg class="nav-group__chevron" viewBox="0 0 24 24" fill="none"'
        + ' stroke="currentColor" stroke-width="2" stroke-linecap="round"'
        + ' stroke-linejoin="round" aria-hidden="true"><path d="M8 10l4 4 4-4"/></svg>';

    function groupMarkup(group, collapsed) {
        var isCollapsed = !!collapsed[group.id];
        var html = '<div class="nav-group' + (isCollapsed ? " is-collapsed" : "") + '"'
            + ' data-group-id="' + group.id + '">'
            + '<button class="nav-group__label" type="button" data-group="' + group.id + '"'
            + ' aria-expanded="' + (!isCollapsed) + '">'
            + '<span>' + group.label + '</span>' + CHEVRON
            + '</button>'
            + '<div class="nav-group__items">';
        for (var j = 0; j < group.items.length; j++) {
            html += itemMarkup(group.items[j]);
        }
        return html + '</div></div>';
    }

    function toggleGroup(id) {
        var collapsed = readCollapsed();
        collapsed[id] = !collapsed[id];
        writeCollapsed(collapsed);

        var group = document.querySelector('.nav-group[data-group-id="' + id + '"]');
        if (!group) {
            return;
        }
        var button = group.querySelector(".nav-group__label");
        if (collapsed[id]) {
            group.className += " is-collapsed";
        } else {
            group.className = group.className.replace(/\s*is-collapsed/, "");
        }
        button.setAttribute("aria-expanded", String(!collapsed[id]));
    }

    function render() {
        var tools = PA.tools;
        var collapsed = readCollapsed();
        var html = itemMarkup(tools.HOME);

        for (var i = 0; i < tools.GROUPS.length; i++) {
            html += groupMarkup(tools.GROUPS[i], collapsed);
        }

        var nav = document.getElementById("nav");
        nav.innerHTML = html;
        document.getElementById("navFooter").innerHTML = itemMarkup(tools.SETTINGS);

        nav.addEventListener("click", function (event) {
            var node = event.target;
            while (node && node !== nav) {
                if (node.getAttribute && node.getAttribute("data-group")) {
                    toggleGroup(node.getAttribute("data-group"));
                    return;
                }
                node = node.parentNode;
            }
        });
    }

    return { render: render, toggleGroup: toggleGroup };
})();
