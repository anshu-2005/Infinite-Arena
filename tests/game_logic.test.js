const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function createManager(mode) {
  const context = {
    window: {
      clearInterval() {},
      setInterval() { return 1; }
    },
    console
  };
  vm.createContext(context);
  ["tile.js", "grid.js", "game_manager.js"].forEach((file) => {
    const source = fs.readFileSync(path.join(root, "js", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  });
  vm.runInContext(`
    function TestInput() {
      this.events = {};
    }
    TestInput.prototype.on = function (event, callback) {
      this.events[event] = callback;
    };
    function TestStorage() {
      this.state = null;
      this.best = 0;
    }
    TestStorage.prototype.getGameState = function () { return this.state; };
    TestStorage.prototype.setGameState = function (state) { this.state = state; };
    TestStorage.prototype.clearGameState = function () { this.state = null; };
    TestStorage.prototype.getBestScore = function () { return this.best; };
    TestStorage.prototype.setBestScore = function (score) { this.best = score; };
    function TestActuator() {
      this.metadata = null;
      this.achievements = 0;
    }
    TestActuator.prototype.setMode = function () {};
    TestActuator.prototype.actuate = function (grid, metadata) { this.metadata = metadata; };
    TestActuator.prototype.continueGame = function () {};
    TestActuator.prototype.showAchievement = function () { this.achievements++; };
    TestActuator.prototype.showToast = function () {};
  `, context);

  const manager = new context.GameManager(6, context.TestInput,
    context.TestActuator, context.TestStorage);
  if (mode) manager.mode = mode;
  return { manager, context };
}

function setTiles(manager, context, values) {
  manager.grid = new context.Grid(6);
  values.forEach((entry) => {
    manager.grid.insertTile(new context.Tile(
      { x: entry[0], y: entry[1] }, entry[2]
    ));
  });
  manager.score = 0;
  manager.over = false;
  manager.won = false;
  manager.moveHistory = [];
  manager.undoStack = [];
  manager.seed = null;
  manager.random = () => 0;
  manager.rankedEligible = true;
  manager.sessionId = null;
};

test("reaching 2048 celebrates without ending the run", () => {
  const { manager, context } = createManager();
  setTiles(manager, context, [[0, 0, 1024], [1, 0, 1024]]);

  manager.move(3);

  assert.equal(manager.score, 2048);
  assert.equal(manager.won, true);
  assert.equal(manager.over, false);
  assert.equal(manager.isGameTerminated(), false);
  assert.equal(manager.actuator.achievements, 1);
  assert.equal(manager.grid.cellContent({ x: 0, y: 0 }).value, 2048);
});

test("tiles above 2048 continue merging without a second achievement", () => {
  const { manager, context } = createManager();
  setTiles(manager, context, [[0, 0, 2048], [1, 0, 2048]]);
  manager.won = true;
  manager.score = 2048;

  manager.move(3);

  assert.equal(manager.score, 6144);
  assert.equal(manager.over, false);
  assert.equal(manager.grid.cellContent({ x: 0, y: 0 }).value, 4096);
  assert.equal(manager.actuator.achievements, 0);
});

test("a tile can merge only once per move", () => {
  const { manager, context } = createManager();
  setTiles(manager, context, [
    [0, 0, 2], [1, 0, 2], [2, 0, 2], [3, 0, 2]
  ]);

  manager.move(3);

  assert.equal(manager.score, 8);
  assert.equal(manager.grid.cellContent({ x: 0, y: 0 }).value, 4);
  assert.equal(manager.grid.cellContent({ x: 1, y: 0 }).value, 4);
});

test("full boards without equal neighbors have no valid moves", () => {
  const { manager, context } = createManager();
  const values = [];
  for (let x = 0; x < 6; x++) {
    for (let y = 0; y < 6; y++) {
      values.push([x, y, (x + y) % 2 === 0 ? 2 : 4]);
    }
  }
  setTiles(manager, context, values);

  assert.equal(manager.movesAvailable(), false);
  assert.equal(manager.tileMatchesAvailable(), false);
});

test("undo restores the board, score, and move replay and invalidates rank", () => {
  const { manager, context } = createManager();
  setTiles(manager, context, [[0, 0, 2], [1, 0, 2]]);
  const before = JSON.stringify(manager.grid.serialize());

  manager.move(3);
  manager.undo();

  assert.equal(JSON.stringify(manager.grid.serialize()), before);
  assert.equal(manager.score, 0);
  assert.equal(manager.moveHistory.length, 0);
  assert.equal(manager.rankedEligible, false);
});

test("daily board generation is deterministic", () => {
  const first = createManager("daily");
  const second = createManager("daily");
  first.manager.storageManager.clearGameState();
  second.manager.storageManager.clearGameState();
  first.manager.setup();
  second.manager.setup();

  assert.equal(first.manager.seed, second.manager.seed);
  assert.equal(
    JSON.stringify(first.manager.grid.serialize()),
    JSON.stringify(second.manager.grid.serialize())
  );
});

test("saved 4x4 games migrate to an unranked 6x6 board", () => {
  const { manager, context } = createManager();
  const oldGrid = new context.Grid(4);
  oldGrid.insertTile(new context.Tile({ x: 2, y: 1 }, 16));
  manager.storageManager.state = {
    grid: oldGrid.serialize(),
    score: 32,
    over: true,
    won: false,
    mode: "infinite",
    moveHistory: [3],
    rankedEligible: true,
    sessionId: "old-session"
  };

  manager.setup();

  assert.equal(manager.grid.size, 6);
  assert.equal(manager.grid.cellContent({ x: 2, y: 1 }).value, 16);
  assert.equal(manager.score, 32);
  assert.equal(manager.mode, "classic");
  assert.equal(manager.over, false);
  assert.equal(manager.moveHistory.length, 0);
  assert.equal(manager.rankedEligible, false);
  assert.equal(manager.sessionId, null);
});

test("server replay matches a seeded 6x6 client run", async () => {
  const { replay } = await import(pathToFileURL(
    path.join(root, "supabase", "functions", "_shared", "replay.ts")
  ).href);
  const { manager, context } = createManager();
  const seed = 329873;
  manager.grid = new context.Grid(6);
  manager.score = 0;
  manager.over = false;
  manager.won = false;
  manager.seed = seed;
  manager.random = manager.createSeededRandom(seed);
  manager.moveHistory = [];
  manager.rankedEligible = true;
  manager.sessionPending = false;
  manager.addStartTiles();

  for (let index = 0; index < 120 && !manager.over; index++) {
    manager.move(index % 4);
  }

  assert.ok(manager.moveHistory.length > 10);
  const serverResult = replay(seed, manager.moveHistory);
  assert.equal(serverResult.score, manager.score);
  assert.equal(serverResult.gameOver, manager.over);
  assert.equal(serverResult.moveCount, manager.moveHistory.length);
});
