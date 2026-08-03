// Game Canvas — retro "Snake" game for play.html, styled after old
// mobile-phone Snake. Vanilla JS + canvas, no dependencies.

document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("snake-canvas");
  if (!canvas) return; // snake game markup isn't on this page

  const ctx = canvas.getContext("2d");
  const GRID_SIZE = 20;
  const CELL = canvas.width / GRID_SIZE;
  const START_LENGTH = 3;
  const START_SPEED_MS = 140;
  const MIN_SPEED_MS = 70;
  const SPEED_STEP_MS = 3;
  const HIGH_SCORE_KEY = "gc-snake-high-score";

  const phone = document.getElementById("snake-phone");
  const scoreEl = document.getElementById("snake-score");
  const highScoreEl = document.getElementById("snake-high-score");
  const finalScoreEl = document.getElementById("snake-final-score");
  const overlay = document.getElementById("snake-overlay");
  const startPanel = document.getElementById("snake-start-panel");
  const gameoverPanel = document.getElementById("snake-gameover-panel");
  const startBtn = document.getElementById("snake-start");
  const playAgainBtn = document.getElementById("snake-play-again");
  const topRestartBtn = document.getElementById("snake-restart");
  const dpad = document.getElementById("snake-dpad");

  const LEADERBOARD_KEY = "gc-snake-leaderboard";
  const leaderboardList = document.getElementById("snake-leaderboard-list");
  const nameInput = document.getElementById("snake-name-input");
  const saveBtn = document.getElementById("snake-save-score");
  const saveRow = document.getElementById("snake-save-row");
  const savedMsg = document.getElementById("snake-saved-msg");
  const langToggle = document.getElementById("lang-toggle");

  const KEY_DIR = {
    ArrowUp: "up", KeyW: "up",
    ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
  };
  const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

  let highScore = Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;
  if (highScoreEl) highScoreEl.textContent = String(highScore);

  let snake, direction, nextDirection, food, score, speed, timer, state; // state: idle | playing | over

  function placeFood() {
    let position;
    do {
      position = {
        x: Math.floor(Math.random() * GRID_SIZE),
        y: Math.floor(Math.random() * GRID_SIZE),
      };
    } while (snake.some((seg) => seg.x === position.x && seg.y === position.y));
    food = position;
  }

  function updateScore() {
    if (scoreEl) scoreEl.textContent = String(score);
  }

  function beep(freq, duration) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      beep.ctx = beep.ctx || new AudioCtx();
      const osc = beep.ctx.createOscillator();
      const gain = beep.ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(beep.ctx.destination);
      osc.start();
      osc.stop(beep.ctx.currentTime + duration);
    } catch (e) {
      // Web Audio unavailable — fail silently, sound is a nice-to-have
    }
  }

  function draw() {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#c7d64e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(0, 0, 0, 0.06)";
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID_SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL, 0);
      ctx.lineTo(i * CELL, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL);
      ctx.lineTo(canvas.width, i * CELL);
      ctx.stroke();
    }

    ctx.fillStyle = "#12262a";
    ctx.fillRect(food.x * CELL + 3, food.y * CELL + 3, CELL - 6, CELL - 6);

    snake.forEach((seg, i) => {
      const pad = i === 0 ? 1 : 2;
      ctx.fillRect(seg.x * CELL + pad, seg.y * CELL + pad, CELL - pad * 2, CELL - pad * 2);
    });
  }

  function showStartPanel() {
    overlay.hidden = false;
    startPanel.hidden = false;
    gameoverPanel.hidden = true;
  }

  function showGameOverPanel() {
    overlay.hidden = false;
    startPanel.hidden = true;
    gameoverPanel.hidden = false;
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function renderLeaderboard() {
    const isAr = document.documentElement.lang === "ar";
    GCLeaderboard.render(leaderboardList, GCLeaderboard.load(LEADERBOARD_KEY), (value) =>
      isAr ? `${value} نقطة` : `${value} pts`
    );
  }

  function resetSaveRow() {
    if (nameInput) {
      nameInput.value = GCLeaderboard.getSavedName();
      nameInput.disabled = false;
    }
    if (saveBtn) saveBtn.disabled = false;
    if (saveRow) saveRow.hidden = false;
    if (savedMsg) savedMsg.hidden = true;
  }

  function saveScore() {
    const isAr = document.documentElement.lang === "ar";
    const raw = nameInput ? nameInput.value.trim() : "";
    const name = raw ? raw.slice(0, 18) : isAr ? "مجهول" : "Anonymous";
    GCLeaderboard.setSavedName(name);
    GCLeaderboard.addEntry(LEADERBOARD_KEY, { name, value: score }, (a, b) => b.value - a.value);
    renderLeaderboard();
    if (saveBtn) saveBtn.disabled = true;
    if (nameInput) nameInput.disabled = true;
    if (savedMsg) savedMsg.hidden = false;
  }

  if (saveBtn) saveBtn.addEventListener("click", saveScore);
  if (langToggle) langToggle.addEventListener("click", renderLeaderboard);

  function resetState() {
    const mid = Math.floor(GRID_SIZE / 2);
    snake = Array.from({ length: START_LENGTH }, (_, i) => ({ x: mid - i, y: mid }));
    direction = "right";
    nextDirection = "right";
    score = 0;
    speed = START_SPEED_MS;
    state = "idle";
    clearInterval(timer);
    placeFood();
    updateScore();
    draw();
    resetSaveRow();
    showStartPanel();
  }

  function startGame() {
    if (state !== "idle") return;
    state = "playing";
    hideOverlay();
    restartTimer();
  }

  function restartTimer() {
    clearInterval(timer);
    timer = setInterval(tick, speed);
  }

  function setDirection(dir) {
    if (state === "over") return;
    if (state === "idle") startGame();
    if (dir === OPPOSITE[direction]) return; // ignore direct reversal
    nextDirection = dir;
  }

  function tick() {
    direction = nextDirection;
    const head = { ...snake[0] };
    if (direction === "up") head.y -= 1;
    if (direction === "down") head.y += 1;
    if (direction === "left") head.x -= 1;
    if (direction === "right") head.x += 1;

    const hitWall = head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE;
    const hitSelf = snake.some((seg) => seg.x === head.x && seg.y === head.y);

    if (hitWall || hitSelf) {
      gameOver();
      return;
    }

    snake.unshift(head);

    if (head.x === food.x && head.y === food.y) {
      score += 1;
      updateScore();
      beep(660, 0.08);
      speed = Math.max(MIN_SPEED_MS, speed - SPEED_STEP_MS);
      placeFood();
      restartTimer();
    } else {
      snake.pop();
    }

    draw();
  }

  function gameOver() {
    state = "over";
    clearInterval(timer);
    beep(140, 0.25);
    if (score > highScore) {
      highScore = score;
      localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
      if (highScoreEl) highScoreEl.textContent = String(highScore);
    }
    if (finalScoreEl) finalScoreEl.textContent = String(score);
    showGameOverPanel();
  }

  if (startBtn) startBtn.addEventListener("click", startGame);
  if (playAgainBtn) playAgainBtn.addEventListener("click", () => { resetState(); startGame(); });
  if (topRestartBtn) topRestartBtn.addEventListener("click", () => { resetState(); startGame(); });

  if (dpad) {
    dpad.querySelectorAll(".snake-dpad-btn").forEach((btn) => {
      btn.addEventListener("click", () => setDirection(btn.dataset.dir));
    });
  }

  // Scoped to the phone frame (not document) so arrow keys only get
  // captured once the player has clicked into the game — otherwise
  // they'd hijack normal page scrolling everywhere else on the page.
  if (phone) {
    phone.addEventListener("keydown", (e) => {
      const dir = KEY_DIR[e.code];
      if (!dir) return;
      e.preventDefault();
      setDirection(dir);
    });
  }

  renderLeaderboard();
  resetState();
});
