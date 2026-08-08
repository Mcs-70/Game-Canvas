// Game Canvas — "Trio, Play with a Friend" for trio-multiplayer.html.
//
// Two browsers stay in sync via a Firebase Realtime Database room. Hidden
// hands are never sent over the network: the room only stores a shared
// random seed, and both clients independently deal the exact same deck
// from it. Only *positions* revealed ("low card of p2's hand", "center
// slot 4") are written to the room's action log — never card values — so
// casual play never leaks hidden information over the wire. (A player
// who deliberately opens devtools and re-runs the same public shuffle
// function could reconstruct hidden cards; that's a limitation of any
// client-authoritative browser game without a trusted server, same as
// the vs-bots version's bot "memory".)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  push,
  onValue,
  onChildAdded,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

document.addEventListener("DOMContentLoaded", () => {
  const lobby = document.getElementById("tmpl-lobby");
  if (!lobby) return; // multiplayer markup isn't on this page

  const errorEl = document.getElementById("tmpl-error");
  const createNameInput = document.getElementById("tmpl-create-name");
  const createBtn = document.getElementById("tmpl-create-btn");
  const modeSelect = document.getElementById("tmpl-mode-select");
  const joinNameInput = document.getElementById("tmpl-join-name");
  const joinCodeInput = document.getElementById("tmpl-join-code");
  const joinBtn = document.getElementById("tmpl-join-btn");

  const waitingEl = document.getElementById("tmpl-waiting");
  const roomCodeDisplay = document.getElementById("tmpl-room-code-display");
  const copyCodeBtn = document.getElementById("tmpl-copy-code");
  const cancelRoomBtn = document.getElementById("tmpl-cancel-room");

  const gameEl = document.getElementById("tmpl-game");
  const roomLabelEl = document.getElementById("tmpl-room-label");
  const turnNameEl = document.getElementById("tmpl-turn-name");
  const statusEl = document.getElementById("tmpl-status");
  const oppNameEl = document.getElementById("tmpl-opp-name");

  const winBanner = document.getElementById("tmpl-win-banner");
  const winMessageEl = document.getElementById("tmpl-win-message");
  const rematchBtn = document.getElementById("tmpl-rematch-btn");
  const leaveBtn = document.getElementById("tmpl-leave-btn");
  const langToggle = document.getElementById("lang-toggle");

  if (!isFirebaseConfigured()) {
    showError(
      "Multiplayer isn't set up yet — fill in js/firebase-config.js with your Firebase project's config.",
      "الوضع الجماعي غير مُعدّ بعد — أدخل بيانات مشروع Firebase في js/firebase-config.js."
    );
    if (createBtn) createBtn.disabled = true;
    if (joinBtn) joinBtn.disabled = true;
    return;
  }

  const app = initializeApp(firebaseConfig);
  const db = getDatabase(app);

  const REVEAL_DELAY = 700;
  const MISMATCH_HOLD = 1100;
  const TRIO_HOLD = 900;
  const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

  const STRINGS = {
    yourTurn: { en: "Your turn — pick a card to reveal.", ar: "دورك — اختر بطاقة لتكشفها." },
    opponentTurn: { en: "{name}'s turn — waiting…", ar: "دور {name} — بالانتظار…" },
    revealedFirst: { en: "Revealed a {value} from {source}. Find two more!", ar: "كشفت عن {value} من {source}. ابحث عن اثنتين أخريين!" },
    revealedMatch: { en: "Another {value} from {source}! One more for the trio.", ar: "{value} أخرى من {source}! واحدة أخرى للثلاثية." },
    trioWon: { en: "Trio of {value}s! {name} collected it.", ar: "ثلاثية من {value}! {name} جمعتها." },
    mismatch: { en: "No match — {source} had a {value}. Turn passes to {next}.", ar: "لا تطابق — {source} كانت فيها {value}. ينتقل الدور إلى {next}." },
    youWinSimple: { en: "You win! Three trios collected first.", ar: "لقد فزت! جمعت ثلاث ثلاثيات أولاً." },
    youWinSpicy: { en: "You win! Two connected trios collected.", ar: "لقد فزت! جمعت ثلاثيتين مترابطتين." },
    youWinSeven: { en: "You win! The trio of 7s is an instant win.", ar: "لقد فزت! ثلاثية الرقم 7 فوز فوري." },
    oppWinSimple: { en: "{name} wins with three trios. Better luck next time!", ar: "{name} يفوز بثلاث ثلاثيات. حظ أوفر في المرة القادمة!" },
    oppWinSpicy: { en: "{name} wins with two connected trios. Better luck next time!", ar: "{name} يفوز بثلاثيتين مترابطتين. حظ أوفر في المرة القادمة!" },
    oppWinSeven: { en: "{name} wins instantly with the trio of 7s!", ar: "{name} يفوز فورًا بثلاثية الرقم 7!" },
  };

  let mode = "simple";
  let roomCode = null;
  let myRole = null; // "p1" | "p2"
  let myName = "";
  let opponentName = "";
  let hands, center, piles, currentPlayer;
  let revealedSet, turnRevealed;
  let queue = [];
  let locked = false;
  let gameOver = false;
  let lastKnownSeed = null;
  let statusKey = null;
  let statusParams = null;

  let unsubGuestName = null;
  let unsubSeed = null;
  let unsubActions = null;

  // ---------- language helpers ----------

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

  function setStatus(key, params) {
    statusKey = key;
    statusParams = params;
    renderStatus();
  }

  function renderStatus() {
    if (!statusEl || !statusKey) return;
    statusEl.textContent = fill(t(STRINGS[statusKey]), statusParams);
  }

  function showError(en, ar) {
    if (!errorEl) return;
    errorEl.textContent = isAr() ? ar : en;
    errorEl.hidden = false;
  }

  function clearError() {
    if (errorEl) errorEl.hidden = true;
  }

  // ---------- deterministic seeded deal ----------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(array, rng) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function dealFromSeed(seed) {
    const rng = mulberry32(seed);
    const cards = [];
    let id = 0;
    for (let value = 1; value <= 12; value++) {
      for (let k = 0; k < 3; k++) cards.push({ id: id++, value });
    }
    seededShuffle(cards, rng);
    return {
      p1: cards.slice(0, 9).sort((a, b) => a.value - b.value),
      p2: cards.slice(9, 18).sort((a, b) => a.value - b.value),
      center: cards.slice(18, 36).map((c) => ({ ...c, claimed: false })),
    };
  }

  function connectors(value) {
    const out = new Set();
    [7 - value, value - 7, value + 7].forEach((c) => {
      if (c >= 1 && c <= 12) out.add(c);
    });
    return out;
  }

  function genRoomCode() {
    let code = "";
    for (let i = 0; i < 5; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    return code;
  }

  function otherRole(role) {
    return role === "p1" ? "p2" : "p1";
  }

  function playerName(role) {
    if (role === myRole) return isAr() ? "أنت" : "You";
    return opponentName;
  }

  function zoneLabel(zone) {
    if (zone === "center") return isAr() ? "الوسط" : "the center";
    if (zone === myRole) return isAr() ? "يدك" : "your hand";
    return isAr() ? `يد ${opponentName}` : `${opponentName}'s hand`;
  }

  // ---------- lobby: create ----------

  if (modeSelect) {
    modeSelect.querySelectorAll(".trio-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        mode = btn.dataset.mode;
        modeSelect.querySelectorAll(".trio-mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
      });
    });
  }

  if (createBtn) {
    createBtn.addEventListener("click", async () => {
      clearError();
      const name = (createNameInput.value.trim() || (isAr() ? "لاعب 1" : "Player 1")).slice(0, 18);
      const code = genRoomCode();
      const seed = Math.floor(Math.random() * 2 ** 31);
      createBtn.disabled = true;
      try {
        await set(ref(db, `trioRooms/${code}`), {
          mode,
          seed,
          hostName: name,
          guestName: null,
          createdAt: Date.now(),
        });
      } catch (e) {
        showError("Couldn't create the room. Check your Firebase setup and try again.", "تعذّر إنشاء الغرفة. تحقق من إعداد Firebase وحاول مجددًا.");
        createBtn.disabled = false;
        return;
      }

      myRole = "p1";
      myName = name;
      roomCode = code;

      lobby.hidden = true;
      waitingEl.hidden = false;
      roomCodeDisplay.textContent = code;

      unsubGuestName = onValue(ref(db, `trioRooms/${code}/guestName`), (snap) => {
        const guestName = snap.val();
        if (guestName) {
          if (unsubGuestName) unsubGuestName();
          opponentName = guestName;
          waitingEl.hidden = true;
          enterGame(seed, mode);
        }
      });
    });
  }

  if (copyCodeBtn) {
    copyCodeBtn.addEventListener("click", () => {
      if (roomCode && navigator.clipboard) navigator.clipboard.writeText(roomCode).catch(() => {});
    });
  }

  if (cancelRoomBtn) {
    cancelRoomBtn.addEventListener("click", () => {
      if (unsubGuestName) unsubGuestName();
      resetToLobby();
    });
  }

  // ---------- lobby: join ----------

  if (joinBtn) {
    joinBtn.addEventListener("click", async () => {
      clearError();
      const name = (joinNameInput.value.trim() || (isAr() ? "لاعب 2" : "Player 2")).slice(0, 18);
      const code = joinCodeInput.value.trim().toUpperCase();
      if (!code) {
        showError("Enter a room code to join.", "أدخل رمز الغرفة للانضمام.");
        return;
      }

      joinBtn.disabled = true;
      let snap;
      try {
        snap = await get(ref(db, `trioRooms/${code}`));
      } catch (e) {
        showError("Couldn't reach the room. Check your Firebase setup and try again.", "تعذّر الوصول إلى الغرفة. تحقق من إعداد Firebase وحاول مجددًا.");
        joinBtn.disabled = false;
        return;
      }

      if (!snap.exists()) {
        showError("Room not found. Double-check the code.", "لم يتم العثور على الغرفة. تحقق من الرمز.");
        joinBtn.disabled = false;
        return;
      }
      const data = snap.val();
      if (data.guestName) {
        showError("That room is already full.", "هذه الغرفة ممتلئة بالفعل.");
        joinBtn.disabled = false;
        return;
      }

      await update(ref(db, `trioRooms/${code}`), { guestName: name });

      myRole = "p2";
      myName = name;
      roomCode = code;
      opponentName = data.hostName;
      mode = data.mode;

      lobby.hidden = true;
      enterGame(data.seed, data.mode);
    });
  }

  // ---------- entering / resetting the game ----------

  function enterGame(seed, gameMode) {
    mode = gameMode;
    if (roomLabelEl) roomLabelEl.textContent = roomCode;
    if (oppNameEl) oppNameEl.textContent = opponentName;
    gameEl.hidden = false;
    if (winBanner) winBanner.hidden = true;

    resetLocalState(seed);
    renderAll();
    setStatus(currentPlayer === myRole ? "yourTurn" : "opponentTurn", { name: playerName(currentPlayer) });

    lastKnownSeed = seed;
    if (!unsubSeed) {
      unsubSeed = onValue(ref(db, `trioRooms/${roomCode}/seed`), (snap) => {
        const newSeed = snap.val();
        if (newSeed == null || newSeed === lastKnownSeed) return;
        lastKnownSeed = newSeed;
        gameOver = false;
        if (winBanner) winBanner.hidden = true;
        gameEl.hidden = false;
        resetLocalState(newSeed);
        renderAll();
        setStatus(currentPlayer === myRole ? "yourTurn" : "opponentTurn", { name: playerName(currentPlayer) });
        attachActionListener();
      });
    }

    attachActionListener();
  }

  function resetLocalState(seed) {
    const dealt = dealFromSeed(seed);
    hands = { p1: dealt.p1, p2: dealt.p2 };
    center = dealt.center;
    piles = { p1: [], p2: [] };
    currentPlayer = "p1";
    revealedSet = new Set();
    turnRevealed = [];
    queue = [];
    locked = false;
    gameOver = false;
  }

  async function attachActionListener() {
    if (unsubActions) {
      unsubActions();
      unsubActions = null;
    }
    const actionsRef = ref(db, `trioRooms/${roomCode}/actions`);
    let existing = 0;
    try {
      const snap = await get(actionsRef);
      existing = snap.exists() ? Object.keys(snap.val()).length : 0;
    } catch (e) {
      existing = 0;
    }
    let seen = 0;
    unsubActions = onChildAdded(actionsRef, (child) => {
      seen += 1;
      queue.push({ action: child.val(), instant: seen <= existing });
      pump();
    });
  }

  // ---------- turn engine ----------

  function getAccessiblePositions() {
    const list = [];
    ["p1", "p2"].forEach((zone) => {
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

  function trySend(zone, end, idx) {
    if (locked || gameOver || currentPlayer !== myRole) return;
    // Note: no optimistic local lock here — the card only becomes
    // "revealed" once this action round-trips back through
    // onChildAdded and applyAction() processes it (the single source
    // of truth for state changes). Locking here too would leave
    // `locked` stuck true forever, since only applyAction() clears it.
    const action = { by: myRole, ts: Date.now(), zone };
    if (zone === "center") action.idx = idx;
    else action.end = end;
    push(ref(db, `trioRooms/${roomCode}/actions`), action);
  }

  function pump() {
    if (locked) return;
    if (!queue.length) return;
    locked = true;
    const { action, instant } = queue.shift();
    applyAction(action, instant);
  }

  function after(ms, fn, instant) {
    if (instant) fn();
    else setTimeout(fn, ms);
  }

  function applyAction(action, instant) {
    if (gameOver || action.by !== currentPlayer) {
      locked = false;
      pump();
      return;
    }
    const arr = action.zone === "center" ? center : hands[action.zone];
    const card = action.zone === "center" ? arr[action.idx] : action.end === "low" ? arr[0] : arr[arr.length - 1];
    if (!card || card.claimed || revealedSet.has(card.id)) {
      locked = false;
      pump();
      return;
    }

    revealedSet.add(card.id);
    turnRevealed.push({ id: card.id, value: card.value, zone: action.zone });
    renderAll();

    if (turnRevealed.length === 1) {
      setStatus("revealedFirst", { value: card.value, source: zoneLabel(action.zone) });
      after(REVEAL_DELAY, () => {
        locked = false;
        renderAll();
        pump();
      }, instant);
      return;
    }

    const target = turnRevealed[0].value;
    if (card.value === target) {
      if (turnRevealed.length === 3) {
        after(TRIO_HOLD, () => resolveTrio(instant), instant);
      } else {
        setStatus("revealedMatch", { value: card.value, source: zoneLabel(action.zone) });
        after(REVEAL_DELAY, () => {
          locked = false;
          renderAll();
          pump();
        }, instant);
      }
      return;
    }

    // mismatch
    setStatus("mismatch", {
      source: zoneLabel(action.zone),
      value: card.value,
      next: playerName(otherRole(currentPlayer)),
    });
    after(MISMATCH_HOLD, () => {
      revealedSet.clear();
      turnRevealed = [];
      renderAll();
      endTurn(instant);
    }, instant);
  }

  function resolveTrio(instant) {
    const value = turnRevealed[0].value;
    const winner = currentPlayer;
    turnRevealed.forEach((entry) => {
      if (entry.zone === "center") {
        const slot = center.find((c) => c.id === entry.id);
        if (slot) slot.claimed = true;
      } else {
        hands[entry.zone] = hands[entry.zone].filter((c) => c.id !== entry.id);
      }
    });
    piles[winner].push(value);
    revealedSet.clear();
    turnRevealed = [];
    renderAll();

    const win = checkWin(winner);
    setStatus("trioWon", { value, name: playerName(winner) });
    if (win) {
      after(TRIO_HOLD, () => announceWin(winner, win), instant);
      return;
    }
    after(TRIO_HOLD, () => endTurn(instant), instant);
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

  function endTurn(instant) {
    currentPlayer = otherRole(currentPlayer);
    locked = false;
    renderAll();
    setStatus(currentPlayer === myRole ? "yourTurn" : "opponentTurn", { name: playerName(currentPlayer) });
    pump();
  }

  function announceWin(player, kind) {
    gameOver = true;
    locked = true;
    const won = player === myRole;
    const key = won
      ? kind === "seven" ? "youWinSeven" : kind === "spicy" ? "youWinSpicy" : "youWinSimple"
      : kind === "seven" ? "oppWinSeven" : kind === "spicy" ? "oppWinSpicy" : "oppWinSimple";
    const params = { name: playerName(player) };
    setStatus(key, params);
    if (winMessageEl) winMessageEl.textContent = fill(t(STRINGS[key]), params);
    if (winBanner) winBanner.hidden = false;
    renderAll();
  }

  // ---------- rematch / leave ----------

  if (rematchBtn) {
    rematchBtn.addEventListener("click", async () => {
      if (!roomCode) return;
      const newSeed = Math.floor(Math.random() * 2 ** 31);
      rematchBtn.disabled = true;
      try {
        await update(ref(db, `trioRooms/${roomCode}`), { seed: newSeed, actions: null });
      } catch (e) {
        // onValue listener elsewhere will pick up the change if it did land; nothing more to do here
      }
      rematchBtn.disabled = false;
    });
  }

  if (leaveBtn) leaveBtn.addEventListener("click", leaveRoom);

  function leaveRoom() {
    if (unsubGuestName) unsubGuestName();
    if (unsubSeed) unsubSeed();
    if (unsubActions) unsubActions();
    unsubGuestName = unsubSeed = unsubActions = null;
    resetToLobby();
  }

  function resetToLobby() {
    roomCode = null;
    myRole = null;
    gameOver = false;
    if (gameEl) gameEl.hidden = true;
    if (waitingEl) waitingEl.hidden = true;
    if (winBanner) winBanner.hidden = true;
    if (lobby) lobby.hidden = false;
    if (createBtn) createBtn.disabled = false;
    if (joinBtn) joinBtn.disabled = false;
    clearError();
  }

  // ---------- rendering ----------

  function makeCardEl(tag, faceUp, value, extraClass) {
    const el = document.createElement(tag);
    if (tag === "button") el.type = "button";
    el.className = `trio-card ${faceUp ? "" : "trio-card-back"} ${extraClass || ""}`.trim();
    if (faceUp) el.textContent = String(value);
    return el;
  }

  function domIdsFor(zone) {
    if (zone === myRole) return { hand: "tmpl-hand-you", count: "tmpl-you-count", piles: "tmpl-piles-you" };
    return { hand: "tmpl-hand-opp", count: "tmpl-opp-count", piles: "tmpl-piles-opp" };
  }

  function renderHand(zone) {
    const ids = domIdsFor(zone);
    const el = document.getElementById(ids.hand);
    const countEl = document.getElementById(ids.count);
    if (!el) return;
    el.innerHTML = "";
    const arr = hands[zone];
    if (countEl) countEl.textContent = String(arr.length);

    arr.forEach((card, idx) => {
      const isEnd = idx === 0 || idx === arr.length - 1;
      const faceUp = zone === myRole || revealedSet.has(card.id);
      const clickable =
        currentPlayer === myRole && !locked && !gameOver && isEnd && isPositionAccessible(zone, card.id);

      const cardEl = makeCardEl(
        clickable ? "button" : "div",
        faceUp,
        card.value,
        revealedSet.has(card.id) ? "trio-revealed" : ""
      );
      if (clickable) {
        cardEl.addEventListener("click", () => trySend(zone, idx === 0 ? "low" : "high"));
      }
      el.appendChild(cardEl);
    });
  }

  function renderCenter() {
    const el = document.getElementById("tmpl-center-grid");
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
      const clickable = currentPlayer === myRole && !locked && !gameOver && isPositionAccessible("center", c.id);
      const cardEl = makeCardEl(
        clickable ? "button" : "div",
        faceUp,
        c.value,
        revealedSet.has(c.id) ? "trio-revealed" : ""
      );
      if (clickable) {
        cardEl.addEventListener("click", () => trySend("center", null, idx));
      }
      el.appendChild(cardEl);
    });
  }

  function renderPiles(zone) {
    const ids = domIdsFor(zone);
    const el = document.getElementById(ids.piles);
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
    if (oppNameEl) oppNameEl.textContent = opponentName;
  }

  function renderAll() {
    if (!hands) return;
    ["p1", "p2"].forEach((zone) => {
      renderHand(zone);
      renderPiles(zone);
    });
    renderCenter();
    renderTurnBar();
  }

  if (langToggle) {
    langToggle.addEventListener("click", () => {
      renderStatus();
      renderTurnBar();
    });
  }
});
