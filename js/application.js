window.requestAnimationFrame(function () {
  var soundManager = new SoundManager();
  var leaderboard = new LeaderboardManager();
  var gameManager = new GameManager(6, KeyboardInputManager, HTMLActuator,
    LocalStorageManager, {
      soundManager: soundManager,
      leaderboard: leaderboard
    });

  leaderboard.gameManager = gameManager;

  var storage = gameManager.storageManager;
  var settings = storage.getSettings();
  if (settings.theme === "light") document.body.classList.add("theme-light");

  var soundButton = document.querySelector("#sound-toggle");
  soundButton.classList.toggle("is-muted", !soundManager.enabled);
  soundButton.setAttribute("aria-label", soundManager.enabled ? "Turn sound off" : "Turn sound on");
  soundButton.addEventListener("click", function () {
    var enabled = soundManager.toggle();
    soundButton.classList.toggle("is-muted", !enabled);
    soundButton.setAttribute("aria-label", enabled ? "Turn sound off" : "Turn sound on");
    leaderboard.showToast(enabled ? "Sound effects on." : "Sound effects off.");
  });

  var themeButton = document.querySelector("#theme-toggle");
  themeButton.addEventListener("click", function () {
    var light = document.body.classList.toggle("theme-light");
    settings.theme = light ? "light" : "dark";
    storage.setSettings(settings);
    themeButton.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
  });

  if (window.innerWidth <= 820) {
    document.querySelector(".leaderboard-panel").classList.add("is-collapsed");
  }

  leaderboard.init().then(function () {
    if (leaderboard.isAuthenticated()) gameManager.requestRankedSession();
  }).catch(function (error) {
    if (window.console && console.error) console.error("Arena initialization failed:", error);
  });
});
