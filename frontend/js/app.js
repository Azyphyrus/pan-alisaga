/* Entry point: initialises each module and wires reminders. */
(function () {
    /*
     * Place the sound file at:
     *
     * frontend/assets/reminder.mp3
     */
    var reminderSound = new Audio("assets/reminder.mp3");

    reminderSound.preload = "auto";
    reminderSound.loop = true;
    reminderSound.volume = 0.8;

    var audioUnlocked = false;

    function unlockReminderSound() {
        if (audioUnlocked) {
            return;
        }

        audioUnlocked = true;

        /*
         * Some webview engines require user interaction before audio
         * playback is allowed.
         */
        var originalVolume = reminderSound.volume;

        reminderSound.volume = 0;

        var playback = reminderSound.play();

        if (playback && playback.then) {
            playback.then(function () {
                reminderSound.pause();
                reminderSound.currentTime = 0;
                reminderSound.volume = originalVolume;
            }).catch(function () {
                reminderSound.volume = originalVolume;
            });
        } else {
            reminderSound.pause();
            reminderSound.currentTime = 0;
            reminderSound.volume = originalVolume;
        }
    }

    function playReminderSound() {
        reminderSound.pause();
        reminderSound.currentTime = 0;
        reminderSound.loop = true;
        reminderSound.volume = 0.8;

        var playback = reminderSound.play();

        if (playback && playback.catch) {
            playback.catch(function (error) {
                console.warn("Reminder sound could not play:", error);
            });
        }
    }

    function stopReminderSound() {
        reminderSound.pause();
        reminderSound.currentTime = 0;
    }

    /*
     * Unlock audio after the first user interaction.
     */
    document.addEventListener("click", unlockReminderSound, {
        once: true,
        passive: true
    });

    document.addEventListener("keydown", unlockReminderSound, {
        once: true,
        passive: true
    });

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

    PA.bridge.onReady(function (objects) {
        if (!objects.calendar) {
            return;
        }

        objects.calendar.reminderFired.connect(function (payload) {
            var event;

            try {
                event = JSON.parse(payload);
            } catch (error) {
                console.error("Could not parse reminder payload:", error);
                return;
            }

            /*
             * Start looping the reminder sound.
             */
            playReminderSound();

            var when;

            if (event.all_day) {
                when = "All day today";
            } else {
                var startTime = event.starts_at || "";

                if (startTime.indexOf("T") !== -1) {
                    startTime = startTime.split("T")[1];
                }

                when = "Starts at " + startTime;
            }

            var detail = event.description
                ? when + "\n" + event.description
                : when;

            /*
             * Passing 0 prevents automatic dismissal.
             * The sound stops through stopReminderSound when X is clicked.
             */
            PA.toast.show(
                event.title || "Calendar reminder",
                detail,
                0,
                stopReminderSound
            );
        });

        objects.calendar.eventsChanged.connect(function () {
            if (
                PA.router.current() === "calendar" &&
                PA.views.calendar.refresh
            ) {
                PA.views.calendar.refresh();
            }
        });
    });

    document.getElementById("greetBtn").addEventListener("click", function () {
        var name = document.getElementById("nameInput").value || "stranger";
        PA.bridge.greet(name, show);
    });
})();