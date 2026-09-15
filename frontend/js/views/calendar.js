/* Calendar and Scheduling - Outlook/Teams style.

   Day, Week and Month views filling the whole content area. Week and Day are
   time grids: hour rows down the left, one column per day, events drawn as
   blocks positioned by their start and duration, overlapping events split
   side by side.

   Times are local wall-clock strings ("2026-09-12T15:00") end to end, the
   same format SQLite stores, so no timezone conversion happens between the
   form and the database. */
window.PA = window.PA || {};
PA.views = PA.views || {};

PA.views.calendar = (function () {
    var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday",
        "Thursday", "Friday", "Saturday"];
    var MONTHS = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    var REMINDERS = [
        ["none", "No reminder"],
        ["0", "At start time"],
        ["5", "5 minutes before"],
        ["10", "10 minutes before"],
        ["15", "15 minutes before"],
        ["30", "30 minutes before"],
        ["60", "1 hour before"],
        ["1440", "1 day before"]
    ];
    var VIEW_KEY = "calendar.view";
    var DEFAULT_HOUR = 48;      // fallback if the CSS variable cannot be read
    var SCROLL_TO_HOUR = 7;     // where the time grid opens, like Outlook
    var MIN_BLOCK = 22;         // a 15 minute event still needs to be legible

    var root = null;
    var tickTimer = null;
    var state = {
        view: "week",
        anchor: null,      // reference date for the shown range
        selected: null,    // "YYYY-MM-DD"
        events: [],
        editing: null,     // event object, {} for a new one, null when closed
        error: "",
        scrolled: false
    };

    // --- date helpers (all local, no UTC) ------------------------------
    function pad(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function dateKey(date) {
        return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
    }

    function parseKey(key) {
        var bits = key.split("-");
        return new Date(+bits[0], +bits[1] - 1, +bits[2]);
    }

    function addDays(date, count) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
    }

    function addMonths(date, count) {
        return new Date(date.getFullYear(), date.getMonth() + count, 1);
    }

    function startOfWeek(date) {
        return addDays(date, -date.getDay());     // Sunday-first weeks
    }

    function startOfMonth(date) {
        return new Date(date.getFullYear(), date.getMonth(), 1);
    }

    function sameDay(a, b) {
        return dateKey(a) === dateKey(b);
    }

    function dayOf(iso) {
        return iso ? iso.split("T")[0] : "";
    }

    function timeOf(iso) {
        return (iso && iso.indexOf("T") !== -1) ? iso.split("T")[1].slice(0, 5) : "";
    }

    function minutesOf(iso) {
        var time = timeOf(iso);
        if (!time) {
            return 0;
        }
        var bits = time.split(":");
        return (+bits[0]) * 60 + (+bits[1]);
    }

    function isoAt(key, time) {
        return key + "T" + (time || "00:00");
    }

    function hourLabel(hour) {
        if (hour === 0 || hour === 24) {
            return "";
        }
        var suffix = hour < 12 ? "AM" : "PM";
        var display = hour % 12 === 0 ? 12 : hour % 12;
        return display + " " + suffix;
    }

    function escapeHtml(value) {
        return String(value === null || value === undefined ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function reminderLabel(value) {
        for (var i = 0; i < REMINDERS.length; i++) {
            if (REMINDERS[i][0] === value) {
                return REMINDERS[i][1];
            }
        }
        return "Reminder set";
    }

    // --- range shown by the current view -------------------------------
    function rangeStart() {
        if (state.view === "day") {
            return new Date(state.anchor.getTime());
        }
        if (state.view === "week") {
            return startOfWeek(state.anchor);
        }
        return startOfWeek(startOfMonth(state.anchor));   // month grid leads in
    }

    function rangeDays() {
        if (state.view === "day") {
            return 1;
        }
        return state.view === "week" ? 7 : 42;
    }

    function rangeTitle() {
        var start = rangeStart();
        if (state.view === "day") {
            return WEEKDAYS_LONG[start.getDay()] + ", " + start.getDate() + " "
                + MONTHS[start.getMonth()] + " " + start.getFullYear();
        }
        if (state.view === "month") {
            return MONTHS[state.anchor.getMonth()] + " " + state.anchor.getFullYear();
        }
        var end = addDays(start, 6);
        if (start.getMonth() === end.getMonth()) {
            return start.getDate() + " - " + end.getDate() + " "
                + MONTHS[start.getMonth()] + " " + start.getFullYear();
        }
        return start.getDate() + " " + MONTHS[start.getMonth()] + " - "
            + end.getDate() + " " + MONTHS[end.getMonth()] + " " + end.getFullYear();
    }

    function step(direction) {
        if (state.view === "day") {
            state.anchor = addDays(state.anchor, direction);
        } else if (state.view === "week") {
            state.anchor = addDays(state.anchor, direction * 7);
        } else {
            state.anchor = addMonths(state.anchor, direction);
        }
        // The scroll position is deliberately kept: paging to next week
        // should not yank the user back to the default hour.
    }

    // --- data ----------------------------------------------------------
    function load() {
        var calendar = PA.bridge.get("calendar");
        if (!calendar) {
            PA.bridge.onReady(load);
            return;
        }
        var start = rangeStart();
        var from = dateKey(start) + "T00:00";
        var to = dateKey(addDays(start, rangeDays())) + "T00:00";
        calendar.listEvents(from, to, function (raw) {
            PA.bridge.unwrap(raw, function (events) {
                state.events = events || [];
                state.error = "";
                render();
            }, function (message) {
                state.error = message;
                render();
            });
        });
    }

    function eventsOn(key) {
        var list = [];
        for (var i = 0; i < state.events.length; i++) {
            if (dayOf(state.events[i].starts_at) === key) {
                list.push(state.events[i]);
            }
        }
        return list;
    }

    function save(payload) {
        var calendar = PA.bridge.get("calendar");
        if (!calendar) {
            return;
        }
        calendar.saveEvent(JSON.stringify(payload), function (raw) {
            PA.bridge.unwrap(raw, function () {
                state.editing = null;
                state.error = "";
                load();
            }, function (message) {
                state.error = message;
                render();
            });
        });
    }

    function remove(id) {
        var calendar = PA.bridge.get("calendar");
        if (!calendar || !window.confirm("Delete this event?")) {
            return;
        }
        calendar.deleteEvent(id, function (raw) {
            PA.bridge.unwrap(raw, function () {
                state.editing = null;
                load();
            }, function (message) {
                state.error = message;
                render();
            });
        });
    }

    // --- laying out overlapping blocks ---------------------------------
    function layoutDay(items) {
        var blocks = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].all_day) {
                continue;
            }
            var start = minutesOf(items[i].starts_at);
            var end = items[i].ends_at ? minutesOf(items[i].ends_at) : start + 30;
            blocks.push({
                event: items[i],
                start: start,
                end: Math.max(end, start + 15)
            });
        }
        blocks.sort(function (a, b) {
            return a.start - b.start || b.end - a.end;
        });

        // Walk the day, gathering runs of mutually overlapping blocks. Each
        // run is packed into as few columns as it needs; every block in the
        // run then takes 1/columns of the width.
        var cluster = [];
        var clusterEnd = -1;

        function flush() {
            if (!cluster.length) {
                return;
            }
            var columnEnds = [];
            for (var c = 0; c < cluster.length; c++) {
                var placed = false;
                for (var col = 0; col < columnEnds.length; col++) {
                    if (columnEnds[col] <= cluster[c].start) {
                        cluster[c].column = col;
                        columnEnds[col] = cluster[c].end;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    cluster[c].column = columnEnds.length;
                    columnEnds.push(cluster[c].end);
                }
            }
            for (var k = 0; k < cluster.length; k++) {
                cluster[k].columns = columnEnds.length;
            }
            cluster = [];
        }

        for (var b = 0; b < blocks.length; b++) {
            if (cluster.length && blocks[b].start >= clusterEnd) {
                flush();
                clusterEnd = -1;
            }
            cluster.push(blocks[b]);
            clusterEnd = Math.max(clusterEnd, blocks[b].end);
        }
        flush();
        return blocks;
    }

    function hourHeight() {
        if (!root) {
            return DEFAULT_HOUR;
        }
        var shell = root.querySelector(".cal");
        if (!shell) {
            return DEFAULT_HOUR;
        }
        var value = parseFloat(getComputedStyle(shell).getPropertyValue("--cal-hour"));
        return value || DEFAULT_HOUR;
    }

    // --- rendering: toolbar --------------------------------------------
    function toolbarMarkup() {
        var views = [["day", "Day"], ["week", "Week"], ["month", "Month"]];
        var switcher = "";
        for (var i = 0; i < views.length; i++) {
            switcher += '<button class="seg__btn' + (state.view === views[i][0] ? " is-active" : "")
                + '" type="button" data-view-mode="' + views[i][0] + '">' + views[i][1] + '</button>';
        }
        return '<div class="cal__bar">'
            + '<button class="btn btn--ghost btn--sm" type="button" data-action="today">Today</button>'
            + '<div class="cal__steps">'
            + '<button class="icon-btn" type="button" data-action="prev" aria-label="Previous">&#8249;</button>'
            + '<button class="icon-btn" type="button" data-action="next" aria-label="Next">&#8250;</button>'
            + '</div>'
            + '<h2 class="cal__title">' + rangeTitle() + '</h2>'
            + '<div class="seg" role="group" aria-label="View">' + switcher + '</div>'
            + '<button class="btn btn--primary btn--sm cal__new" type="button" data-action="new">New event</button>'
            + '</div>';
    }

    // --- rendering: time grid (day + week) ------------------------------
    function timeGridMarkup() {
        var start = rangeStart();
        var days = rangeDays();
        var today = new Date();
        var i, hour;

        var head = '<div class="grid__head">'
            + '<div class="grid__corner"></div>';
        var allDayRow = '<div class="grid__allday"><div class="grid__corner grid__corner--allday">All day</div>';

        for (i = 0; i < days; i++) {
            var day = addDays(start, i);
            var key = dateKey(day);
            var isToday = sameDay(day, today);
            head += '<div class="grid__day' + (isToday ? " is-today" : "") + '" data-day="' + key + '">'
                + '<span class="grid__dayname">' + WEEKDAYS[day.getDay()] + '</span>'
                + '<span class="grid__daynum">' + day.getDate() + '</span>'
                + '</div>';

            var allDayItems = eventsOn(key);
            var chips = "";
            for (var a = 0; a < allDayItems.length; a++) {
                if (allDayItems[a].all_day) {
                    chips += '<span class="allday-chip" data-edit="' + allDayItems[a].id + '" title="'
                        + escapeHtml(allDayItems[a].title) + '">'
                        + escapeHtml(allDayItems[a].title) + '</span>';
                }
            }
            allDayRow += '<div class="grid__alldaycell" data-day="' + key + '" data-allday="1">'
                + chips + '</div>';
        }
        head += '</div>';
        allDayRow += '</div>';

        var gutter = '<div class="grid__gutter">';
        for (hour = 0; hour < 24; hour++) {
            gutter += '<div class="grid__hour"><span>' + hourLabel(hour) + '</span></div>';
        }
        gutter += '</div>';

        var columns = "";
        for (i = 0; i < days; i++) {
            var colDay = addDays(start, i);
            var colKey = dateKey(colDay);
            var blocks = layoutDay(eventsOn(colKey));
            var isNow = sameDay(colDay, today);
            columns += '<div class="grid__col' + (isNow ? " is-today" : "") + '" data-day="' + colKey + '">';
            for (var b = 0; b < blocks.length; b++) {
                columns += blockMarkup(blocks[b]);
            }
            if (isNow) {
                columns += '<div class="grid__now" data-now="1"></div>';
            }
            columns += '</div>';
        }

        // Header, all-day strip and body live inside the same scroller so
        // they share a width: a header outside it would be wider by exactly
        // the scrollbar and every column would sit askew.
        return '<div class="grid" data-days="' + days + '">'
            + '<div class="grid__scroll">'
            + head + allDayRow
            + '<div class="grid__body">' + gutter + columns + '</div>'
            + '</div></div>';
    }

    function blockMarkup(block) {
        var event = block.event;
        var hour = hourHeight();
        var top = (block.start / 60) * hour;
        var height = Math.max(((block.end - block.start) / 60) * hour, MIN_BLOCK);
        var width = 100 / block.columns;
        var left = width * block.column;
        var compact = height < 34 ? " is-compact" : "";
        var hasReminder = event.remind_minutes !== null && event.remind_minutes !== undefined;

        return '<div class="ev' + compact + '" data-edit="' + event.id + '"'
            + ' style="top:' + top + 'px;height:' + height + 'px;'
            + 'left:calc(' + left + '% + 2px);width:calc(' + width + '% - 5px);"'
            + ' title="' + escapeHtml(timeOf(event.starts_at) + " " + event.title) + '">'
            + '<span class="ev__title">' + escapeHtml(event.title) + '</span>'
            + '<span class="ev__time">' + escapeHtml(timeOf(event.starts_at))
            + (event.ends_at ? " - " + escapeHtml(timeOf(event.ends_at)) : "")
            + (hasReminder ? ' &#9200;' : "")
            + '</span></div>';
    }

    // --- rendering: month ----------------------------------------------
    function monthMarkup() {
        var start = rangeStart();
        var today = new Date();
        var shownMonth = state.anchor.getMonth();
        var html = '<div class="month">';

        html += '<div class="month__head">';
        for (var w = 0; w < 7; w++) {
            html += '<div class="month__weekday">' + WEEKDAYS[w] + '</div>';
        }
        html += '</div><div class="month__grid">';

        for (var cell = 0; cell < 42; cell++) {
            var day = addDays(start, cell);
            var key = dateKey(day);
            var items = eventsOn(key);
            var classes = "month__cell";
            if (day.getMonth() !== shownMonth) {
                classes += " is-outside";
            }
            if (sameDay(day, today)) {
                classes += " is-today";
            }
            if (key === state.selected) {
                classes += " is-selected";
            }

            html += '<div class="' + classes + '" data-day="' + key + '">'
                + '<div class="month__date">' + day.getDate() + '</div>'
                + '<div class="month__events">';
            for (var e = 0; e < Math.min(items.length, 3); e++) {
                html += '<span class="month__chip' + (items[e].all_day ? " is-allday" : "")
                    + '" data-edit="' + items[e].id + '" title="'
                    + escapeHtml((items[e].all_day ? "All day" : timeOf(items[e].starts_at)) + " - " + items[e].title) + '">'
                    + (items[e].all_day ? "" : '<span class="month__chiptime">'
                        + escapeHtml(timeOf(items[e].starts_at)) + '</span> ')
                    + escapeHtml(items[e].title) + '</span>';
            }
            if (items.length > 3) {
                html += '<span class="month__more" data-day="' + key + '" data-more="1">+'
                    + (items.length - 3) + ' more</span>';
            }
            html += '</div></div>';
        }
        return html + '</div></div>';
    }

    // --- rendering: event dialog ----------------------------------------
    function dialogMarkup() {
        var event = state.editing || {};
        var isNew = !event.id;
        var day = dayOf(event.starts_at) || state.selected || dateKey(new Date());
        var startTime = timeOf(event.starts_at) || "09:00";
        var endTime = timeOf(event.ends_at) || "";
        var remind = (event.remind_minutes === null || event.remind_minutes === undefined)
            ? "none"
            : String(event.remind_minutes);

        var options = "";
        for (var i = 0; i < REMINDERS.length; i++) {
            options += '<option value="' + REMINDERS[i][0] + '"'
                + (REMINDERS[i][0] === remind ? " selected" : "") + '>'
                + REMINDERS[i][1] + '</option>';
        }

        return '<div class="modal" data-action="backdrop">'
            + '<form class="modal__card card" data-stop="1">'
            + '<div class="modal__head">'
            + '<h3 class="modal__title">' + (isNew ? "New event" : "Edit event") + '</h3>'
            + '<button class="modal__close" type="button" data-action="cancel" aria-label="Close">&times;</button>'
            + '</div>'
            + (state.error ? '<p class="form-error">' + escapeHtml(state.error) + '</p>' : "")
            + '<label class="label" for="evTitle">Title</label>'
            + '<input class="input" id="evTitle" value="' + escapeHtml(event.title || "") + '" placeholder="Add a title" />'
            + '<label class="checkbox"><input type="checkbox" id="evAllDay"'
            + (event.all_day ? " checked" : "") + ' /> <span>All day</span></label>'
            + '<div class="form-row">'
            + '<div><label class="label" for="evDate">Date</label>'
            + '<input class="input" type="date" id="evDate" value="' + day + '" /></div>'
            + '<div class="time-fields">'
            + '<div><label class="label" for="evStart">Start</label>'
            + '<input class="input" type="time" id="evStart" value="' + startTime + '" /></div>'
            + '<div><label class="label" for="evEnd">End</label>'
            + '<input class="input" type="time" id="evEnd" value="' + endTime + '" /></div>'
            + '</div></div>'
            + '<label class="label" for="evRemind">Reminder</label>'
            + '<select class="input select" id="evRemind">' + options + '</select>'
            + '<label class="label" for="evNote">Notes</label>'
            + '<textarea class="input textarea" id="evNote" rows="3">' + escapeHtml(event.description || "") + '</textarea>'
            + '<div class="form-actions">'
            + '<button class="btn btn--primary" type="submit">' + (isNew ? "Create" : "Save") + '</button>'
            + '<button class="btn btn--ghost" type="button" data-action="cancel">Cancel</button>'
            + (isNew ? "" : '<button class="btn btn--ghost" type="button" data-delete="' + event.id + '">Delete</button>')
            + '</div></form></div>';
    }

    // --- render ----------------------------------------------------------
    function render() {
        if (!root) {
            return;
        }
        var body = state.view === "month" ? monthMarkup() : timeGridMarkup();
        root.innerHTML = '<div class="cal">'
            + toolbarMarkup()
            + '<div class="cal__body">' + body + '</div>'
            + (state.error && !state.editing
                ? '<p class="form-error cal__error">' + escapeHtml(state.error) + '</p>' : "")
            + '</div>'
            + (state.editing ? dialogMarkup() : "");

        if (state.view !== "month") {
            positionNow();
            var scroll = root.querySelector(".grid__scroll");
            if (scroll) {
                // innerHTML wipes the scroll position on every render, and a
                // render always follows load(), so the offset is kept in
                // state rather than read back off the element.
                if (!state.scrolled) {
                    // A few pixels back so the hour label, which sits above
                    // its line, is not clipped by the sticky header.
                    state.scrollTop = SCROLL_TO_HOUR * hourHeight() - 8;
                    state.scrolled = true;
                }
                scroll.scrollTop = state.scrollTop || 0;
                scroll.addEventListener("scroll", function () {
                    state.scrollTop = scroll.scrollTop;
                });
            }
        }

        if (state.editing) {
            var title = document.getElementById("evTitle");
            if (title) {
                title.focus();
            }
        }
    }

    function positionNow() {
        if (!root) {
            return;
        }
        var marker = root.querySelector("[data-now]");
        if (!marker) {
            return;
        }
        var now = new Date();
        var minutes = now.getHours() * 60 + now.getMinutes();
        marker.style.top = ((minutes / 60) * hourHeight()) + "px";
    }

    // --- interaction -----------------------------------------------------
    function findEvent(id) {
        for (var i = 0; i < state.events.length; i++) {
            if (String(state.events[i].id) === String(id)) {
                return state.events[i];
            }
        }
        return null;
    }

    function openNew(day, time) {
        state.editing = { starts_at: isoAt(day || state.selected || dateKey(new Date()), time || "09:00") };
        state.error = "";
        render();
    }

    function timeFromClick(column, clientY) {
        var box = column.getBoundingClientRect();
        var minutes = ((clientY - box.top) / hourHeight()) * 60;
        minutes = Math.max(0, Math.min(23 * 60 + 30, minutes));
        var rounded = Math.floor(minutes / 30) * 30;     // half-hour slots
        return pad(Math.floor(rounded / 60)) + ":" + pad(rounded % 60);
    }

    function submitForm() {
        var allDay = document.getElementById("evAllDay").checked;
        var day = document.getElementById("evDate").value || state.selected;
        var start = allDay ? "00:00" : (document.getElementById("evStart").value || "00:00");
        var end = document.getElementById("evEnd").value;
        var remind = document.getElementById("evRemind").value;

        save({
            id: (state.editing && state.editing.id) ? state.editing.id : null,
            title: document.getElementById("evTitle").value,
            description: document.getElementById("evNote").value,
            starts_at: isoAt(day, start),
            ends_at: (allDay || !end) ? null : isoAt(day, end),
            all_day: allDay,
            remind_minutes: remind
        });
    }

    function rememberScroll() {
        var scroll = root && root.querySelector(".grid__scroll");
        if (scroll) {
            state.scrollTop = scroll.scrollTop;
        }
    }

    function onClick(event) {
        var node = event.target;
        while (node && node !== root) {
            if (!node.getAttribute) {
                node = node.parentNode;
                continue;
            }

            // Editing an existing event wins over the cell underneath it.
            var editId = node.getAttribute("data-edit");
            if (editId) {
                state.editing = findEvent(editId);
                state.error = "";
                rememberScroll();
                return render();
            }
            if (node.getAttribute("data-delete")) {
                return remove(parseInt(node.getAttribute("data-delete"), 10));
            }

            var mode = node.getAttribute("data-view-mode");
            if (mode && mode !== state.view) {
                state.view = mode;
                state.scrolled = false;
                try {
                    localStorage.setItem(VIEW_KEY, mode);
                } catch (e) { /* storage disabled */ }
                return load();
            }

            var action = node.getAttribute("data-action");
            if (action === "prev") { step(-1); return load(); }
            if (action === "next") { step(1); return load(); }
            if (action === "today") {
                state.anchor = new Date();
                state.selected = dateKey(state.anchor);
                return load();
            }
            if (action === "new") { return openNew(state.selected, "09:00"); }
            if (action === "cancel" || action === "backdrop") {
                state.editing = null;
                state.error = "";
                return render();
            }
            if (node.getAttribute("data-stop")) {
                return;     // clicks inside the dialog must not close it
            }

            if (node.getAttribute("data-more")) {
                state.view = "day";
                state.anchor = parseKey(node.getAttribute("data-day"));
                state.selected = node.getAttribute("data-day");
                state.scrolled = false;
                return load();
            }

            // Empty space: start a new event at that day and time.
            var day = node.getAttribute("data-day");
            if (day) {
                if (node.getAttribute("data-allday") !== null
                        && node.getAttribute("data-allday") === "1") {
                    state.selected = day;
                    state.editing = { starts_at: isoAt(day, "00:00"), all_day: true };
                    state.error = "";
                    rememberScroll();
                    return render();
                }
                state.selected = day;
                if (node.className.indexOf("grid__col") !== -1) {
                    rememberScroll();
                    return openNew(day, timeFromClick(node, event.clientY));
                }
                if (node.className.indexOf("month__cell") !== -1) {
                    return openNew(day, "09:00");
                }
                if (node.className.indexOf("grid__day") !== -1) {
                    state.view = "day";
                    state.anchor = parseKey(day);
                    state.scrolled = false;
                    return load();
                }
            }
            node = node.parentNode;
        }
    }

    function onSubmit(event) {
        event.preventDefault();
        submitForm();
    }

    function onKeydown(event) {
        if (event.key === "Escape" && state.editing) {
            state.editing = null;
            render();
        }
    }

    function mount(container) {
        root = container;
        var today = new Date();
        if (!state.anchor) {
            state.anchor = today;
            state.selected = dateKey(today);
        }
        try {
            var saved = localStorage.getItem(VIEW_KEY);
            if (saved === "day" || saved === "week" || saved === "month") {
                state.view = saved;
            }
        } catch (e) { /* storage disabled */ }

        // The calendar wants the whole content area, not a padded card.
        var content = document.querySelector(".content");
        if (content) {
            content.className += " is-fullbleed";
        }

        root.addEventListener("click", onClick);
        root.addEventListener("submit", onSubmit);
        document.addEventListener("keydown", onKeydown);
        tickTimer = window.setInterval(positionNow, 60 * 1000);

        render();
        load();
    }

    function unmount() {
        if (root) {
            root.removeEventListener("click", onClick);
            root.removeEventListener("submit", onSubmit);
        }
        document.removeEventListener("keydown", onKeydown);
        if (tickTimer) {
            window.clearInterval(tickTimer);
            tickTimer = null;
        }
        var content = document.querySelector(".content");
        if (content) {
            content.className = content.className.replace(/\s*is-fullbleed/, "");
        }
        root = null;
    }

    function refresh() {
        if (root) {
            load();
        }
    }

    return { mount: mount, unmount: unmount, refresh: refresh };
})();
