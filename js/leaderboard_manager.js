function LeaderboardManager() {
  this.client = null;
  this.user = null;
  this.username = null;
  this.gameManager = null;
  this.boardMode = "infinite";
  this.isConfigured = false;
  this.previousChampionId = null;
  this.previousChampionName = null;
  this.lastLeaderboardWasGlobal = false;
  this.localScores = this.readLocalScores();
  this.mockPlayers = {
    infinite: [
      { id: "mock-1", username: "NOVA", score: 184320, subtitle: "ARENA VETERAN" },
      { id: "mock-2", username: "KAIRO", score: 143872, subtitle: "STREAK · 12" },
      { id: "mock-3", username: "PIXELWAVE", score: 110592, subtitle: "ARENA VETERAN" },
      { id: "mock-4", username: "MIRA", score: 87040, subtitle: "STREAK · 8" },
      { id: "mock-5", username: "TILESHIFT", score: 65536, subtitle: "ARENA VETERAN" },
      { id: "mock-6", username: "ORBITAL", score: 49152, subtitle: "STREAK · 4" },
      { id: "mock-7", username: "VEX", score: 32768, subtitle: "ARENA VETERAN" },
      { id: "mock-8", username: "SORA", score: 24576, subtitle: "STREAK · 3" }
    ],
    timed: [
      { id: "timed-1", username: "KAIRO", score: 28924, subtitle: "BEST RUN" },
      { id: "timed-2", username: "NOVA", score: 25112, subtitle: "BEST RUN" },
      { id: "timed-3", username: "MIRA", score: 22464, subtitle: "BEST RUN" },
      { id: "timed-4", username: "PIXELWAVE", score: 19456, subtitle: "BEST RUN" },
      { id: "timed-5", username: "VEX", score: 16384, subtitle: "BEST RUN" }
    ],
    daily: [
      { id: "daily-1", username: "SORA", score: 58368, subtitle: "TODAY" },
      { id: "daily-2", username: "ORBITAL", score: 48128, subtitle: "TODAY" },
      { id: "daily-3", username: "NOVA", score: 40960, subtitle: "TODAY" },
      { id: "daily-4", username: "MIRA", score: 32768, subtitle: "TODAY" },
      { id: "daily-5", username: "TILESHIFT", score: 28672, subtitle: "TODAY" }
    ]
  };

  this.bindControls();
  this.renderLocalLeaderboard();
}

LeaderboardManager.prototype.bindControls = function () {
  var self = this;
  var accountButton = document.querySelector("#account-button");
  var authDialog = document.querySelector("#auth-dialog");
  var authForm = document.querySelector("#auth-form");

  accountButton.addEventListener("click", function () {
    if (self.user) {
      self.signOut();
    } else if (authDialog.showModal) {
      authDialog.showModal();
      document.querySelector("#auth-username").focus();
    } else {
      authDialog.setAttribute("open", "open");
    }
  });

  document.querySelector("#close-auth").addEventListener("click", function () {
    authDialog.close();
  });

  authForm.addEventListener("submit", function (event) {
    event.preventDefault();
    self.sendSignInLink();
  });

  document.querySelector("#refresh-leaderboard").addEventListener("click", function () {
    self.loadLeaderboard();
  });

  Array.prototype.forEach.call(document.querySelectorAll(".leaderboard-tab"), function (button) {
    button.addEventListener("click", function () {
      self.boardMode = button.getAttribute("data-board-mode");
      Array.prototype.forEach.call(document.querySelectorAll(".leaderboard-tab"), function (tab) {
        tab.classList.toggle("active", tab === button);
      });
      self.loadLeaderboard();
    });
  });

  document.querySelector("#leaderboard-mobile-toggle").addEventListener("click", function (event) {
    var panel = document.querySelector(".leaderboard-panel");
    var expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
    event.currentTarget.setAttribute("aria-expanded", !expanded);
    panel.classList.toggle("is-collapsed", expanded);
  });
};

LeaderboardManager.prototype.init = function () {
  var self = this;
  var config = window.INFINITE_ARENA_CONFIG || {};
  this.isConfigured = !!(config.supabaseUrl && config.supabaseAnonKey &&
    window.supabase && window.supabase.createClient);

  if (!this.isConfigured) {
    this.setConnection("LOCAL ARENA", "local");
    this.loadLeaderboard();
    return Promise.resolve();
  }

  this.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  this.setConnection("CONNECTING", "local");

  this.client.auth.onAuthStateChange(function (event, session) {
    self.user = session && session.user ? session.user : null;
    if (self.user) {
      window.setTimeout(function () {
        self.ensureProfile().then(function () {
          self.setConnection("GLOBAL LIVE", "online");
          self.updateAccountButton();
          self.loadLeaderboard();
          if (event === "SIGNED_IN" && self.gameManager) {
            self.gameManager.sessionId = null;
            self.gameManager.requestRankedSession();
          }
        }).catch(function (error) {
          self.showError("Profile could not be saved: " + error.message);
        });
      }, 0);
    } else {
      self.username = null;
      self.setConnection("SIGN IN TO RANK", "local");
      self.updateAccountButton();
      self.loadLeaderboard();
    }
  });

  return this.client.auth.getSession().then(function (result) {
    if (result.error) throw result.error;
    self.user = result.data.session ? result.data.session.user : null;
    if (self.user) return self.ensureProfile();
  }).then(function () {
    self.updateAccountButton();
    self.loadLeaderboard();
    self.subscribeToLeaderboard();
  }).catch(function (error) {
    self.setConnection("BACKEND ERROR", "error");
    self.showError("Supabase connection failed: " + error.message);
    throw error;
  });
};

LeaderboardManager.prototype.isAuthenticated = function () {
  return !!(this.client && this.user);
};

LeaderboardManager.prototype.ensureProfile = function () {
  var self = this;
  if (!this.user) return Promise.resolve();

  var username = this.user.user_metadata && this.user.user_metadata.username;
  if (!username) username = "PLAYER" + this.user.id.slice(0, 6).toUpperCase();
  this.username = username;

  return this.client.from("profiles").upsert({
    id: this.user.id,
    username: username
  }, { onConflict: "id" }).select("username").single().then(function (result) {
    if (result.error) throw result.error;
    self.username = result.data.username;
    return result.data;
  });
};

LeaderboardManager.prototype.sendSignInLink = function () {
  var usernameInput = document.querySelector("#auth-username");
  var emailInput = document.querySelector("#auth-email");
  var message = document.querySelector("#auth-message");
  var username = usernameInput.value.trim();
  var email = emailInput.value.trim();

  if (!this.client) {
    message.textContent = "Supabase is not configured for this project yet.";
    return;
  }

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    message.textContent = "Use 3–20 letters, numbers, or underscores for your username.";
    return;
  }

  message.textContent = "Sending your secure sign-in link…";
  this.client.auth.signInWithOtp({
    email: email,
    options: { data: { username: username }, emailRedirectTo: window.location.href }
  }).then(function (result) {
    if (result.error) throw result.error;
    message.textContent = "Check your inbox for the sign-in link. This window can stay open.";
  }).catch(function (error) {
    message.textContent = "Sign-in failed: " + error.message;
  });
};

LeaderboardManager.prototype.signOut = function () {
  var self = this;
  this.client.auth.signOut().then(function (result) {
    if (result.error) throw result.error;
  }).catch(function (error) {
    self.showError("Sign out failed: " + error.message);
  });
};

LeaderboardManager.prototype.updateAccountButton = function () {
  var button = document.querySelector("#account-button");
  button.textContent = this.user ? (this.username || "Sign out") + " · Sign out" : "Sign in";
};

LeaderboardManager.prototype.setConnection = function (label, state) {
  var status = document.querySelector("#connection-status");
  status.className = "connection-status";
  if (state === "online") status.classList.add("is-online");
  if (state === "error") status.classList.add("is-error");
  status.lastChild.textContent = " " + label;
};

LeaderboardManager.prototype.loadLeaderboard = function () {
  if (!this.client) {
    this.renderLocalLeaderboard();
    return Promise.resolve();
  }

  var self = this;
  var query = this.client.from("leaderboard")
    .select("user_id,username,mode,score,rank,submitted_at")
    .eq("mode", this.boardMode)
    .order("rank", { ascending: true })
    .order("score", { ascending: false })
    .limit(10);
  var rankQuery = this.user
    ? this.client.from("leaderboard")
      .select("user_id,username,score,rank")
      .eq("mode", this.boardMode)
      .eq("user_id", this.user.id)
      .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  return Promise.all([query, rankQuery]).then(function (results) {
    if (results[0].error) throw results[0].error;
    if (results[1].error) throw results[1].error;
    self.renderLeaderboard(results[0].data || [], true, results[1].data);
    self.setConnection(self.user ? "GLOBAL LIVE" : "GLOBAL", self.user ? "online" : "local");
  }).catch(function (error) {
    self.setConnection("BACKEND ERROR", "error");
    self.showError("Leaderboard could not be refreshed: " + error.message);
  });
};

LeaderboardManager.prototype.subscribeToLeaderboard = function () {
  var self = this;
  if (!this.client) return;
  this.client.channel("arena-leaderboard")
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "scores"
    }, function () {
      self.loadLeaderboard();
    })
    .subscribe(function (status) {
      if (status === "CHANNEL_ERROR") {
        self.setConnection("LIVE UPDATES OFFLINE", "error");
        self.showError("Realtime leaderboard subscription failed.");
      }
    });
};

LeaderboardManager.prototype.startGameSession = function (mode) {
  if (!this.client || !this.user) {
    return Promise.reject(new Error("Sign in to start a verified leaderboard run."));
  }

  return this.client.functions.invoke("start-game", { body: { mode: mode } })
    .then(function (result) {
      if (result.error) throw result.error;
      if (!result.data || !result.data.sessionId || !Number.isInteger(result.data.seed)) {
        throw new Error("The server returned an invalid game session.");
      }
      return result.data;
    });
};

LeaderboardManager.prototype.submitScore = function (sessionId, mode, moves, score) {
  var self = this;
  if (!this.client || !this.user) return Promise.resolve();

  this.client.functions.invoke("submit-score", {
    body: { sessionId: sessionId, mode: mode, moves: moves, score: score }
  }).then(function (result) {
    if (result.error) throw result.error;
    if (!result.data || !result.data.verified) throw new Error("The score was not verified.");
    self.showToast("Score verified · global leaderboard updated.");
    self.loadLeaderboard();
  }).catch(function (error) {
    self.showError("Score could not be verified: " + error.message);
  });
};

LeaderboardManager.prototype.recordLocalScore = function (mode, score) {
  if (score > (this.localScores[mode] || 0)) {
    this.localScores[mode] = score;
    try {
      window.localStorage.setItem("arenaLocalScores", JSON.stringify(this.localScores));
    } catch (error) {
      if (window.console && console.error) console.error("Could not save local leaderboard score:", error);
    }
    if (!this.client) this.renderLocalLeaderboard();
  }
};

LeaderboardManager.prototype.readLocalScores = function () {
  try {
    var saved = window.localStorage.getItem("arenaLocalScores");
    return saved ? JSON.parse(saved) : {};
  } catch (error) {
    if (window.console && console.error) console.error("Could not read local leaderboard scores:", error);
    return {};
  }
};

LeaderboardManager.prototype.renderLocalLeaderboard = function () {
  var players = (this.mockPlayers[this.boardMode] || []).map(function (player) {
    return {
      id: player.id,
      username: player.username,
      score: player.score,
      subtitle: player.subtitle,
      rank: 0,
      isPlayer: false
    };
  });

  if (this.localScores[this.boardMode]) {
    players.push({
      id: "local-player",
      username: this.username || "YOU",
      score: this.localScores[this.boardMode],
      subtitle: "YOUR PERSONAL BEST",
      isPlayer: true
    });
  }

  players.sort(function (a, b) { return b.score - a.score; });
  var playerPosition = players.map(function (player) {
    return player.isPlayer;
  }).indexOf(true);
  this.localRank = playerPosition === -1 ? null : playerPosition + 1;
  var localPlayer = playerPosition === -1 ? null : players[playerPosition];
  players = players.slice(0, 10);
  players.forEach(function (player, index) { player.rank = index + 1; });
  this.renderLeaderboard(players, false, localPlayer ? {
    rank: this.localRank,
    username: localPlayer.username,
    score: localPlayer.score
  } : null);
};

LeaderboardManager.prototype.renderLeaderboard = function (players, isGlobal, currentRank) {
  var list = document.querySelector("#leaderboard-list");
  var oldPositions = {};
  Array.prototype.forEach.call(list.children, function (element) {
    oldPositions[element.getAttribute("data-rank-key")] = element.getBoundingClientRect();
  });

  while (list.firstChild) list.removeChild(list.firstChild);
  if (!players.length) {
    var empty = document.createElement("li");
    empty.className = "leaderboard-empty";
    empty.textContent = "No verified scores yet. Be the first on the board.";
    list.appendChild(empty);
  }

  var champion = players.length ? players[0] : null;
  var currentChampionId = champion ? (champion.user_id || champion.id) : null;
  var currentChampionName = champion ? champion.username : "";
  var changedChampion = !!(isGlobal && this.lastLeaderboardWasGlobal &&
    this.previousChampionId && currentChampionId &&
    this.previousChampionId !== currentChampionId);

  players.forEach(function (player, index) {
    var rank = player.rank || index + 1;
    var userId = player.user_id || player.id;
    var isChampion = rank === 1;
    var isCurrentPlayer = player.isPlayer ||
      (!!this.user && player.user_id === this.user.id);
    var entry = document.createElement("li");
    entry.className = "leaderboard-entry";
    if (isChampion) entry.classList.add("is-champion");
    if (isCurrentPlayer) entry.classList.add("is-player");
    entry.setAttribute("data-rank-key", userId);

    var rankNumber = document.createElement("span");
    rankNumber.className = "player-rank-number";
    rankNumber.textContent = "#" + rank;

    var playerDetails = document.createElement("span");
    playerDetails.className = "leaderboard-player";
    var name = document.createElement("span");
    name.className = "leaderboard-name";
    name.textContent = player.username || "PLAYER";
    if (isCurrentPlayer) name.textContent += " · YOU";
    var subtitle = document.createElement("span");
    subtitle.className = isChampion ? "champion-label" : "leaderboard-subtitle";
    subtitle.textContent = isChampion ? "GLOBAL CHAMPION" :
      (player.subtitle || (isGlobal ? "VERIFIED SCORE" : "ARENA PLAYER"));
    playerDetails.appendChild(name);
    playerDetails.appendChild(subtitle);

    var score = document.createElement("span");
    score.className = "leaderboard-score";
    score.textContent = Number(player.score || 0).toLocaleString();
    entry.appendChild(rankNumber);
    entry.appendChild(playerDetails);
    entry.appendChild(score);
    list.appendChild(entry);
  }, this);

  Array.prototype.forEach.call(list.children, function (element) {
    var key = element.getAttribute("data-rank-key");
    var before = oldPositions[key];
    if (!before) return;
    var after = element.getBoundingClientRect();
    var offset = before.top - after.top;
    if (offset === 0) return;
    if (element.animate) {
      element.animate([
        { transform: "translateY(" + offset + "px)" },
        { transform: "translateY(0)" }
      ], { duration: 420, easing: "cubic-bezier(.2,.75,.3,1)" });
    } else {
      element.style.transform = "translateY(" + offset + "px)";
      window.requestAnimationFrame(function () {
        element.style.transition = "transform 420ms cubic-bezier(.2,.75,.3,1)";
        element.style.transform = "translateY(0)";
      });
    }
  });

  if (changedChampion) {
    var actuator = this.gameManager && this.gameManager.actuator;
    if (actuator) actuator.showChampion(currentChampionName);
    if (this.gameManager && this.gameManager.soundManager) {
      this.gameManager.soundManager.play("champion");
    }
  }

  this.previousChampionId = currentChampionId;
  this.previousChampionName = currentChampionName;
  this.lastLeaderboardWasGlobal = isGlobal;
  this.updateRank(players, isGlobal, currentRank);
  var footer = document.querySelector(".leaderboard-footer");
  if (footer) {
    footer.textContent = isGlobal
      ? "Top verified score takes the crown."
      : "Sample rankings · connect Supabase for global play.";
  }
};

LeaderboardManager.prototype.updateRank = function (players, isGlobal, currentRank) {
  var rankLabel = document.querySelector("#global-rank");
  var rankCard = document.querySelector("#my-rank-card");
  var currentPlayer = null;
  if (this.user) {
    currentPlayer = players.filter(function (player) {
      return player.user_id === this.user.id;
    }, this)[0];
  } else {
    currentPlayer = players.filter(function (player) {
      return player.isPlayer;
    })[0];
  }

  if (currentRank && Number.isInteger(Number(currentRank.rank))) {
    rankLabel.textContent = "RANK #" + Number(currentRank.rank);
    rankCard.hidden = false;
    document.querySelector("#my-rank-value").textContent = "#" + Number(currentRank.rank);
    document.querySelector("#my-rank-name").textContent =
      currentRank.username || this.username || "YOU";
    document.querySelector("#my-rank-score").textContent =
      Number(currentRank.score || 0).toLocaleString();
  } else if (currentPlayer) {
    rankLabel.textContent = "RANK #" + (currentPlayer.rank || players.indexOf(currentPlayer) + 1);
    rankCard.hidden = false;
    document.querySelector("#my-rank-value").textContent =
      "#" + (currentPlayer.rank || players.indexOf(currentPlayer) + 1);
    document.querySelector("#my-rank-name").textContent =
      currentPlayer.username || this.username || "YOU";
    document.querySelector("#my-rank-score").textContent =
      Number(currentPlayer.score || 0).toLocaleString();
  } else if (isGlobal && this.user) {
    rankLabel.textContent = "UNRANKED";
    rankCard.hidden = true;
  } else {
    rankLabel.textContent = "LOCAL";
    rankCard.hidden = true;
  }
};

LeaderboardManager.prototype.showToast = function (message) {
  var toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(function () { toast.classList.remove("is-visible"); }, 3000);
};

LeaderboardManager.prototype.showError = function (message) {
  this.showToast(message);
  if (window.console && console.error) console.error(message);
};
