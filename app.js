const data = window.MCHORD_DATA || { songs: [], artists: [] };
const songs = data.songs || [];
const artists = data.artists || [];

const els = {
  stats: document.querySelector("#libraryStats"),
  search: document.querySelector("#searchInput"),
  clearSongFilter: document.querySelector("#clearSongFilter"),
  artist: document.querySelector("#artistFilter"),
  artistDatalist: document.querySelector("#artistDatalist"),
  clearArtistFilter: document.querySelector("#clearArtistFilter"),
  clearAllFilters: document.querySelector("#clearAllFilters"),
  favoritesOnly: document.querySelector("#favoriteFilter"),
  list: document.querySelector("#songList"),
  title: document.querySelector("#songTitle"),
  songArtist: document.querySelector("#songArtist"),
  meta: document.querySelector("#songMeta"),
  sheet: document.querySelector("#sheet"),
  favorite: document.querySelector("#favoriteButton"),
  print: document.querySelector("#printButton"),
  fontSize: document.querySelector("#fontSize"),
  fit: document.querySelector("#fitButton"),
  fullscreen: document.querySelector("#fullscreenButton"),
  resetTranspose: document.querySelector("#resetTranspose"),
  autoScroll: document.querySelector("#autoScroll"),
  scrollSpeed: document.querySelector("#scrollSpeed"),
  mobileBack: document.querySelector("#mobileBackBtn"),
};

const noteOrder = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const flatToSharp = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
};

const state = {
  selectedId: null,
  query: "",
  artistId: "",
  artistQuery: "",
  favoritesOnly: false,
  transpose: 0,
  fit: false,
  fullscreen: false,
  autoScroll: false,
  scrollTimer: null,
  favorites: new Set(JSON.parse(localStorage.getItem("mchord:favorites") || "[]")),
};

function saveFavorites() {
  localStorage.setItem("mchord:favorites", JSON.stringify([...state.favorites]));
}

function normalized(value) {
  return String(value || "").toLocaleLowerCase();
}

function sanitize(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script, iframe, object, embed, link, meta").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attr) => {
      if (attr.name.startsWith("on")) node.removeAttribute(attr.name);
      if (attr.name === "style") {
        node.setAttribute("style", attr.value.replace(/position\s*:\s*fixed/gi, ""));
      }
    });
  });
  return template.innerHTML;
}

function transposeChord(chord, steps) {
  if (!steps) return chord;
  return chord.replace(
    /(^|[\s([|])([A-G](?:#|b)?)(m|maj|min|sus|dim|aug|add)?([0-9]?)(\/[A-G](?:#|b)?)?(?=$|[\s)\]|,.])/g,
    (match, prefix, root, quality = "", number = "", bass = "") => {
      const sharpRoot = flatToSharp[root] || root;
      const index = noteOrder.indexOf(sharpRoot);
      if (index === -1) return match;
      const next = noteOrder[(index + steps + 120) % 12];
      const nextBass = bass
        ? `/${transposeKey(bass.slice(1), steps)}`
        : "";
      return `${prefix}${next}${quality}${number}${nextBass}`;
    },
  );
}

function parseSongKey(key) {
  const match = String(key || "").trim().match(/^([A-G](?:#|b)?)(.*)$/);
  if (!match) return null;
  return {
    root: flatToSharp[match[1]] || match[1],
    suffix: match[2] || "",
  };
}

function transposeKey(key, steps) {
  const parsed = parseSongKey(key);
  if (!parsed) return "";
  const index = noteOrder.indexOf(parsed.root);
  if (index === -1) return key;
  return `${noteOrder[(index + steps + 120) % 12]}${parsed.suffix}`;
}

function transposeTextNodes(root, steps) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    node.nodeValue = transposeChord(node.nodeValue, steps);
  });
}

function songMatches(song) {
  if (state.artistId && String(song.artistId) !== state.artistId) return false;
  if (!state.artistId && state.artistQuery) {
    const artistName = normalized(song.artist);
    const query = normalized(state.artistQuery);
    if (!artistName.includes(query)) return false;
  }
  if (state.favoritesOnly && !state.favorites.has(song.id)) return false;
  if (!state.query) return true;
  const haystack = normalized(`${song.title} ${song.artist} ${song.key} ${song.beat} ${song.text}`);
  return haystack.includes(state.query);
}

function filteredSongs() {
  return songs.filter(songMatches);
}

function hasFilters() {
  return Boolean(state.query || state.artistId || state.artistQuery || state.favoritesOnly);
}

function updateFilterControls() {
  els.clearSongFilter.disabled = !state.query;
  els.clearArtistFilter.disabled = !(state.artistId || state.artistQuery);
  els.clearAllFilters.disabled = !hasFilters();
}

function selectedSong() {
  return songs.find((item) => item.id === state.selectedId) || null;
}

function updateSongControls() {
  const hasSong = Boolean(selectedSong());
  els.favorite.disabled = !hasSong;
  els.print.disabled = !hasSong;
  els.fit.disabled = !hasSong;
  if (els.fullscreen) els.fullscreen.disabled = !hasSong;
  els.resetTranspose.disabled = !hasSong || state.transpose === 0;
  els.autoScroll.disabled = !hasSong;
}

function renderArtists() {
  if (!els.artistDatalist) return;
  els.artistDatalist.innerHTML = "";
  const used = new Set(songs.map((song) => song.artistId).filter(Boolean));
  artists
    .filter((artist) => used.has(Number(artist.id)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .forEach((artist) => {
      const option = document.createElement("option");
      option.value = artist.name;
      els.artistDatalist.append(option);
    });
}

function renderList() {
  const hasActiveFilters = hasFilters();
  const visible = hasActiveFilters ? filteredSongs() : [];
  
  els.stats.textContent = hasActiveFilters
    ? `${visible.length.toLocaleString()} found · ${songs.length.toLocaleString()} songs`
    : `${songs.length.toLocaleString()} songs loaded`;
    
  updateFilterControls();
  els.list.innerHTML = "";

  if (!hasActiveFilters) {
    const prompt = document.createElement("div");
    prompt.className = "list-prompt";
    prompt.innerHTML = `
      <svg class="prompt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <p>Type a search or select an artist to view songs.</p>
    `;
    els.list.append(prompt);
    return;
  }

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state-list";
    empty.innerHTML = "<h3>No songs found</h3><p>Try a different search or artist.</p>";
    els.list.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  visible.forEach((song) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `song-item${song.id === state.selectedId ? " active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", song.id === state.selectedId ? "true" : "false");
    button.innerHTML = `<strong>${escapeHtml(song.title)}</strong><span>${state.favorites.has(song.id) ? '<span class="fav-badge">★</span> ' : ""}${escapeHtml(song.artist)}</span>`;
    button.addEventListener("click", () => {
      state.selectedId = song.id;
      state.transpose = 0;
      setAutoScroll(false);
      renderList();
      renderSong();
      const appEl = document.querySelector(".app");
      if (appEl) {
        appEl.classList.add("show-viewer");
      }
    });
    fragment.append(button);
  });
  els.list.append(fragment);
}

function renderSong() {
  const song = selectedSong();
  if (!song) {
    els.title.textContent = "All chords and lyrics";
    els.songArtist.textContent = "Choose a song";
    els.meta.innerHTML = `<span>${songs.length.toLocaleString()} songs</span><span>${artists.length.toLocaleString()} artists</span>`;
    els.favorite.setAttribute("aria-pressed", "false");
    els.sheet.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon-wrapper">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
        </div>
        <h3>Select a song from the library</h3>
        <p>Choose a song from the left pane to view chords, lyrics, and transpose keys.</p>
      </div>
    `;
    updateTranspose();
    updateSongControls();
    return;
  }

  els.title.textContent = song.title;
  els.songArtist.textContent = song.artist;
  els.favorite.setAttribute("aria-pressed", state.favorites.has(song.id) ? "true" : "false");

  const meta = [];
  if (song.key) meta.push(`Key ${song.key}`);
  if (song.beat) meta.push(`Beat ${song.beat}`);
  els.meta.innerHTML = meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("");

  const content = document.createElement("div");
  content.className = `sheet-content${state.fit ? " fit-to-screen" : ""}`;
  content.innerHTML = sanitize(song.html);
  transposeTextNodes(content, Number(state.transpose));
  els.sheet.innerHTML = "";
  els.sheet.append(content);

  // Append floating controls wrapper directly inside the sheet area
  const btnWrapper = document.createElement("div");
  btnWrapper.className = "sheet-btn-wrapper";

  const controlsContainer = document.createElement("div");
  controlsContainer.className = "sheet-floating-controls";

  // 1. Play/Pause Scroll Button
  const scrollBtn = document.createElement("button");
  scrollBtn.className = "sheet-floating-btn sheet-scroll-btn";
  scrollBtn.type = "button";
  scrollBtn.title = "Toggle Auto Scroll";
  scrollBtn.setAttribute("aria-label", "Toggle Auto Scroll");
  scrollBtn.setAttribute("aria-pressed", state.autoScroll ? "true" : "false");
  scrollBtn.innerHTML = `
    <svg class="icon-play" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>
    <svg class="icon-pause" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
      <rect x="6" y="4" width="4" height="16" rx="1"></rect>
      <rect x="14" y="4" width="4" height="16" rx="1"></rect>
    </svg>
  `;
  if (state.autoScroll) {
    scrollBtn.querySelector(".icon-play").style.display = "none";
    scrollBtn.querySelector(".icon-pause").style.display = "block";
  }
  scrollBtn.addEventListener("click", () => {
    setAutoScroll(!state.autoScroll);
  });
  controlsContainer.append(scrollBtn);

  // 2. Font Size Decrease Button
  const fontDecBtn = document.createElement("button");
  fontDecBtn.className = "sheet-floating-btn";
  fontDecBtn.type = "button";
  fontDecBtn.title = "Decrease Font Size";
  fontDecBtn.setAttribute("aria-label", "Decrease Font Size");
  fontDecBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  `;
  fontDecBtn.addEventListener("click", () => {
    const current = Number(els.fontSize.value);
    const next = Math.max(Number(els.fontSize.min), current - 1);
    els.fontSize.value = next;
    document.documentElement.style.setProperty("--sheet-font-size", `${next}px`);
  });
  controlsContainer.append(fontDecBtn);

  // 3. Font Size Increase Button
  const fontIncBtn = document.createElement("button");
  fontIncBtn.className = "sheet-floating-btn";
  fontIncBtn.type = "button";
  fontIncBtn.title = "Increase Font Size";
  fontIncBtn.setAttribute("aria-label", "Increase Font Size");
  fontIncBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  `;
  fontIncBtn.addEventListener("click", () => {
    const current = Number(els.fontSize.value);
    const next = Math.min(Number(els.fontSize.max), current + 1);
    els.fontSize.value = next;
    document.documentElement.style.setProperty("--sheet-font-size", `${next}px`);
  });
  controlsContainer.append(fontIncBtn);

  // 4. Fit Width Toggle Button
  const fitBtn = document.createElement("button");
  fitBtn.className = "sheet-floating-btn";
  fitBtn.type = "button";
  fitBtn.title = "Toggle Fit Width";
  fitBtn.setAttribute("aria-label", "Toggle Fit Width");
  fitBtn.setAttribute("aria-pressed", state.fit ? "true" : "false");
  fitBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 12h20M6 8l-4 4 4 4M18 8l4 4-4 4"></path>
    </svg>
  `;
  fitBtn.addEventListener("click", () => {
    state.fit = !state.fit;
    els.fit.setAttribute("aria-pressed", state.fit ? "true" : "false");
    renderSong();
  });
  controlsContainer.append(fitBtn);

  // 5. Fullscreen Toggle Button
  const fsBtn = document.createElement("button");
  fsBtn.id = "sheetFullscreenBtn";
  fsBtn.className = "sheet-floating-btn sheet-fullscreen-btn";
  fsBtn.type = "button";
  fsBtn.title = "Toggle Fullscreen";
  fsBtn.setAttribute("aria-label", "Toggle Fullscreen");
  fsBtn.setAttribute("aria-pressed", state.fullscreen ? "true" : "false");
  fsBtn.innerHTML = `
    <svg class="icon-expand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
    </svg>
    <svg class="icon-shrink" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 14h6v6m10-6h-6v6M4 10h6V4m10 6h-6V4"></path>
    </svg>
  `;
  fsBtn.addEventListener("click", toggleFullscreen);
  controlsContainer.append(fsBtn);

  btnWrapper.append(controlsContainer);
  els.sheet.append(btnWrapper);

  updateTranspose();
  updateSongControls();
}

function updateTranspose() {
  const song = selectedSong();
  const container = document.querySelector("#transposeScales");
  if (!container) return;
  container.innerHTML = "";
  
  if (!song || !song.key) {
    const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    notes.forEach((note) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scale-btn";
      btn.textContent = note;
      btn.disabled = true;
      container.append(btn);
    });
    return;
  }
  
  const parsed = parseSongKey(song.key);
  if (!parsed) return;
  const originalIndex = noteOrder.indexOf(parsed.root);
  if (originalIndex === -1) return;
  
  noteOrder.forEach((note, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const keyLabel = `${note}${parsed.suffix}`;
    btn.textContent = keyLabel;
    
    const currentSteps = state.transpose;
    const currentNoteIndex = (originalIndex + currentSteps + 120) % 12;
    
    btn.className = "scale-btn";
    if (index === currentNoteIndex) {
      btn.classList.add("active");
    }
    if (index === originalIndex) {
      btn.classList.add("original");
      btn.title = `Original Key: ${keyLabel}`;
    }
    
    btn.addEventListener("click", () => {
      let steps = index - originalIndex;
      if (steps > 6) steps -= 12;
      if (steps <= -6) steps += 12;
      
      state.transpose = steps;
      renderSong();
    });
    
    container.append(btn);
  });
}

function changeTranspose(step) {
  state.transpose = Math.max(-11, Math.min(11, state.transpose + step));
  renderSong();
}

function setAutoScroll(enabled) {
  state.autoScroll = enabled;
  els.autoScroll.setAttribute("aria-pressed", enabled ? "true" : "false");
  
  // Sync all floating scroll buttons
  document.querySelectorAll(".sheet-scroll-btn").forEach(btn => {
    btn.setAttribute("aria-pressed", enabled ? "true" : "false");
    const playIcon = btn.querySelector(".icon-play");
    const pauseIcon = btn.querySelector(".icon-pause");
    if (playIcon) playIcon.style.display = enabled ? "none" : "block";
    if (pauseIcon) pauseIcon.style.display = enabled ? "block" : "none";
  });

  if (state.scrollTimer) {
    window.clearInterval(state.scrollTimer);
    state.scrollTimer = null;
  }
  if (!enabled) return;
  state.scrollTimer = window.setInterval(() => {
    const speed = Number(els.scrollSpeed.value || 3);
    const atBottom = els.sheet.scrollTop + els.sheet.clientHeight >= els.sheet.scrollHeight - 2;
    if (atBottom) {
      setAutoScroll(false);
      return;
    }
    els.sheet.scrollBy({ top: speed, behavior: "smooth" });
  }, 90);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

els.search.addEventListener("input", (event) => {
  state.query = normalized(event.target.value.trim());
  renderList();
});

els.clearSongFilter.addEventListener("click", () => {
  state.query = "";
  els.search.value = "";
  renderList();
  els.search.focus();
});

els.artist.addEventListener("input", (event) => {
  const value = event.target.value.trim();
  const matchedArtist = artists.find(a => normalized(a.name) === normalized(value));
  
  if (matchedArtist) {
    state.artistId = String(matchedArtist.id);
    state.artistQuery = "";
  } else {
    state.artistId = "";
    state.artistQuery = value;
  }
  renderList();
});

els.clearArtistFilter.addEventListener("click", () => {
  state.artistId = "";
  state.artistQuery = "";
  els.artist.value = "";
  renderList();
  els.artist.focus();
});

els.clearAllFilters.addEventListener("click", () => {
  state.query = "";
  state.artistId = "";
  state.artistQuery = "";
  state.favoritesOnly = false;
  els.search.value = "";
  els.artist.value = "";
  els.favoritesOnly.setAttribute("aria-pressed", "false");
  renderList();
});

els.favoritesOnly.addEventListener("click", () => {
  state.favoritesOnly = !state.favoritesOnly;
  els.favoritesOnly.setAttribute("aria-pressed", state.favoritesOnly ? "true" : "false");
  renderList();
});

els.favorite.addEventListener("click", () => {
  if (!state.selectedId) return;
  if (state.favorites.has(state.selectedId)) {
    state.favorites.delete(state.selectedId);
  } else {
    state.favorites.add(state.selectedId);
  }
  saveFavorites();
  renderList();
  renderSong();
});

els.print.addEventListener("click", () => window.print());

els.fontSize.addEventListener("input", (event) => {
  document.documentElement.style.setProperty("--sheet-font-size", `${event.target.value}px`);
});

els.fit.addEventListener("click", () => {
  state.fit = !state.fit;
  els.fit.setAttribute("aria-pressed", state.fit ? "true" : "false");
  renderSong();
});

// Fullscreen API toggle functions and event bindings
function getFullscreenElement() {
  return document.fullscreenElement ||
         document.webkitFullscreenElement ||
         document.mozFullScreenElement ||
         document.msFullscreenElement;
}

function enterCSSFullscreen() {
  document.body.classList.add("fullscreen-active");
  updateFullscreenState();
}

function exitCSSFullscreen() {
  document.body.classList.remove("fullscreen-active");
  updateFullscreenState();
}

function toggleFullscreen() {
  if (!selectedSong()) return;
  
  const fsEl = getFullscreenElement();
  if (!fsEl && !document.body.classList.contains("fullscreen-active")) {
    const req = els.sheet.requestFullscreen || 
                els.sheet.webkitRequestFullscreen || 
                els.sheet.mozRequestFullScreen ||
                els.sheet.msRequestFullscreen;
    if (req) {
      req.call(els.sheet).catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
        enterCSSFullscreen();
      });
    } else {
      enterCSSFullscreen();
    }
  } else {
    const exit = document.exitFullscreen || 
                 document.webkitExitFullscreen || 
                 document.mozCancelFullScreen ||
                 document.msExitFullscreen;
    if (exit && getFullscreenElement()) {
      exit.call(document).catch((err) => {
        console.error(`Error exiting fullscreen: ${err.message}`);
        exitCSSFullscreen();
      });
    } else {
      exitCSSFullscreen();
    }
  }
}

function updateFullscreenState() {
  const fsEl = getFullscreenElement();
  const isFs = !!fsEl || document.body.classList.contains("fullscreen-active");
  state.fullscreen = isFs;
  
  if (fsEl === els.sheet) {
    document.body.classList.add("fullscreen-active");
  } else if (!fsEl && !document.body.classList.contains("fullscreen-active")) {
    document.body.classList.remove("fullscreen-active");
  }
  
  // Mobile font size optimization in fullscreen mode
  if (isFs) {
    if (window.innerWidth <= 600 && !state.savedFontSize) {
      state.savedFontSize = els.fontSize.value;
      document.documentElement.style.setProperty("--sheet-font-size", "13px");
      els.fontSize.value = 13;
    }
  } else {
    if (state.savedFontSize) {
      document.documentElement.style.setProperty("--sheet-font-size", `${state.savedFontSize}px`);
      els.fontSize.value = state.savedFontSize;
      delete state.savedFontSize;
    }
  }
  
  if (els.fullscreen) {
    els.fullscreen.setAttribute("aria-pressed", isFs ? "true" : "false");
    const label = els.fullscreen.querySelector("span");
    if (label) {
      label.textContent = isFs ? "Exit Fullscreen" : "Fullscreen";
    }
  }
  
  // Update all fullscreen button pressed states in the DOM
  document.querySelectorAll(".sheet-fullscreen-btn").forEach(btn => {
    btn.setAttribute("aria-pressed", isFs ? "true" : "false");
  });
}

document.addEventListener("fullscreenchange", updateFullscreenState);
document.addEventListener("webkitfullscreenchange", updateFullscreenState);
document.addEventListener("mozfullscreenchange", updateFullscreenState);
document.addEventListener("MSFullscreenChange", updateFullscreenState);

if (els.fullscreen) {
  els.fullscreen.addEventListener("click", toggleFullscreen);
}



if (els.mobileBack) {
  els.mobileBack.addEventListener("click", () => {
    const appEl = document.querySelector(".app");
    if (appEl) {
      appEl.classList.remove("show-viewer");
    }
  });
}

els.resetTranspose.addEventListener("click", () => {
  state.transpose = 0;
  renderSong();
});

els.autoScroll.addEventListener("click", () => {
  setAutoScroll(!state.autoScroll);
});

// Theme toggle handler
const themeToggle = document.querySelector("#themeToggle");
if (themeToggle) {
  // Set default theme from localStorage
  const currentTheme = localStorage.getItem("mchord:theme") || "dark";
  if (currentTheme === "light") {
    document.body.classList.add("light-theme");
  }
  
  themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("light-theme");
    const theme = document.body.classList.contains("light-theme") ? "light" : "dark";
    localStorage.setItem("mchord:theme", theme);
  });
}

// Add a keyboard shortcut helper for enhanced power-user UX
window.addEventListener("keydown", (event) => {
  // Prevent shortcut conflict if user is typing in any input field or textarea
  if (
    document.activeElement.tagName === "INPUT" ||
    document.activeElement.tagName === "TEXTAREA" ||
    document.activeElement.isContentEditable
  ) {
    if (document.activeElement === els.search && event.key === "Escape") {
      els.search.value = "";
      state.query = "";
      els.clearSongFilter.disabled = true;
      renderList();
    }
    return;
  }
  
  if (event.key === "Escape" && document.body.classList.contains("fullscreen-active") && !getFullscreenElement()) {
    event.preventDefault();
    exitCSSFullscreen();
  } else if (event.code === "Space" && selectedSong()) {
    event.preventDefault();
    setAutoScroll(!state.autoScroll);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    changeTranspose(1);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    changeTranspose(-1);
  } else if (event.code === "KeyF" && event.ctrlKey) {
    event.preventDefault();
    els.search.focus();
  } else if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey && selectedSong()) {
    event.preventDefault();
    toggleFullscreen();
  } else if (event.key === "=" || event.key === "+") {
    event.preventDefault();
    const current = Number(els.fontSize.value);
    const next = Math.min(Number(els.fontSize.max), current + 1);
    els.fontSize.value = next;
    document.documentElement.style.setProperty("--sheet-font-size", `${next}px`);
  } else if (event.key === "-") {
    event.preventDefault();
    const current = Number(els.fontSize.value);
    const next = Math.max(Number(els.fontSize.min), current - 1);
    els.fontSize.value = next;
    document.documentElement.style.setProperty("--sheet-font-size", `${next}px`);
  }
});

renderArtists();
renderList();
renderSong();
