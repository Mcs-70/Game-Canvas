// Game Canvas — "Shape Match" memory game for play.html.
// Vanilla JS, no dependencies: shuffle 8 shape/color pairs into a 4x4
// grid, flip two cards at a time, and track moves until all pairs match.

document.addEventListener("DOMContentLoaded", () => {
  const grid = document.getElementById("mem-grid");
  if (!grid) return; // memory game markup isn't on this page

  const moveCountEl = document.getElementById("mem-move-count");
  const matchCountEl = document.getElementById("mem-match-count");
  const winBanner = document.getElementById("mem-win-banner");
  const winMoveCountEl = document.getElementById("mem-win-move-count");
  const restartBtn = document.getElementById("mem-restart");
  const playAgainBtn = document.getElementById("mem-play-again");

  const LEADERBOARD_KEY = "gc-memory-leaderboard";
  const leaderboardList = document.getElementById("mem-leaderboard-list");
  const nameInput = document.getElementById("mem-name-input");
  const saveBtn = document.getElementById("mem-save-score");
  const saveRow = document.getElementById("mem-save-row");
  const savedMsg = document.getElementById("mem-saved-msg");
  const langToggle = document.getElementById("lang-toggle");

  // 8 unique shape+color combinations, reusing the site's clip-path shapes.
  const SYMBOLS = [
    { shape: "mem-shape-hex", color: "mem-color-gold" },
    { shape: "mem-shape-hex", color: "mem-color-coral" },
    { shape: "mem-shape-circle", color: "mem-color-coral" },
    { shape: "mem-shape-circle", color: "mem-color-teal" },
    { shape: "mem-shape-triangle", color: "mem-color-teal" },
    { shape: "mem-shape-triangle", color: "mem-color-gold" },
    { shape: "mem-shape-diamond", color: "mem-color-gold" },
    { shape: "mem-shape-diamond", color: "mem-color-coral" },
  ];

  let cards = [];
  let firstPick = null;
  let secondPick = null;
  let locked = false;
  let moves = 0;
  let matches = 0;

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function buildDeck() {
    return shuffle(
      SYMBOLS.flatMap((symbol, symbolIndex) => [
        { symbolIndex, ...symbol },
        { symbolIndex, ...symbol },
      ])
    );
  }

  function render() {
    grid.innerHTML = "";
    cards.forEach((card, index) => {
      const cardEl = document.createElement("div");
      cardEl.className = "mem-card";
      cardEl.dataset.index = String(index);

      cardEl.innerHTML = `
        <button type="button" class="mem-card-inner" aria-label="Memory card">
          <span class="mem-card-back"></span>
          <span class="mem-card-front">
            <span class="mem-symbol ${card.shape} ${card.color}"></span>
          </span>
        </button>
      `;

      cardEl.querySelector(".mem-card-inner").addEventListener("click", () => onCardClick(index, cardEl));
      grid.appendChild(cardEl);
    });
  }

  function updateStats() {
    if (moveCountEl) moveCountEl.textContent = String(moves);
    if (matchCountEl) matchCountEl.textContent = String(matches);
  }

  function onCardClick(index, cardEl) {
    if (locked) return;
    if (cardEl.classList.contains("flipped") || cardEl.classList.contains("matched")) return;

    cardEl.classList.add("flipped");

    if (!firstPick) {
      firstPick = { index, el: cardEl };
      return;
    }

    secondPick = { index, el: cardEl };
    moves += 1;
    updateStats();
    locked = true;

    const isMatch = cards[firstPick.index].symbolIndex === cards[secondPick.index].symbolIndex;

    if (isMatch) {
      firstPick.el.classList.add("matched");
      secondPick.el.classList.add("matched");
      matches += 1;
      updateStats();
      resetPicks();
      if (matches === SYMBOLS.length) onWin();
    } else {
      setTimeout(() => {
        firstPick.el.classList.remove("flipped");
        secondPick.el.classList.remove("flipped");
        resetPicks();
      }, 800);
    }
  }

  function resetPicks() {
    firstPick = null;
    secondPick = null;
    locked = false;
  }

  function spawnConfetti() {
    const confetti = document.createElement("div");
    confetti.className = "mem-confetti";
    confetti.setAttribute("aria-hidden", "true");

    const shapes = ["mem-shape-hex", "mem-shape-circle", "mem-shape-triangle", "mem-shape-diamond"];
    const colors = ["mem-color-gold", "mem-color-coral", "mem-color-teal"];

    for (let i = 0; i < 32; i++) {
      const piece = document.createElement("span");
      const shape = shapes[Math.floor(Math.random() * shapes.length)];
      const color = colors[Math.floor(Math.random() * colors.length)];
      piece.className = `mem-confetti-piece ${shape} ${color}`;
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
      piece.style.animationDelay = `${Math.random() * 0.4}s`;
      confetti.appendChild(piece);
    }

    document.body.appendChild(confetti);
    setTimeout(() => confetti.remove(), 3200);
  }

  function renderLeaderboard() {
    const isAr = document.documentElement.lang === "ar";
    GCLeaderboard.render(leaderboardList, GCLeaderboard.load(LEADERBOARD_KEY), (value) =>
      isAr ? `${value} حركة` : `${value} moves`
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
    GCLeaderboard.addEntry(LEADERBOARD_KEY, { name, value: moves }, (a, b) => a.value - b.value);
    renderLeaderboard();
    if (saveBtn) saveBtn.disabled = true;
    if (nameInput) nameInput.disabled = true;
    if (savedMsg) savedMsg.hidden = false;
  }

  if (saveBtn) saveBtn.addEventListener("click", saveScore);
  if (langToggle) langToggle.addEventListener("click", renderLeaderboard);

  function onWin() {
    if (winMoveCountEl) winMoveCountEl.textContent = String(moves);
    if (winBanner) {
      winBanner.hidden = false;
      winBanner.classList.remove("mem-win-animate");
      // restart the CSS animation even if the banner was already shown before
      void winBanner.offsetWidth;
      winBanner.classList.add("mem-win-animate");
    }
    resetSaveRow();
    spawnConfetti();
  }

  function startGame() {
    cards = buildDeck();
    moves = 0;
    matches = 0;
    resetPicks();
    updateStats();
    if (winBanner) winBanner.hidden = true;
    render();
  }

  if (restartBtn) restartBtn.addEventListener("click", startGame);
  if (playAgainBtn) playAgainBtn.addEventListener("click", startGame);

  renderLeaderboard();
  startGame();
});
