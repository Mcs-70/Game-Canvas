// Game Canvas — tiny shared localStorage leaderboard helper used by
// both play.html games. Each game keeps its own storage key and sort
// order (higher-is-better for Snake, lower-is-better for Shape Match)
// but shares the load/save/render plumbing. Scores are per-browser
// only — this is a static site with no backend to share them across
// visitors.

window.GCLeaderboard = (function () {
  const MAX_ENTRIES = 5;
  const NAME_KEY = "gc-player-name";

  function load(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      const entries = raw ? JSON.parse(raw) : [];
      return Array.isArray(entries) ? entries : [];
    } catch (e) {
      return [];
    }
  }

  function save(storageKey, entries) {
    localStorage.setItem(storageKey, JSON.stringify(entries));
  }

  // compareFn follows Array#sort convention: negative if a should rank above b.
  function addEntry(storageKey, entry, compareFn) {
    const entries = load(storageKey);
    entries.push(entry);
    entries.sort(compareFn);
    const trimmed = entries.slice(0, MAX_ENTRIES);
    save(storageKey, trimmed);
    return trimmed;
  }

  function render(listEl, entries, formatValue) {
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!entries.length) {
      const li = document.createElement("li");
      li.className = "leaderboard-empty";
      const isAr = document.documentElement.lang === "ar";
      li.textContent = isAr ? "لا توجد نتائج بعد — كن الأول!" : "No scores yet — be the first!";
      listEl.appendChild(li);
      return;
    }

    entries.forEach((entry, i) => {
      const li = document.createElement("li");
      li.className = "leaderboard-row";

      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = String(i + 1);

      const name = document.createElement("span");
      name.className = "leaderboard-name";
      name.textContent = entry.name;

      const value = document.createElement("span");
      value.className = "leaderboard-value";
      value.textContent = formatValue(entry.value);

      li.append(rank, name, value);
      listEl.appendChild(li);
    });
  }

  function getSavedName() {
    return localStorage.getItem(NAME_KEY) || "";
  }

  function setSavedName(name) {
    localStorage.setItem(NAME_KEY, name);
  }

  return { load, save, addEntry, render, getSavedName, setSavedName, MAX_ENTRIES };
})();
