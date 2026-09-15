/* Entry point: initialises each module and wires the greet demo. */
(function () {
    PA.focus.init();
    PA.toast.init();
    PA.theme.init();
    PA.nav.render();
    PA.sidebar.init();
    PA.router.init();
    PA.bridge.init();

    var output = document.getElementById("output");

    function show(message) {
        output.textContent = message;
        output.hidden = false;
    }

    // A due reminder arrives here as well as in the desktop toast, so it is
    // visible when the window already has focus.
    PA.bridge.onReady(function (objects) {
        if (!objects.calendar) {
            return;
        }
        objects.calendar.reminderFired.connect(function (payload) {
            var event = JSON.parse(payload);
            var when = event.all_day ? "All day today" : "Starts at " + event.starts_at.split("T")[1];
            var detail = event.description ? when + "\n" + event.description : when;
            PA.toast.show(event.title, detail);
        });
        objects.calendar.eventsChanged.connect(function () {
            if (PA.router.current() === "calendar" && PA.views.calendar.refresh) {
                PA.views.calendar.refresh();
            }
        });
    });

    document.getElementById("greetBtn").addEventListener("click", function () {
        var name = document.getElementById("nameInput").value || "stranger";
        PA.bridge.greet(name, show);
    });
})();
