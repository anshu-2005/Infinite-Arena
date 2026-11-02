function SoundManager() {
  try {
    this.enabled = window.localStorage.getItem("arenaSound") !== "false";
  } catch (error) {
    this.enabled = true;
  }
  this.context = null;
}

SoundManager.prototype.toggle = function () {
  this.enabled = !this.enabled;
  try {
    window.localStorage.setItem("arenaSound", this.enabled);
  } catch (error) {
    if (window.console && console.error) console.error("Could not save sound preference:", error);
  }
  return this.enabled;
};

SoundManager.prototype.play = function (kind) {
  if (!this.enabled) return;

  var AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  if (!this.context) this.context = new AudioContext();
  if (this.context.state === "suspended") this.context.resume();

  var presets = {
    move: [330, 0.035, "sine"],
    merge: [540, 0.085, "triangle"],
    achievement: [740, 0.28, "sine"],
    champion: [880, 0.42, "triangle"]
  };
  var preset = presets[kind];
  if (!preset) return;

  var oscillator = this.context.createOscillator();
  var gain = this.context.createGain();
  var now = this.context.currentTime;

  oscillator.type = preset[2];
  oscillator.frequency.setValueAtTime(preset[0], now);
  if (kind === "achievement" || kind === "champion") {
    oscillator.frequency.exponentialRampToValueAtTime(preset[0] * 1.5, now + preset[1]);
  }
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(kind === "move" ? 0.025 : 0.07, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + preset[1]);
  oscillator.connect(gain);
  gain.connect(this.context.destination);
  oscillator.start(now);
  oscillator.stop(now + preset[1] + 0.02);
};
