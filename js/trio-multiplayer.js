// Game Canvas — "Trio, Play with a Friend(s)" for trio-multiplayer.html.
//
// Rooms support 3-6 players, matching Trio's actual rulebook (hand sizes
// 9/7/6/5 cards for 3/4/5/6 players, remainder to the center). Players
// trickle into a room lobby; the host starts once there are at least 3.
// Joining is done via a Firebase Realtime Database transaction on the
// whole room object so concurrent joins can't collide on the same seat,
// and can't sneak in once the host has started or the room is full.
//
// Hidden hands are never sent over the network: the room only stores a
// shared random seed (chosen once the roster is locked in at start),
// and every client independently deals the same deck from it. Only
// *positions* revealed are written to the action log — never values —
// so casual play never leaks hidden information over the wire. (A
// player who deliberately opens devtools and re-runs the same public
// shuffle function could reconstruct hidden cards; that's a limitation
// of any client-authoritative browser game without a trusted server.)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  push,
  runTransaction,
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

  const roomLobbyEl = document.getElementById("tmpl-room-lobby");
  const roomCodeDisplay = document.getElementById("tmpl-room-code-display");
  const copyCodeBtn = document.getElementById("tmpl-copy-code");
  const playerCountEl = document.getElementById("tmpl-player-count");
  const playerListEl = document.getElementById("tmpl-player-list");
  const startGameBtn = document.getElementById("tmpl-start-game-btn");
  const lobbyWaitMsg = document.getElementById("tmpl-lobby-wait-msg");
  const leaveLobbyBtn = document.getElementById("tmpl-leave-lobby-btn");

  const gameEl = document.getElementById("tmpl-game");
  const roomLabelEl = document.getElementById("tmpl-room-label");
  const turnNameEl = document.getElementById("tmpl-turn-name");
  const statusEl = document.getElementById("tmpl-status");
  const opponentsContainer = document.getElementById("tmpl-opponents");

  const winBanner = document.getElementById("tmpl-win-banner");
  const winMessageEl = document.getElementById("tmpl-win-message");
  const standingsEl = document.getElementById("tmpl-standings");
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
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 6;
  const HAND_SIZES = { 3: 9, 4: 7, 5: 6, 6: 5 }; // Trio's official deal by player count

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
  let myRole = null; // "p1".."p6"
  let myName = "";
  let myToken = "";
  let playersInfo = {}; // { p1: {name, joinToken}, ... } — frozen once the game starts
  let playerRoles = []; // ["p1","p2",...] in seat order — frozen once the game starts
  let hands, center, piles, currentPlayer;
  let revealedSet, turnRevealed;
  let queue = [];
  let locked = false;
  let gameOver = false;
  let lastKnownSeed = null;
  let statusKey = null;
  let statusParams = null;

  let unsubLobby = null;
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

  function dealFromSeed(seed, roles) {
    const rng = mulberry32(seed);
    const cards = [];
    let id = 0;
    for (let value = 1; value <= 12; value++) {
      for (let k = 0; k < 3; k++) cards.push({ id: id++, value });
    }
    seededShuffle(cards, rng);

    const handSize = HAND_SIZES[roles.length];
    const dealtHands = {};
    let offset = 0;
    roles.forEach((role) => {
      dealtHands[role] = cards.slice(offset, offset + handSize).sort((a, b) => a.value - b.value);
      offset += handSize;
    });
    const dealtCenter = cards.slice(offset).map((c) => ({ ...c, claimed: false }));
    return { hands: dealtHands, center: dealtCenter };
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

  function genToken() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function roleIndex(role) {
    return parseInt(role.slice(1), 10);
  }

  function nextPlayer(role) {
    const i = playerRoles.indexOf(role);
    return playerRoles[(i + 1) % playerRoles.length];
  }

  function playerName(role) {
    if (role === myRole) return isAr() ? "أنت" : "You";
    const info = playersInfo[role];
    return info ? info.name : role;
  }

  function zoneLabel(zone) {
    if (zone === "center") return isAr() ? "الوسط" : "the center";
    if (zone === myRole) return isAr() ? "يدك" : "your hand";
    const name = playerName(zone);
    return isAr() ? `يد ${name}` : `${name}'s hand`;
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
      const name = (createNameInput.value.trim() || (isAr() ? "لاعب" : "Player")).slice(0, 18);
      const code = genRoomCode();
      const token = genToken();
      createBtn.disabled = true;
      try {
        await set(ref(db, `trioRooms/${code}`), {
          mode,
          status: "lobby",
          seed: null,
          createdAt: Date.now(),
          players: { p1: { name, joinToken: token } },
        });
      } catch (e) {
        showError("Couldn't create the room. Check your Firebase setup and try again.", "تعذّر إنشاء الغرفة. تحقق من إعداد Firebase وحاول مجددًا.");
        createBtn.disabled = false;
        return;
      }

      myRole = "p1";
      myName = name;
      myToken = token;
      roomCode = code;

      lobby.hidden = true;
      enterRoomLobby();
    });
  }

  // ---------- lobby: join ----------

  if (joinBtn) {
    joinBtn.addEventListener("click", async () => {
      clearError();
      const name = (joinNameInput.value.trim() || (isAr() ? "لاعب" : "Player")).slice(0, 18);
      const code = joinCodeInput.value.trim().toUpperCase();
      if (!code) {
        showError("Enter a room code to join.", "أدخل رمز الغرفة للانضمام.");
        return;
      }

      joinBtn.disabled = true;
      const token = genToken();
      const roomRef = ref(db, `trioRooms/${code}`);

      // Fast-path check for a clean error message. Note this does NOT
      // warm any cache the transaction below relies on — a plain get()
      // and a transaction's internal state are unrelated in this SDK.
      let preSnap;
      try {
        preSnap = await get(roomRef);
      } catch (e) {
        showError("Couldn't reach the room. Check your Firebase setup and try again.", "تعذّر الوصول إلى الغرفة. تحقق من إعداد Firebase وحاول مجددًا.");
        joinBtn.disabled = false;
        return;
      }
      if (!preSnap.exists()) {
        showError("Room not found. Double-check the code.", "لم يتم العثور على الغرفة. تحقق من الرمز.");
        joinBtn.disabled = false;
        return;
      }
      if (preSnap.val().status !== "lobby") {
        showError("That room has already started.", "هذه الغرفة بدأت اللعبة بالفعل.");
        joinBtn.disabled = false;
        return;
      }
      if (Object.keys(preSnap.val().players || {}).length >= MAX_PLAYERS) {
        showError("That room is full (6 players max).", "هذه الغرفة ممتلئة (6 لاعبين كحد أقصى).");
        joinBtn.disabled = false;
        return;
      }

      // runTransaction's update function always fires at least once
      // speculatively with `room === null` (it has no local cache to
      // start from), computes an optimistic result, and only THEN
      // compares it against the real server value — retrying with the
      // real data if they don't match. So the null-room call must be
      // treated as "no information yet", not as "room doesn't exist":
      // aborting on it (as an earlier version of this code did) starves
      // the transaction of the retry that would have seen the real
      // room. Real existence was already confirmed by the get() above;
      // status/capacity are only enforced once `room` is non-null (i.e.
      // once real server data has actually been seen).
      let result;
      try {
        result = await runTransaction(roomRef, (room) => {
          const safeRoom = room || {};
          if (room && room.status !== "lobby") return undefined; // real data: started
          const players = safeRoom.players || {};
          const count = Object.keys(players).length;
          if (room && count >= MAX_PLAYERS) return undefined; // real data: full
          const slot = `p${count + 1}`;
          players[slot] = { name, joinToken: token };
          safeRoom.players = players;
          return safeRoom;
        });
      } catch (e) {
        showError("Couldn't reach the room. Check your Firebase setup and try again.", "تعذّر الوصول إلى الغرفة. تحقق من إعداد Firebase وحاول مجددًا.");
        joinBtn.disabled = false;
        return;
      }

      if (!result.committed) {
        const snap = await get(roomRef);
        if (!snap.exists()) {
          showError("Room not found. Double-check the code.", "لم يتم العثور على الغرفة. تحقق من الرمز.");
        } else if (snap.val().status !== "lobby") {
          showError("That room has already started.", "هذه الغرفة بدأت اللعبة بالفعل.");
        } else {
          showError("That room is full (6 players max).", "هذه الغرفة ممتلئة (6 لاعبين كحد أقصى).");
        }
        joinBtn.disabled = false;
        return;
      }

      const players = result.snapshot.val().players;
      const assignedRole = Object.keys(players).find((k) => players[k].joinToken === token);

      myRole = assignedRole;
      myName = name;
      myToken = token;
      roomCode = code;
      mode = result.snapshot.val().mode;

      lobby.hidden = true;
      enterRoomLobby();
    });
  }

  if (copyCodeBtn) {
    copyCodeBtn.addEventListener("click", () => {
      if (roomCode && navigator.clipboard) navigator.clipboard.writeText(roomCode).catch(() => {});
    });
  }

  // ---------- room lobby: watch players, host starts ----------

  function enterRoomLobby() {
    roomLobbyEl.hidden = false;
    roomCodeDisplay.textContent = roomCode;

    unsubLobby = onValue(ref(db, `trioRooms/${roomCode}`), (snap) => {
      const data = snap.val();
      if (!data) return;

      if (data.status === "lobby") {
        renderLobbyPlayers(data.players || {});
      } else if (data.status === "playing" && data.seed != null) {
        if (unsubLobby) {
          unsubLobby();
          unsubLobby = null;
        }
        playersInfo = data.players;
        playerRoles = Object.keys(playersInfo).sort((a, b) => roleIndex(a) - roleIndex(b));
        mode = data.mode;
        roomLobbyEl.hidden = true;
        startGame(data.seed);
      }
    });
  }

  function renderLobbyPlayers(players) {
    const roles = Object.keys(players).sort((a, b) => roleIndex(a) - roleIndex(b));
    const count = roles.length;

    if (playerCountEl) {
      playerCountEl.textContent = isAr()
        ? `${count}/${MAX_PLAYERS} لاعبين انضموا (الحد الأدنى ${MIN_PLAYERS})`
        : `${count}/${MAX_PLAYERS} players joined (minimum ${MIN_PLAYERS})`;
    }

    if (playerListEl) {
      playerListEl.innerHTML = "";
      roles.forEach((role) => {
        const li = document.createElement("li");
        if (role === myRole) li.classList.add("tmpl-player-you");
        const nameSpan = document.createElement("span");
        nameSpan.textContent = players[role].name + (role === myRole ? (isAr() ? " (أنت)" : " (You)") : "");
        li.appendChild(nameSpan);
        if (role === "p1") {
          const badge = document.createElement("span");
          badge.className = "tmpl-player-host-badge";
          badge.textContent = isAr() ? "المضيف" : "Host";
          li.appendChild(badge);
        }
        playerListEl.appendChild(li);
      });
    }

    const isHost = myRole === "p1";
    if (startGameBtn) {
      startGameBtn.hidden = !isHost;
      startGameBtn.disabled = count < MIN_PLAYERS;
    }
    if (lobbyWaitMsg) lobbyWaitMsg.hidden = isHost;
  }

  if (startGameBtn) {
    startGameBtn.addEventListener("click", async () => {
      const snap = await get(ref(db, `trioRooms/${roomCode}/players`));
      const count = snap.exists() ? Object.keys(snap.val()).length : 0;
      if (count < MIN_PLAYERS) return;
      const seed = Math.floor(Math.random() * 2 ** 31);
      startGameBtn.disabled = true;
      try {
        await update(ref(db, `trioRooms/${roomCode}`), { status: "playing", seed });
      } catch (e) {
        startGameBtn.disabled = false;
      }
    });
  }

  if (leaveLobbyBtn) {
    leaveLobbyBtn.addEventListener("click", () => {
      if (unsubLobby) unsubLobby();
      unsubLobby = null;
      resetToLobby();
    });
  }

  // ---------- entering / resetting the game ----------

  function startGame(seed) {
    gameEl.hidden = false;
    if (winBanner) winBanner.hidden = true;
    if (roomLabelEl) roomLabelEl.textContent = roomCode;

    buildOpponentZones();
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

  function buildOpponentZones() {
    if (!opponentsContainer) return;
    opponentsContainer.innerHTML = "";
    playerRoles
      .filter((role) => role !== myRole)
      .forEach((role) => {
        const zone = document.createElement("div");
        zone.className = "trio-zone trio-zone-bot";
        zone.id = `tmpl-zone-${role}`;

        const title = document.createElement("h3");
        title.className = "trio-zone-title";
        const nameSpan = document.createElement("span");
        nameSpan.textContent = playerName(role);
        const countSpan = document.createElement("span");
        countSpan.className = "trio-zone-count";
        countSpan.id = `tmpl-count-${role}`;
        title.append(nameSpan, countSpan);

        const hand = document.createElement("div");
        hand.className = "trio-hand";
        hand.id = `tmpl-hand-${role}`;

        const piles = document.createElement("div");
        piles.className = "trio-piles";
        piles.id = `tmpl-piles-${role}`;

        zone.append(title, hand, piles);
        opponentsContainer.appendChild(zone);
      });
  }

  function resetLocalState(seed) {
    const dealt = dealFromSeed(seed, playerRoles);
    hands = dealt.hands;
    center = dealt.center;
    piles = {};
    playerRoles.forEach((role) => (piles[role] = []));
    currentPlayer = playerRoles[0];
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
    playerRoles.forEach((zone) => {
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
    // No optimistic local lock here — the reveal only becomes real once
    // this action round-trips back through onChildAdded and
    // applyAction() processes it (the single source of truth).
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
      next: playerName(nextPlayer(currentPlayer)),
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
    currentPlayer = nextPlayer(currentPlayer);
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
    renderStandings();
    if (winBanner) winBanner.hidden = false;
    renderAll();
  }

  function renderStandings() {
    if (!standingsEl) return;
    standingsEl.innerHTML = "";
    const sorted = [...playerRoles].sort((a, b) => piles[b].length - piles[a].length);
    sorted.forEach((role) => {
      const li = document.createElement("li");
      const nameSpan = document.createElement("span");
      nameSpan.textContent = playerName(role);
      const countSpan = document.createElement("span");
      countSpan.textContent = isAr() ? `${piles[role].length} ثلاثيات` : `${piles[role].length} trios`;
      li.append(nameSpan, countSpan);
      standingsEl.appendChild(li);
    });
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
    if (unsubLobby) unsubLobby();
    if (unsubSeed) unsubSeed();
    if (unsubActions) unsubActions();
    unsubLobby = unsubSeed = unsubActions = null;
    resetToLobby();
  }

  function resetToLobby() {
    roomCode = null;
    myRole = null;
    playersInfo = {};
    playerRoles = [];
    gameOver = false;
    if (gameEl) gameEl.hidden = true;
    if (roomLobbyEl) roomLobbyEl.hidden = true;
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

  function domIdsFor(zone) {
    if (zone === myRole) return { hand: "tmpl-hand-you", count: "tmpl-you-count", piles: "tmpl-piles-you" };
    return { hand: `tmpl-hand-${zone}`, count: `tmpl-count-${zone}`, piles: `tmpl-piles-${zone}` };
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
    playerRoles.forEach((role) => {
      const zoneId = role === myRole ? "tmpl-zone-you" : `tmpl-zone-${role}`;
      const zoneEl = document.getElementById(zoneId);
      if (zoneEl) zoneEl.classList.toggle("trio-zone-active", role === currentPlayer);
    });
  }

  function renderAll() {
    if (!hands) return;
    playerRoles.forEach((zone) => {
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
