const TARGET_OVERLAPS = 5;
const MAX_MISTAKES = 3;
const STORAGE_KEY = 'overlap_game_data_v1';

let allPuzzles = [];
let currentPuzzle = null;
let selectedCardIds = [];
let clickHistory = []; // Array di 'OK' o 'XX' per la condivisione
let mistakes = 0;
let foundCount = 0;
let isGameOver = false;

// Riferimenti DOM
const puzzleBadgeEl = document.getElementById('puzzle-badge');
const anchorLifespanEl = document.getElementById('anchor-lifespan');
const anchorNameEl = document.getElementById('anchor-name');
const anchorDescEl = document.getElementById('anchor-desc');
const boundsTextEl = document.getElementById('bounds-text');
const foundCounterEl = document.getElementById('found-counter');
const livesCounterEl = document.getElementById('lives-counter');
const cardsGridEl = document.getElementById('cards-grid');
const resultSectionEl = document.getElementById('result-section');
const resultTitleEl = document.getElementById('result-title');
const resultSummaryEl = document.getElementById('result-summary');
const shareBtnEl = document.getElementById('share-btn');
const shareFeedbackEl = document.getElementById('share-feedback');
const timelineListEl = document.getElementById('timeline-list');
const devButtonsEl = document.getElementById('dev-buttons');
const resetStorageBtn = document.getElementById('reset-storage-btn');

// Gestione LocalStorage
function loadStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      stats: { played: 0, wins: 0, currentStreak: 0, maxStreak: 0 },
      history: {}
    };
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {
      stats: { played: 0, wins: 0, currentStreak: 0, maxStreak: 0 },
      history: {}
    };
  }
}

function saveStorage(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// Mescola in modo deterministico in base all'ID del puzzle così l'ordine è uguale per tutti
function deterministicShuffle(array, seed) {
  const arr = [...array];
  let m = arr.length;
  let s = seed * 9973;
  while (m) {
    s = (s * 9301 + 49297) % 233280;
    const i = Math.floor((s / 233280) * m--);
    const t = arr[m];
    arr[m] = arr[i];
    arr[i] = t;
  }
  return arr;
}

async function initGame() {
  try {
    const response = await fetch('./puzzles.json');
    allPuzzles = await response.json();

    // Seleziona il puzzle corrispondente alla data di oggi, oppure l'ultimo disponibile
    const todayStr = new Date().toISOString().slice(0, 10);
    const matched = allPuzzles.find((p) => p.date === todayStr) || allPuzzles[0];

    renderDevToolbar();
    loadPuzzle(matched.id);
  } catch (err) {
    anchorNameEl.textContent = 'Error loading puzzles.json';
    anchorDescEl.textContent = 'Make sure python3 -m http.server 8000 is running.';
    console.error(err);
  }
}

function renderDevToolbar() {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const toolbarEl = document.querySelector('.dev-toolbar');

  if (!isLocal) {
    if (toolbarEl) toolbarEl.classList.add('hidden');
    return;
  }

  devButtonsEl.innerHTML = '';
  allPuzzles.forEach((p) => {
    const btn = document.createElement('button');
    btn.className = 'dev-btn';
    btn.textContent = `#${p.id} (${p.anchor.name})`;
    btn.addEventListener('click', () => loadPuzzle(p.id));
    devButtonsEl.appendChild(btn);
  });
}

function loadPuzzle(puzzleId) {
  currentPuzzle = allPuzzles.find((p) => p.id === puzzleId);
  if (!currentPuzzle) return;

  // Aggiorna bottoni barra di test
  Array.from(devButtonsEl.children).forEach((btn, idx) => {
    btn.classList.toggle('active', allPuzzles[idx].id === puzzleId);
  });

  // Controlla se esiste già uno stato salvato nel localStorage per questo puzzle
  const storage = loadStorage();
  const savedState = storage.history[currentPuzzle.id];

  if (savedState) {
    selectedCardIds = savedState.selectedCardIds || [];
    clickHistory = savedState.clickHistory || [];
    mistakes = savedState.mistakes || 0;
    foundCount = savedState.foundCount || 0;
    isGameOver = savedState.isGameOver || false;
  } else {
    selectedCardIds = [];
    clickHistory = [];
    mistakes = 0;
    foundCount = 0;
    isGameOver = false;
  }

  shareFeedbackEl.classList.add('hidden');
  renderHeaderAndStatus();
  renderCards();
  updateDeducedBounds();

  if (isGameOver) {
    showResultScreen();
  } else {
    resultSectionEl.classList.add('hidden');
  }
}

function renderHeaderAndStatus() {
  puzzleBadgeEl.textContent = `Puzzle #${currentPuzzle.id}`;
  anchorNameEl.textContent = currentPuzzle.anchor.name;
  anchorDescEl.textContent = currentPuzzle.anchor.description;

  if (isGameOver) {
    anchorLifespanEl.textContent = `LIFESPAN: [ ${currentPuzzle.anchor.birth} - ${currentPuzzle.anchor.death} ]`;
  } else {
    anchorLifespanEl.textContent = 'LIFESPAN: [ ???? - ???? ]';
  }

  foundCounterEl.textContent = `${foundCount} / ${TARGET_OVERLAPS}`;
  const remainingLives = Math.max(0, MAX_MISTAKES - mistakes);
  livesCounterEl.textContent = `${remainingLives} / ${MAX_MISTAKES}`;
}

function updateDeducedBounds() {
  const revealedCards = currentPuzzle.cards.filter((c) => selectedCardIds.includes(c.id));
  if (revealedCards.length === 0) {
    boundsTextEl.textContent = 'Select an event card below to start narrowing down the timeline.';
    return;
  }

  let earliestOverlap = null;
  let latestOverlap = null;
  let bornAfter = null;
  let diedBefore = null;

  revealedCards.forEach((c) => {
    if (c.overlaps) {
      if (earliestOverlap === null || c.year < earliestOverlap) earliestOverlap = c.year;
      if (latestOverlap === null || c.year > latestOverlap) latestOverlap = c.year;
    } else {
      if (c.year < currentPuzzle.anchor.birth) {
        if (bornAfter === null || c.year > bornAfter) bornAfter = c.year;
      } else if (c.year > currentPuzzle.anchor.death) {
        if (diedBefore === null || c.year < diedBefore) diedBefore = c.year;
      }
    }
  });

  const parts = [];
  if (bornAfter !== null) parts.push(`Born after ${bornAfter}`);
  if (earliestOverlap !== null && latestOverlap !== null) {
    if (earliestOverlap === latestOverlap) {
      parts.push(`Confirmed alive in ${earliestOverlap}`);
    } else {
      parts.push(`Confirmed alive during ${earliestOverlap}-${latestOverlap}`);
    }
  }
  if (diedBefore !== null) parts.push(`Died before ${diedBefore}`);

  boundsTextEl.textContent = parts.join('  |  ');
}

function renderCards() {
  cardsGridEl.innerHTML = '';
  const shuffled = deterministicShuffle(currentPuzzle.cards, currentPuzzle.id);

  shuffled.forEach((card) => {
    const isSelected = selectedCardIds.includes(card.id);
    const btn = document.createElement('button');
    btn.className = 'event-card';

    if (isSelected) {
      btn.classList.add('revealed');
      btn.classList.add(card.overlaps ? 'correct' : 'wrong');
    } else if (isGameOver) {
      btn.classList.add('revealed', 'missed');
      btn.classList.add(card.overlaps ? 'correct' : 'wrong');
    }

    const textDiv = document.createElement('div');
    textDiv.className = 'event-text';
    textDiv.textContent = card.text;

    const metaDiv = document.createElement('div');
    metaDiv.className = 'event-meta';

    if (isSelected || isGameOver) {
      const yearSpan = document.createElement('span');
      yearSpan.textContent = `YEAR: ${card.year}`;

      const statusSpan = document.createElement('span');
      if (card.overlaps) {
        statusSpan.textContent = '[OVERLAP]';
      } else {
        const reason = card.year < currentPuzzle.anchor.birth ? '[TOO EARLY]' : '[TOO LATE]';
        statusSpan.textContent = reason;
      }

      metaDiv.appendChild(yearSpan);
      metaDiv.appendChild(statusSpan);
    } else {
      const hiddenSpan = document.createElement('span');
      hiddenSpan.textContent = 'YEAR: ????';
      const actionSpan = document.createElement('span');
      actionSpan.textContent = 'SELECT';
      metaDiv.appendChild(hiddenSpan);
      metaDiv.appendChild(actionSpan);
    }

    btn.appendChild(textDiv);
    btn.appendChild(metaDiv);

    btn.addEventListener('click', () => handleCardClick(card));
    cardsGridEl.appendChild(btn);
  });
}

function handleCardClick(card) {
  if (isGameOver || selectedCardIds.includes(card.id)) return;

  selectedCardIds.push(card.id);

  if (card.overlaps) {
    foundCount++;
    clickHistory.push('[OK]');
  } else {
    mistakes++;
    clickHistory.push('[XX]');
  }

  const won = foundCount >= TARGET_OVERLAPS;
  const lost = mistakes >= MAX_MISTAKES;

  if (won || lost) {
    isGameOver = true;
    recordGameCompletion(won);
  } else {
    saveCurrentPuzzleProgress();
  }

  renderHeaderAndStatus();
  renderCards();
  updateDeducedBounds();

  if (isGameOver) {
    showResultScreen();
  }
}

function saveCurrentPuzzleProgress() {
  const storage = loadStorage();
  storage.history[currentPuzzle.id] = {
    selectedCardIds,
    clickHistory,
    mistakes,
    foundCount,
    isGameOver
  };
  saveStorage(storage);
}

function recordGameCompletion(won) {
  const storage = loadStorage();
  const alreadyCompleted = storage.history[currentPuzzle.id]?.isGameOver;

  storage.history[currentPuzzle.id] = {
    selectedCardIds,
    clickHistory,
    mistakes,
    foundCount,
    isGameOver: true,
    won
  };

  if (!alreadyCompleted) {
    storage.stats.played += 1;
    if (won) {
      storage.stats.wins += 1;
      storage.stats.currentStreak += 1;
      if (storage.stats.currentStreak > storage.stats.maxStreak) {
        storage.stats.maxStreak = storage.stats.currentStreak;
      }
    } else {
      storage.stats.currentStreak = 0;
    }
  }

  saveStorage(storage);
}

function showResultScreen() {
  resultSectionEl.classList.remove('hidden');
  const won = foundCount >= TARGET_OVERLAPS;

  if (won) {
    resultTitleEl.textContent = 'TIMELINE SOLVED';
    resultSummaryEl.textContent = `You identified all 5 overlapping events for ${currentPuzzle.anchor.name} (${currentPuzzle.anchor.birth}-${currentPuzzle.anchor.death}) with ${MAX_MISTAKES - mistakes} lives remaining.`;
  } else {
    resultTitleEl.textContent = 'OUT OF LIVES';
    resultSummaryEl.textContent = `${currentPuzzle.anchor.name} lived from ${currentPuzzle.anchor.birth} to ${currentPuzzle.anchor.death}. You found ${foundCount} out of ${TARGET_OVERLAPS} overlaps.`;
  }

  // Popola statistiche
  const { stats } = loadStorage();
  document.getElementById('stat-played').textContent = stats.played;
  const winRate = stats.played > 0 ? Math.round((stats.wins / stats.played) * 100) : 0;
  document.getElementById('stat-winrate').textContent = `${winRate}%`;
  document.getElementById('stat-streak').textContent = stats.currentStreak;
  document.getElementById('stat-max').textContent = stats.maxStreak;

  renderChronologicalTimeline();
}

function renderChronologicalTimeline() {
  timelineListEl.innerHTML = '';

  const items = currentPuzzle.cards.map((c) => ({
    year: c.year,
    text: c.text,
    type: c.overlaps ? 'in-life' : 'out-life'
  }));

  items.push({
    year: currentPuzzle.anchor.birth,
    text: `BIRTH OF ${currentPuzzle.anchor.name.toUpperCase()}`,
    type: 'anchor-marker'
  });

  items.push({
    year: currentPuzzle.anchor.death,
    text: `DEATH OF ${currentPuzzle.anchor.name.toUpperCase()}`,
    type: 'anchor-marker'
  });

  items.sort((a, b) => a.year - b.year);

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = `timeline-item ${item.type}`;

    const yearSpan = document.createElement('span');
    yearSpan.className = 'timeline-year';
    yearSpan.textContent = item.year;

    const textSpan = document.createElement('span');
    textSpan.textContent = item.text;

    row.appendChild(yearSpan);
    row.appendChild(textSpan);
    timelineListEl.appendChild(row);
  });
}

// Condivisione testo ASCII negli appunti
shareBtnEl.addEventListener('click', async () => {
  const remainingLives = Math.max(0, MAX_MISTAKES - mistakes);
  const shareLines = [
    `OVERLAP #${currentPuzzle.id} (${currentPuzzle.date})`,
    `Subject: ${currentPuzzle.anchor.name}`,
    `Overlaps: ${foundCount}/${TARGET_OVERLAPS} | Lives: ${remainingLives}/${MAX_MISTAKES}`,
    `Moves: ${clickHistory.join(' ')}`
  ];
  const shareText = shareLines.join('\n');

  try {
    await navigator.clipboard.writeText(shareText);
    shareFeedbackEl.classList.remove('hidden');
  } catch (err) {
    alert(shareText);
  }
});

// Reset salvataggi locali per test
resetStorageBtn.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  loadPuzzle(currentPuzzle.id);
});

initGame();