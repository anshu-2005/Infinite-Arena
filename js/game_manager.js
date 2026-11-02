function GameManager(size, InputManager, Actuator, StorageManager, services) {
  this.size           = size;
  this.inputManager   = new InputManager;
  this.storageManager = new StorageManager;
  this.actuator       = new Actuator;
  this.services       = services || {};
  this.soundManager   = this.services.soundManager;
  this.leaderboard    = this.services.leaderboard;

  this.startTiles     = 2;
  this.timerInterval  = null;
  this.sessionVersion = 0;
  this.undoStack      = [];

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));
  this.inputManager.on("keepPlaying", this.keepPlaying.bind(this));
  this.inputManager.on("undo", this.undo.bind(this));
  this.inputManager.on("mode", this.setMode.bind(this));

  this.setup();
}

GameManager.prototype.restart = function () {
  this.storageManager.clearGameState();
  this.actuator.continueGame();
  this.undoStack = [];
  this.setup();
  this.requestRankedSession();
};

GameManager.prototype.keepPlaying = function () {
  this.actuator.continueGame();
};

GameManager.prototype.isGameTerminated = function () {
  return this.over;
};

GameManager.prototype.setup = function () {
  var previousState = this.storageManager.getGameState();
  this.submissionStarted = false;

  if (this.timerInterval) {
    window.clearInterval(this.timerInterval);
    this.timerInterval = null;
  }

  if (previousState) {
    this.mode          = previousState.mode || "infinite";
    var migratedBoard = previousState.grid.size !== this.size;
    this.grid = migratedBoard ? new Grid(this.size) :
      new Grid(previousState.grid.size, previousState.grid.cells);
    if (migratedBoard) {
      for (var x = 0; x < previousState.grid.size; x++) {
        for (var y = 0; y < previousState.grid.size; y++) {
          var savedTile = previousState.grid.cells[x][y];
          if (savedTile) {
            this.grid.insertTile(new Tile(savedTile.position, savedTile.value));
          }
        }
      }
      this.mode = "classic";
    }
    this.score         = Number(previousState.score) || 0;
    this.over          = migratedBoard ? false : !!previousState.over;
    this.won           = !!previousState.won;
    this.seed          = migratedBoard ? null : (previousState.seed || null);
    this.randomState   = previousState.randomState || this.seed || 0;
    this.moveHistory   = migratedBoard ? [] : (previousState.moveHistory || []);
    this.rankedEligible = migratedBoard ? false : previousState.rankedEligible !== false;
    this.sessionId     = migratedBoard ? null : (previousState.sessionId || null);
    this.startedAt     = migratedBoard ? Date.now() : (previousState.startedAt || Date.now());
    this.undoStack     = [];
    this.random        = this.seed ? this.createSeededRandom(this.randomState) : Math.random;
  } else {
    this.mode           = this.mode || "infinite";
    this.grid           = new Grid(this.size);
    this.score          = 0;
    this.over           = false;
    this.won            = false;
    this.seed           = this.mode === "daily" ? this.dailySeed() : null;
    this.randomState    = this.seed || 0;
    this.moveHistory    = [];
    this.rankedEligible = true;
    this.sessionId      = null;
    this.startedAt      = Date.now();
    this.random         = this.seed ? this.createSeededRandom(this.seed) : Math.random;
    this.addStartTiles();
  }

  this.sessionPending = false;
  this.actuator.setMode(this.mode);
  this.actuate();
  this.startTimer();

  if (this.over && this.moveHistory.length) this.submitResult();
};

GameManager.prototype.setMode = function (mode) {
  if (["infinite", "classic", "timed", "daily"].indexOf(mode) === -1) return;
  if (this.mode === mode) return;

  this.sessionVersion++;
  this.mode = mode;
  this.storageManager.clearGameState();
  this.actuator.continueGame();
  this.undoStack = [];
  this.setup();
  this.requestRankedSession();
};

GameManager.prototype.addStartTiles = function () {
  for (var i = 0; i < this.startTiles; i++) this.addRandomTile();
};

GameManager.prototype.addRandomTile = function () {
  var cells = this.grid.availableCells();
  if (!cells.length) return;

  var position = cells[Math.floor(this.random() * cells.length)];
  var value = this.random() < 0.9 ? 2 : 4;
  this.grid.insertTile(new Tile(position, value));
};

GameManager.prototype.actuate = function () {
  if (this.storageManager.getBestScore() < this.score) {
    this.storageManager.setBestScore(this.score);
  }

  this.storageManager.setGameState(this.serialize());
  this.actuator.actuate(this.grid, {
    score: this.score,
    over: this.over,
    won: this.won,
    bestScore: this.storageManager.getBestScore(),
    terminated: this.isGameTerminated(),
    mode: this.mode,
    undoAvailable: this.undoStack.length > 0,
    timeLeft: this.timeLeft(),
    rankedEligible: this.rankedEligible,
    sessionPending: this.sessionPending
  });
};

GameManager.prototype.serialize = function () {
  return {
    grid: this.grid.serialize(),
    score: this.score,
    over: this.over,
    won: this.won,
    mode: this.mode,
    seed: this.seed,
    randomState: this.randomState,
    moveHistory: this.moveHistory.slice(),
    rankedEligible: this.rankedEligible,
    sessionId: this.sessionId,
    startedAt: this.startedAt
  };
};

GameManager.prototype.prepareTiles = function () {
  this.grid.eachCell(function (x, y, tile) {
    if (tile) {
      tile.mergedFrom = null;
      tile.savePosition();
    }
  });
};

GameManager.prototype.moveTile = function (tile, cell) {
  this.grid.cells[tile.x][tile.y] = null;
  this.grid.cells[cell.x][cell.y] = tile;
  tile.updatePosition(cell);
};

GameManager.prototype.move = function (direction) {
  if (this.isGameTerminated() || this.sessionPending) return;
  if (this.mode === "timed" && this.timeLeft() <= 0) {
    this.over = true;
    this.actuate();
    this.submitResult();
    return;
  }

  var self = this;
  var cell, tile;
  var vector = this.getVector(direction);
  if (!vector) return;

  var traversals = this.buildTraversals(vector);
  var moved = false;
  var mergedThisTurn = false;
  var achieved = false;
  var snapshot = this.serialize();

  this.prepareTiles();

  traversals.x.forEach(function (x) {
    traversals.y.forEach(function (y) {
      cell = { x: x, y: y };
      tile = self.grid.cellContent(cell);

      if (tile) {
        var positions = self.findFarthestPosition(cell, vector);
        var next = self.grid.cellContent(positions.next);

        if (next && next.value === tile.value && !next.mergedFrom) {
          var merged = new Tile(positions.next, tile.value * 2);
          merged.mergedFrom = [tile, next];

          self.grid.insertTile(merged);
          self.grid.removeTile(tile);
          tile.updatePosition(positions.next);
          self.score += merged.value;
          mergedThisTurn = true;

          if (merged.value >= 2048 && !self.won) {
            self.won = true;
            achieved = true;
          }
        } else {
          self.moveTile(tile, positions.farthest);
        }

        if (!self.positionsEqual(cell, tile)) moved = true;
      }
    });
  });

  if (moved) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.moveHistory.push(direction);
    this.addRandomTile();

    if (!this.movesAvailable()) this.over = true;

    if (this.soundManager) {
      this.soundManager.play("move");
      if (mergedThisTurn) this.soundManager.play("merge");
    }
    if (achieved) {
      this.actuator.showAchievement();
      if (this.soundManager) this.soundManager.play("achievement");
    }
    this.actuate();
    if (this.over) this.submitResult();
  }
};

GameManager.prototype.undo = function () {
  if (this.over || !this.undoStack.length) return;

  var previousState = this.undoStack.pop();
  this.grid = new Grid(previousState.grid.size, previousState.grid.cells);
  this.score = previousState.score;
  this.seed = previousState.seed;
  this.randomState = previousState.randomState;
  this.random = this.seed ? this.createSeededRandom(this.randomState) : Math.random;
  this.moveHistory = previousState.moveHistory.slice();
  this.startedAt = previousState.startedAt;
  this.won = previousState.won;

  if (this.mode !== "classic") {
    this.rankedEligible = false;
    this.sessionId = null;
    this.actuator.showToast("Undo used — this run is no longer ranked.");
  }

  this.actuate();
};

GameManager.prototype.requestRankedSession = function () {
  var self = this;
  if (!this.leaderboard || this.mode === "classic" ||
      !this.leaderboard.isAuthenticated() || this.sessionId ||
      this.sessionPending) return;

  var version = ++this.sessionVersion;
  this.sessionPending = true;
  this.actuate();

  this.leaderboard.startGameSession(this.mode).then(function (session) {
    if (version !== self.sessionVersion) return;
    self.sessionPending = false;
    self.sessionId = session.sessionId;
    self.seed = session.seed;
    self.randomState = session.seed;
    self.random = self.createSeededRandom(session.seed);
    self.grid = new Grid(self.size);
    self.score = 0;
    self.over = false;
    self.won = false;
    self.moveHistory = [];
    self.rankedEligible = true;
    self.startedAt = session.startedAt || Date.now();
    self.undoStack = [];
    self.addStartTiles();
    self.actuator.continueGame();
    self.actuator.showToast("Verified ranked run ready.");
    self.actuate();
    self.startTimer();
  }).catch(function (error) {
    if (version !== self.sessionVersion) return;
    self.sessionPending = false;
    self.rankedEligible = false;
    self.actuator.showToast("Ranked session unavailable. Playing locally.");
    if (window.console && console.error) console.error("Could not start ranked session:", error);
    self.actuate();
  });
};

GameManager.prototype.startTimer = function () {
  var self = this;
  if (this.timerInterval) window.clearInterval(this.timerInterval);
  if (this.mode !== "timed" || this.over) return;

  this.timerInterval = window.setInterval(function () {
    if (self.timeLeft() <= 0) {
      window.clearInterval(self.timerInterval);
      self.timerInterval = null;
      self.over = true;
      self.actuate();
      self.submitResult();
    } else {
      self.actuator.updateTimer(self.timeLeft());
    }
  }, 250);
};

GameManager.prototype.timeLeft = function () {
  if (this.mode !== "timed") return 120;
  return Math.max(0, Math.ceil((this.startedAt + 120000 - Date.now()) / 1000));
};

GameManager.prototype.submitResult = function () {
  if (this.submissionStarted || this.mode === "classic" || !this.rankedEligible) {
    if (this.leaderboard && this.mode !== "classic") {
      this.leaderboard.recordLocalScore(this.mode, this.score);
    }
    return;
  }

  this.submissionStarted = true;
  if (this.leaderboard && this.sessionId) {
    this.leaderboard.submitScore(this.sessionId, this.mode, this.moveHistory, this.score);
  } else if (this.leaderboard) {
    this.leaderboard.recordLocalScore(this.mode, this.score);
  }
};

GameManager.prototype.dailySeed = function () {
  var date = new Date();
  return Number(date.getUTCFullYear() + ("0" + (date.getUTCMonth() + 1)).slice(-2) +
    ("0" + date.getUTCDate()).slice(-2));
};

GameManager.prototype.createSeededRandom = function (seed) {
  var self = this;
  var state = Number(seed) >>> 0;
  if (!state) state = 1;
  this.randomState = state;

  return function () {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    self.randomState = state;
    return state / 4294967296;
  };
};

GameManager.prototype.getVector = function (direction) {
  var map = {
    0: { x: 0, y: -1 },
    1: { x: 1, y: 0 },
    2: { x: 0, y: 1 },
    3: { x: -1, y: 0 }
  };
  return map[direction];
};

GameManager.prototype.buildTraversals = function (vector) {
  var traversals = { x: [], y: [] };
  for (var pos = 0; pos < this.size; pos++) {
    traversals.x.push(pos);
    traversals.y.push(pos);
  }
  if (vector.x === 1) traversals.x = traversals.x.reverse();
  if (vector.y === 1) traversals.y = traversals.y.reverse();
  return traversals;
};

GameManager.prototype.findFarthestPosition = function (cell, vector) {
  var previous;
  do {
    previous = cell;
    cell = { x: previous.x + vector.x, y: previous.y + vector.y };
  } while (this.grid.withinBounds(cell) && this.grid.cellAvailable(cell));

  return { farthest: previous, next: cell };
};

GameManager.prototype.movesAvailable = function () {
  return this.grid.cellsAvailable() || this.tileMatchesAvailable();
};

GameManager.prototype.tileMatchesAvailable = function () {
  var self = this;
  var tile;

  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      tile = this.grid.cellContent({ x: x, y: y });
      if (tile) {
        for (var direction = 0; direction < 4; direction++) {
          var vector = self.getVector(direction);
          var cell = { x: x + vector.x, y: y + vector.y };
          var other = self.grid.cellContent(cell);
          if (other && other.value === tile.value) return true;
        }
      }
    }
  }
  return false;
};

GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};
