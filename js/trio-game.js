// Game Canvas — "Trio" card game for trio.html.
// Single player vs. two bots. 36 cards, three each of 1-12, dealt 9 to
// each of 3 "hands" (you + 2 bots) with 9 left face-down in the center.
// On your turn, reveal cards one at a time — the low or high end of any
// hand (yours or a bot's), or any center card — trying to find three of
// the same number before you reveal a mismatch. Simple mode wins with
// 3 trios; Spicy mode wins with two "connected" trios (numbers 7 apart,
// or summing to 7); the trio of three 7s wins instantly in either mode.
//
// Bots share a memory map of every card ever revealed on screen (the
// same information a human could remember), plus perfect knowledge of
// their own hand — no hidden extra information beyond that.

document.addEventListener("DOMContentLoaded", () => {
  const board = document.getElementById("trio-board");
  if (!board) return; // trio markup isn't on this page

  const LEADERBOARD_KEY = "gc-trio-leaderboard";

  const turnNameEl = document.getElementById("trio-turn-name");
  const yourCountEl = document.getElementById("trio-your-count");
  const statusEl = document.getElementById("trio-status");
  const restartBtn = document.getElementById("trio-restart");
  const modeSelect = document.getElementById("trio-mode-select");
  const winBanner = document.getElementById("trio-win-banner");
  const winMessageEl = document.getElementById("trio-win-message");
  const saveRow = document.getElementById("trio-save-row");
  const nameInput = document.getElementById("trio-name-input");
  const saveBtn = document.getElementById("trio-save-score");
  const savedMsg = document.getElementById("trio-saved-msg");
  const playAgainBtn = document.getElementById("trio-play-again");
  const leaderboardList = document.getElementById("trio-leaderboard-list");
  const langToggle = document.getElementById("lang-toggle");

  const ZONES = ["you", "bot1", "bot2"];
  const ZONE_LABEL = {
    you: { en: "your hand", ar: "يدك" },
    bot1: { en: "Bot 1's hand", ar: "يد الروبوت 1" },
    bot2: { en: "Bot 2's hand", ar: "يد الروبوت 2" },
    center: { en: "the center", ar: "الوسط" },
  };
  const PLAYER_NAME = {
    you: { en: "You", ar: "أنت" },
    bot1: { en: "Bot 1", ar: "الروبوت 1" },
    bot2: { en: "Bot 2", ar: "الروبوت 2" },
  };

  const REVEAL_DELAY = 700;
  const MISMATCH_HOLD = 1100;
  const TRIO_HOLD = 900;
  const BOT_THINK = 700;

  let mode = "simple";
  let hands; // { you: [{id,value}], bot1: [...], bot2: [...] } sorted ascending
  let center; // [{id, value, claimed}] fixed 9 slots
  let piles; // { you: [values], bot1: [...], bot2: [...] }
  let currentPlayer; // "you" | "bot1" | "bot2"
  let revealedSet; // Set<id> revealed this turn
  let turnRevealed; // [{id, value, zone}] this turn, in order
  let publicMemory; // Map<id, value> — everything ever revealed on screen
  let yourTurnCount;
  let busy;
  let gameOver;
  let gen; // generation counter to invalidate stale timeouts after restart
  let statusKey = null;
  let statusParams = null;

  function isAr() {
    return document.documentElement.lang === "ar";
  }

  function t(dict) {
    return isAr() ? dict.ar : dict.en;
  }

  function fill(str, params) {
    if (!params) return str;
    return Object.keys(params).reduce((s, k) => s.replaceAll(`{${k}}`, params[k]), str);
  }

  const STRINGS = {
    turnYou: { en: "Your turn — pick a card to reveal.", ar: "دورك — اختر بطاقة لتكشفها." },
    turnBot: { en: "{name}'s turn…", ar: "دور {name}…" },
    revealedFirst: { en: "Revealed a {value} from {source}. Find two more!", ar: "كشفت عن {value} من {source}. ابحث عن اثنتين أخريين!" },
    revealedMatch: { en: "Another {value} from {source}! One more for the trio.", ar: "{value} أخرى من {source}! واحدة أخرى للثلاثية." },
    trioWon: { en: "Trio of {value}s! {name} collected it.", ar: "ثلاثية من {value}! {name} جمعتها." },
    mismatch: { en: "No match — {source} had a {value}. Turn passes to {next}.", ar: "لا تطابق — {source} كانت فيها {value}. ينتقل الدور إلى {next}." },
    youWinSimple: { en: "You win! Three trios collected first.", ar: "لقد فزت! جمعت ثلاث ثلاثيات أولاً." },
    youWinSpicy: { en: "You win! Two connected trios collected.", ar: "لقد فزت! جمعت ثلاثيتين مترابطتين." },
    youWinSeven: { en: "You win! The trio of 7s is an instant win.", ar: "لقد فزت! ثلاثية الرقم 7 فوز فوري." },
    botWinSimple: { en: "{name} wins with three trios. Better luck next time!", ar: "{name} يفوز بثلاث ثلاثيات. حظ أوفر في المرة القادمة!" },
    botWinSpicy: { en: "{name} wins with two connected trios. Better luck next time!", ar: "{name} يفوز بثلاثيتين مترابطتين. حظ أوفر في المرة القادمة!" },
    botWinSeven: { en: "{name} wins instantly with the trio of 7s!", ar: "{name} يفوز فورًا بثلاثية الرقم 7!" },
    stalemate: {
      en: "No trio can be reached any more — the round is a draw. Restart for a fresh deal.",
      ar: "لم يعد بالإمكان الوصول إلى أي ثلاثية — الجولة تعادل. أعد البدء لتوزيع جديد.",
    },
  };

  function setStatus(key, params) {
    statusKey = key;
    statusParams = params;
    renderStatus();
  }

  function renderStatus() {
    if (!statusEl || !statusKey) return;
    statusEl.textContent = fill(t(STRINGS[statusKey]), statusParams);
  }

  function zoneLabel(zone) {
    return t(ZONE_LABEL[zone]);
  }

  function playerName(zone) {
    return t(PLAYER_NAME[zone]);
  }

  // ---------- setup ----------

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function buildDeck() {
    const cards = [];
    let id = 0;
    for (let value = 1; value <= 12; value++) {
      for (let k = 0; k < 3; k++) cards.push({ id: id++, value });
    }
    return shuffle(cards);
  }

  function connectors(value) {
    const out = new Set();
    [7 - value, value - 7, value + 7].forEach((c) => {
      if (c >= 1 && c <= 12) out.add(c);
    });
    return out;
  }

  // Only 15 positions are ever reachable (each hand's low + high end, plus
  // the unclaimed centre), and that set cannot change until a trio is
  // removed. So if no value has 3 copies among them, no trio can EVER be
  // formed: turns pass forever with nothing to find. Roughly 10% of
  // random 3-player deals are born in exactly that state, which is what
  // made whole games run with zero trios collected.
  function hasReachableTrio(handsMap, centerArr) {
    const counts = new Map();
    const bump = (v) => counts.set(v, (counts.get(v) || 0) + 1);
    ZONES.forEach((zone) => {
      const arr = handsMap[zone];
      if (!arr.length) return;
      bump(arr[0].value);
      if (arr.length > 1) bump(arr[arr.length - 1].value);
    });
    centerArr.forEach((c) => {
      if (!c.claimed) bump(c.value);
    });
    for (const n of counts.values()) if (n >= 3) return true;
    return false;
  }

  function startGame() {
    gen = (gen || 0) + 1;
    busy = false;
    gameOver = false;
    yourTurnCount = 0;
    revealedSet = new Set();
    turnRevealed = [];
    publicMemory = new Map();

    // Reshuffle past deals that are dead on arrival. The bound is pure
    // paranoia — a winnable deal is ~90% likely each attempt.
    for (let attempt = 0; attempt < 200; attempt++) {
      const deck = buildDeck();
      hands = {
        you: deck.slice(0, 9).sort((a, b) => a.value - b.value),
        bot1: deck.slice(9, 18).sort((a, b) => a.value - b.value),
        bot2: deck.slice(18, 27).sort((a, b) => a.value - b.value),
      };
      center = deck.slice(27, 36).map((c) => ({ ...c, claimed: false }));
      if (hasReachableTrio(hands, center)) break;
    }
    piles = { you: [], bot1: [], bot2: [] };
    currentPlayer = "you";

    if (winBanner) winBanner.hidden = true;
    setStatus("turnYou");
    renderAll();
  }

  // ---------- accessible positions ----------

  function getAccessiblePositions() {
    const list = [];
    ZONES.forEach((zone) => {
      const arr = hands[zone];
      if (!arr.length) return;
      if (!revealedSet.has(arr[0].id)) list.push({ zone, end: "low", card: arr[0] });
      if (arr.length > 1 && !revealedSet.has(arr[arr.length - 1].id)) {
        list.push({ zone, end: "high", card: arr[arr.length - 1] });
      }
    });
    center.forEach((c, idx) => {
      if (!c.claimed && !revealedSet.has(c.id)) list.push({ zone: "center", idx, card: c });
    });
    return list;
  }

  function isPositionAccessible(zone, cardId) {
    return getAccessiblePositions().some((p) => p.zone === zone && p.card.id === cardId);
  }

  // ---------- turn engine ----------

  function nextPlayer(p) {
    const i = ZONES.indexOf(p);
    return ZONES[(i + 1) % ZONES.length];
  }

  function reveal(pos) {
    if (busy || gameOver) return;
    revealedSet.add(pos.card.id);
    publicMemory.set(pos.card.id, pos.card.value);
    turnRevealed.push({ id: pos.card.id, value: pos.card.value, zone: pos.zone });
    renderAll();

    const myGen = gen;
    busy = true;

    if (turnRevealed.length === 1) {
      setStatus("revealedFirst", { value: pos.card.value, source: zoneLabel(pos.zone) });
      setTimeout(() => {
        if (gen !== myGen) return;
        busy = false;
        continueTurn();
      }, REVEAL_DELAY);
      return;
    }

    const target = turnRevealed[0].value;
    if (pos.card.value === target) {
      if (turnRevealed.length === 3) {
        setTimeout(() => {
          if (gen !== myGen) return;
          completeTrio();
        }, TRIO_HOLD);
      } else {
        setStatus("revealedMatch", { value: pos.card.value, source: zoneLabel(pos.zone) });
        setTimeout(() => {
          if (gen !== myGen) return;
          busy = false;
          continueTurn();
        }, REVEAL_DELAY);
      }
      return;
    }

    // mismatch
    setStatus("mismatch", {
      source: zoneLabel(pos.zone),
      value: pos.card.value,
      next: playerName(nextPlayer(currentPlayer)),
    });
    setTimeout(() => {
      if (gen !== myGen) return;
      revealedSet.clear();
      turnRevealed = [];
      renderAll();
      endTurn();
    }, MISMATCH_HOLD);
  }

  function completeTrio() {
    const myGen = gen;
    const value = turnRevealed[0].value;
    turnRevealed.forEach((entry) => {
      if (entry.zone === "center") {
        const slot = center.find((c) => c.id === entry.id);
        if (slot) slot.claimed = true;
      } else {
        hands[entry.zone] = hands[entry.zone].filter((c) => c.id !== entry.id);
      }
    });
    piles[currentPlayer].push(value);
    revealedSet.clear();
    turnRevealed = [];
    renderAll();

    const win = checkWin(currentPlayer);
    setStatus("trioWon", { value, name: playerName(currentPlayer) });
    if (win) {
      setTimeout(() => {
        if (gen !== myGen) return;
        announceWin(currentPlayer, win);
      }, TRIO_HOLD);
      return;
    }

    // Removing a trio exposes new hand ends, so a position that was live
    // a moment ago can become unreachable. Without this the round would
    // silently run forever, exactly as an unwinnable opening deal did.
    if (!hasReachableTrio(hands, center)) {
      setTimeout(() => {
        if (gen !== myGen) return;
        announceStalemate();
      }, TRIO_HOLD);
      return;
    }

    setTimeout(() => {
      if (gen !== myGen) return;
      endTurn();
    }, TRIO_HOLD);
  }

  function announceStalemate() {
    gameOver = true;
    busy = true;
    setStatus("stalemate");
    if (winMessageEl) winMessageEl.textContent = t(STRINGS.stalemate);
    if (saveRow) saveRow.hidden = true;
    if (winBanner) winBanner.hidden = false;
    renderAll();
  }

  function checkWin(player) {
    const trios = piles[player];
    if (trios.includes(7)) return "seven";
    if (mode === "simple") return trios.length >= 3 ? "simple" : null;
    for (let i = 0; i < trios.length; i++) {
      for (let j = i + 1; j < trios.length; j++) {
        if (connectors(trios[i]).has(trios[j])) return "spicy";
      }
    }
    return null;
  }

  function endTurn() {
    const myGen = gen;
    if (currentPlayer === "you") yourTurnCount += 1;
    currentPlayer = nextPlayer(currentPlayer);
    busy = false;
    renderAll();
    if (currentPlayer === "you") {
      setStatus("turnYou");
    } else {
      setStatus("turnBot", { name: playerName(currentPlayer) });
      busy = true;
      setTimeout(() => {
        if (gen !== myGen) return;
        busy = false;
        continueTurn();
      }, BOT_THINK);
    }
  }

  function continueTurn() {
    if (gameOver) return;
    if (currentPlayer === "you") return; // wait for a click
    const pos = pickBotMove();
    if (pos) reveal(pos);
  }

  function announceWin(player, kind) {
    gameOver = true;
    busy = true;
    const won = player === "you";
    const key = won
      ? kind === "seven" ? "youWinSeven" : kind === "spicy" ? "youWinSpicy" : "youWinSimple"
      : kind === "seven" ? "botWinSeven" : kind === "spicy" ? "botWinSpicy" : "botWinSimple";
    setStatus(key, { name: playerName(player) });

    if (winMessageEl) winMessageEl.textContent = fill(t(STRINGS[key]), { name: playerName(player) });
    if (winBanner) winBanner.hidden = false;

    if (won) {
      if (saveRow) saveRow.hidden = false;
      if (savedMsg) savedMsg.hidden = true;
      if (nameInput) {
        nameInput.value = GCLeaderboard.getSavedName();
        nameInput.disabled = false;
      }
      if (saveBtn) saveBtn.disabled = false;
    } else if (saveRow) {
      saveRow.hidden = true;
    }
  }

  // ---------- bot AI ----------

  function knownValueOf(id, zone) {
    if (publicMemory.has(id)) return publicMemory.get(id);
    if (zone === currentPlayer) {
      const card = hands[currentPlayer].find((c) => c.id === id);
      if (card) return card.value;
    }
    return null;
  }

  function pickBotMove() {
    const accessible = getAccessiblePositions();
    if (!accessible.length) return null;

    if (turnRevealed.length === 0) {
      // Look for any value with 2+ currently-known accessible copies.
      const byValue = new Map();
      accessible.forEach((pos) => {
        const v = knownValueOf(pos.card.id, pos.zone);
        if (v == null) return;
        if (!byValue.has(v)) byValue.set(v, []);
        byValue.get(v).push(pos);
      });
      for (const [, positions] of byValue) {
        if (positions.length >= 2) return positions[0];
      }
      // No known pair — reveal something unknown to gather information.
      const unknown = accessible.filter((pos) => knownValueOf(pos.card.id, pos.zone) == null);
      const pool = unknown.length ? unknown : accessible;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    const target = turnRevealed[0].value;
    // A known accessible copy of the target value wins outright.
    const knownMatch = accessible.find((pos) => knownValueOf(pos.card.id, pos.zone) === target);
    if (knownMatch) return knownMatch;

    // Avoid positions known to be a different value; guess among the rest.
    const safeGuesses = accessible.filter((pos) => {
      const v = knownValueOf(pos.card.id, pos.zone);
      return v == null;
    });
    const pool = safeGuesses.length ? safeGuesses : accessible;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---------- rendering ----------

  function makeCardEl(tag, faceUp, value, extraClass) {
    const el = document.createElement(tag);
    if (tag === "button") el.type = "button";
    el.className = `trio-card ${faceUp ? "trio-flipped" : ""} ${extraClass || ""}`.trim();

    const inner = document.createElement("span");
    inner.className = "trio-card-inner";

    const back = document.createElement("span");
    back.className = "trio-card-back";

    const front = document.createElement("span");
    front.className = "trio-card-front";
    // Only ever write the value once the card is actually revealed —
    // a face-down card's front stays empty in the DOM, not just
    // visually rotated away, so it can't be read via devtools.
    if (faceUp) front.textContent = String(value);

    inner.append(back, front);
    el.appendChild(inner);
    return el;
  }

  function renderHand(zone) {
    const el = document.getElementById(`trio-hand-${zone}`);
    const countEl = document.getElementById(`trio-${zone}-count`);
    if (!el) return;
    el.innerHTML = "";
    const arr = hands[zone];
    if (countEl) countEl.textContent = String(arr.length);

    arr.forEach((card, idx) => {
      const isEnd = idx === 0 || idx === arr.length - 1;
      const faceUp = zone === "you" || revealedSet.has(card.id);
      const clickable =
        currentPlayer === "you" && !busy && !gameOver && isEnd && isPositionAccessible(zone, card.id);

      const cardEl = makeCardEl(
        clickable ? "button" : "div",
        faceUp,
        card.value,
        revealedSet.has(card.id) ? "trio-revealed" : ""
      );
      if (clickable) {
        cardEl.addEventListener("click", () => {
          const end = idx === 0 ? "low" : "high";
          reveal({ zone, end, card });
        });
      }
      el.appendChild(cardEl);
    });
  }

  function renderCenter() {
    const el = document.getElementById("trio-center-grid");
    if (!el) return;
    el.innerHTML = "";
    center.forEach((c, idx) => {
      if (c.claimed) {
        const empty = document.createElement("div");
        empty.className = "trio-card trio-card-empty";
        el.appendChild(empty);
        return;
      }
      const faceUp = revealedSet.has(c.id);
      const clickable =
        currentPlayer === "you" && !busy && !gameOver && isPositionAccessible("center", c.id);
      const cardEl = makeCardEl(
        clickable ? "button" : "div",
        faceUp,
        c.value,
        revealedSet.has(c.id) ? "trio-revealed" : ""
      );
      if (clickable) {
        cardEl.addEventListener("click", () => reveal({ zone: "center", idx, card: c }));
      }
      el.appendChild(cardEl);
    });
  }

  function renderPiles(zone) {
    const el = document.getElementById(`trio-piles-${zone}`);
    if (!el) return;
    el.innerHTML = "";
    piles[zone].forEach((value) => {
      const chip = document.createElement("span");
      chip.className = "trio-pile-chip";
      chip.textContent = String(value);
      el.appendChild(chip);
    });
  }

  function renderTurnBar() {
    if (turnNameEl) turnNameEl.textContent = playerName(currentPlayer);
    if (yourCountEl) yourCountEl.textContent = String(piles.you.length);
    ZONES.forEach((zone) => {
      const zoneEl = document.getElementById(`trio-zone-${zone}`);
      if (zoneEl) zoneEl.classList.toggle("trio-zone-active", zone === currentPlayer);
    });
  }

  function renderAll() {
    ZONES.forEach((zone) => {
      renderHand(zone);
      renderPiles(zone);
    });
    renderCenter();
    renderTurnBar();
  }

  // ---------- leaderboard ----------

  function renderLeaderboard() {
    GCLeaderboard.render(leaderboardList, GCLeaderboard.load(LEADERBOARD_KEY), (value) =>
      isAr() ? `${value} دورًا` : `${value} turns`
    );
  }

  function saveScore() {
    const raw = nameInput ? nameInput.value.trim() : "";
    const name = raw ? raw.slice(0, 18) : isAr() ? "مجهول" : "Anonymous";
    GCLeaderboard.setSavedName(name);
    GCLeaderboard.addEntry(LEADERBOARD_KEY, { name, value: yourTurnCount }, (a, b) => a.value - b.value);
    renderLeaderboard();
    if (saveBtn) saveBtn.disabled = true;
    if (nameInput) nameInput.disabled = true;
    if (savedMsg) savedMsg.hidden = false;
  }

  // ---------- wiring ----------

  if (restartBtn) restartBtn.addEventListener("click", startGame);
  if (playAgainBtn) playAgainBtn.addEventListener("click", startGame);
  if (saveBtn) saveBtn.addEventListener("click", saveScore);

  if (modeSelect) {
    modeSelect.querySelectorAll(".trio-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        mode = btn.dataset.mode;
        modeSelect.querySelectorAll(".trio-mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
        startGame();
      });
    });
  }

  if (langToggle) {
    langToggle.addEventListener("click", () => {
      renderLeaderboard();
      renderTurnBar();
      renderStatus();
    });
  }

  renderLeaderboard();
  startGame();
});
