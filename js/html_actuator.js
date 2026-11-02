function HTMLActuator() {
  this.tileContainer    = document.querySelector(".tile-container");
  this.scoreContainer   = document.querySelector(".score-container");
  this.bestContainer    = document.querySelector(".best-container");
  this.messageContainer = document.querySelector(".game-message");
  this.timerCard        = document.querySelector("#timer-card");
  this.timerValue       = document.querySelector("#timer-value");
  this.undoButton       = document.querySelector("#undo-button");
  this.modeNote         = document.querySelector("#mode-note");
  this.toastContainer   = document.querySelector("#toast");
  this.achievement      = document.querySelector("#achievement-overlay");
  this.championOverlay  = document.querySelector("#champion-overlay");

  this.score = 0;
  this.lastBestScore = null;
  this.toastTimeout = null;
  this.achievementTimeout = null;
  this.championTimeout = null;
}

HTMLActuator.prototype.actuate = function (grid, metadata) {
  var self = this;
  window.requestAnimationFrame(function () {
    self.clearContainer(self.tileContainer);

    grid.cells.forEach(function (column) {
      column.forEach(function (cell) {
        if (cell) self.addTile(cell);
      });
    });

    self.updateScore(metadata.score);
    self.updateBestScore(metadata.bestScore);
    self.undoButton.disabled = !metadata.undoAvailable || metadata.sessionPending;
    self.undoButton.setAttribute("aria-disabled", self.undoButton.disabled);
    self.updateTimer(metadata.timeLeft);
    self.setMode(metadata.mode);

    if (metadata.terminated) {
      self.message(false);
    } else {
      self.clearMessage();
    }
  });
};

HTMLActuator.prototype.continueGame = function () {
  this.clearMessage();
};

HTMLActuator.prototype.clearContainer = function (container) {
  while (container.firstChild) container.removeChild(container.firstChild);
};

HTMLActuator.prototype.setTilePosition = function (element, position) {
  var cellWidth = "((100% - 5 * var(--grid-gap)) / 6)";
  element.style.left = "calc(" + cellWidth + " * " + position.x +
    " + var(--grid-gap) * " + position.x + ")";
  element.style.top = "calc(" + cellWidth + " * " + position.y +
    " + var(--grid-gap) * " + position.y + ")";
};

HTMLActuator.prototype.addTile = function (tile) {
  var self = this;
  var wrapper = document.createElement("div");
  var inner = document.createElement("div");
  var previousPosition = tile.previousPosition || { x: tile.x, y: tile.y };
  var classes = ["tile", "tile-" + tile.value];

  if (tile.value > 2048) classes.push("tile-super");
  wrapper.setAttribute("class", classes.join(" "));
  this.setTilePosition(wrapper, previousPosition);

  inner.classList.add("tile-inner");
  inner.textContent = tile.value;
  inner.setAttribute("aria-label", tile.value + " tile");

  if (tile.previousPosition) {
    window.requestAnimationFrame(function () {
      self.setTilePosition(wrapper, { x: tile.x, y: tile.y });
    });
  } else if (tile.mergedFrom) {
    wrapper.classList.add("tile-merged");
    tile.mergedFrom.forEach(function (merged) {
      self.addTile(merged);
    });
  } else {
    wrapper.classList.add("tile-new");
  }

  wrapper.appendChild(inner);
  this.tileContainer.appendChild(wrapper);
};

HTMLActuator.prototype.updateScore = function (score) {
  this.clearContainer(this.scoreContainer);
  var difference = score - this.score;
  this.score = score;
  this.scoreContainer.textContent = this.formatNumber(score);

  if (difference > 0) {
    var addition = document.createElement("div");
    addition.classList.add("score-addition");
    addition.textContent = "+" + this.formatNumber(difference);
    this.scoreContainer.appendChild(addition);
  }
};

HTMLActuator.prototype.updateBestScore = function (score) {
  this.bestContainer.textContent = this.formatNumber(score);
  if (this.lastBestScore !== null && score > this.lastBestScore) {
    var card = this.bestContainer.parentNode;
    card.classList.add("is-new-best");
    window.setTimeout(function () { card.classList.remove("is-new-best"); }, 1200);
    this.showToast("New personal best!");
  }
  this.lastBestScore = score;
};

HTMLActuator.prototype.formatNumber = function (value) {
  return Number(value).toLocaleString();
};

HTMLActuator.prototype.updateTimer = function (seconds) {
  if (!this.timerCard) return;
  this.timerCard.hidden = this.currentMode !== "timed";
  var minutes = Math.floor(seconds / 60);
  var remainder = seconds % 60;
  this.timerValue.textContent = ("0" + minutes).slice(-2) + ":" +
    ("0" + remainder).slice(-2);
  this.timerCard.classList.toggle("is-low", seconds <= 15);
};

HTMLActuator.prototype.setMode = function (mode) {
  this.currentMode = mode;
  var labels = {
    infinite: "Ranked run · every move counts",
    classic: "Classic mode · relaxed local play",
    timed: "Timed run · score as much as you can",
    daily: "Daily challenge · one shared board each day"
  };
  var note = document.querySelector("#mode-note");
  if (note) note.textContent = labels[mode] || labels.infinite;
  if (this.timerCard) this.timerCard.hidden = mode !== "timed";

  Array.prototype.forEach.call(document.querySelectorAll(".mode-button"), function (button) {
    button.classList.toggle("active", button.getAttribute("data-mode") === mode);
  });
};

HTMLActuator.prototype.message = function () {
  this.messageContainer.classList.add("game-over");
  this.messageContainer.querySelector("p").textContent =
    this.currentMode === "timed" ? "Time's up" : "Run complete";
};

HTMLActuator.prototype.clearMessage = function () {
  this.messageContainer.classList.remove("game-won");
  this.messageContainer.classList.remove("game-over");
};

HTMLActuator.prototype.showToast = function (message) {
  var self = this;
  this.toastContainer.textContent = message;
  this.toastContainer.classList.add("is-visible");
  window.clearTimeout(this.toastTimeout);
  this.toastTimeout = window.setTimeout(function () {
    self.toastContainer.classList.remove("is-visible");
  }, 2800);
};

HTMLActuator.prototype.showAchievement = function () {
  var self = this;
  this.achievement.classList.add("is-visible");
  this.achievement.setAttribute("aria-hidden", "false");
  window.clearTimeout(this.achievementTimeout);
  this.achievementTimeout = window.setTimeout(function () {
    self.achievement.classList.remove("is-visible");
    self.achievement.setAttribute("aria-hidden", "true");
  }, 2600);
};

HTMLActuator.prototype.showChampion = function (username) {
  var self = this;
  document.querySelector("#champion-player").textContent =
    username + " takes the crown.";
  this.championOverlay.classList.add("is-visible");
  this.championOverlay.setAttribute("aria-hidden", "false");
  window.clearTimeout(this.championTimeout);
  this.championTimeout = window.setTimeout(function () {
    self.championOverlay.classList.remove("is-visible");
    self.championOverlay.setAttribute("aria-hidden", "true");
  }, 3600);
};
