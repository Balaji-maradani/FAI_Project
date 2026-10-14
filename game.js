/* =========================================================
   game.js — Othello game controller
   -----------------------------------------------------------
   Architecture:
     UI  ──▶  Game Controller ──▶ Board State / Rules / Turns
                     │
                     ▼
                    AI (ai.js) — pure function, returns a move
   The AI never touches the DOM; the controller applies
   whatever move it returns and re-renders.
   ========================================================= */

const EMPTY = 0, BLACK = 1, WHITE = 2;

const DIRECTIONS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

/* ---------------------------------------------------------
   4 & 5. Core board rules — shared by the UI and the AI.
   These are intentionally pure (board in, value out) so the
   AI can simulate moves without mutating the real game state.
   --------------------------------------------------------- */

function createInitialBoard() {
  const board = Array(8).fill().map(() => Array(8).fill(EMPTY));
  board[3][3] = WHITE;
  board[3][4] = BLACK;
  board[4][3] = BLACK;
  board[4][4] = WHITE;
  return board;
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function opponent(player) {
  return player === BLACK ? WHITE : BLACK;
}

function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

/** Returns the list of opponent pieces that would be flipped if `player`
 *  played at (row, col). Scans all 8 directions per the standard Othello rule:
 *  adjacent opponent piece(s) followed eventually by one of the player's own. */
function getFlips(board, row, col, player) {
  if (board[row][col] !== EMPTY) return [];
  const opp = opponent(player);
  const allFlips = [];

  for (const [dr, dc] of DIRECTIONS) {
    const lineFlips = [];
    let r = row + dr, c = col + dc;
    while (inBounds(r, c) && board[r][c] === opp) {
      lineFlips.push({ row: r, col: c });
      r += dr;
      c += dc;
    }
    if (lineFlips.length > 0 && inBounds(r, c) && board[r][c] === player) {
      allFlips.push(...lineFlips);
    }
  }
  return allFlips;
}

/** Returns every legal move for `player` on `board`. */
function getValidMoves(board, player) {
  const moves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === EMPTY && getFlips(board, r, c, player).length > 0) {
        moves.push({ row: r, col: c });
      }
    }
  }
  return moves;
}

/** Returns a NEW board with `player`'s piece placed at (row, col) and all
 *  resulting flips applied. Does not mutate the input board. */
function applyMoveToBoard(board, row, col, player) {
  const next = cloneBoard(board);
  const flips = getFlips(board, row, col, player);
  next[row][col] = player;
  for (const { row: fr, col: fc } of flips) {
    next[fr][fc] = player;
  }
  return next;
}

function countPieces(board) {
  let black = 0, white = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === BLACK) black++;
      else if (board[r][c] === WHITE) white++;
    }
  }
  return { black, white };
}

function countCorners(board) {
  const corners = [[0, 0], [0, 7], [7, 0], [7, 7]];
  let black = 0, white = 0;
  for (const [r, c] of corners) {
    if (board[r][c] === BLACK) black++;
    else if (board[r][c] === WHITE) white++;
  }
  return { black, white };
}

/* ===========================================================
   GAME STATE
   =========================================================== */

let state = null;

function newState() {
  return {
    board: createInitialBoard(),
    currentPlayer: BLACK,
    gameOver: false,
    winner: null,               // BLACK | WHITE | 'draw'
    gameMode: getSelected("mode-select", "mode") || "pvc",
    humanColor: Number(getSelected("color-select", "color")) || BLACK,
    difficulty: getSelected("difficulty-select", "difficulty") || "medium",
    moveHistory: [],            // stack of snapshots, for undo
    moveCount: 1,
    aiThinking: false,
    renderedBoard: null,        // last board actually drawn, for diffing
    lastMove: null,
    soundOn: true,
  };
}

function getSelected(groupId, dataAttr) {
  const el = document.querySelector(`#${groupId} .segment.active`);
  return el ? el.dataset[dataAttr] : null;
}

/* ===========================================================
   SOUND — small synthesized tones, no external assets needed.
   =========================================================== */

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  return audioCtx;
}

function playTone(freq, duration, type = "sine", gainPeak = 0.08) {
  if (!state.soundOn) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(gainPeak, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration + 0.02);
}

const sounds = {
  place: () => playTone(520, 0.09, "triangle", 0.09),
  flip: () => playTone(340, 0.07, "sine", 0.05),
  invalid: () => playTone(140, 0.15, "square", 0.05),
  pass: () => playTone(220, 0.2, "sine", 0.05),
  win: () => { playTone(523, 0.15); setTimeout(() => playTone(659, 0.15), 120); setTimeout(() => playTone(784, 0.3), 240); },
  draw: () => playTone(300, 0.35, "sine", 0.06),
};

/* ===========================================================
   DOM REFERENCES
   =========================================================== */

const boardEl = document.getElementById("board");
const turnTextEl = document.getElementById("turn-text");
const turnDotEl = document.getElementById("turn-dot");
const thinkingEl = document.getElementById("thinking-indicator");
const blackScoreEl = document.getElementById("black-score");
const whiteScoreEl = document.getElementById("white-score");
const newGameBtn = document.getElementById("new-game-btn");
const restartBtn = document.getElementById("restart-btn");
const undoBtn = document.getElementById("undo-btn");
const soundToggleBtn = document.getElementById("sound-toggle");
const modalOverlay = document.getElementById("game-over-modal");
const modalPiece = document.getElementById("modal-piece");
const modalTitle = document.getElementById("modal-title");
const modalSubtitle = document.getElementById("modal-subtitle");
const modalNewGameBtn = document.getElementById("modal-new-game");
const modalCloseBtn = document.getElementById("modal-close");
const toastEl = document.getElementById("toast");
const gameLogEl = document.getElementById("game-log");
const colorField = document.getElementById("color-field");
const difficultyField = document.getElementById("difficulty-field");

const statMove = document.getElementById("stat-move");
const statValidBlack = document.getElementById("stat-valid-black");
const statValidWhite = document.getElementById("stat-valid-white");
const statCornerBlack = document.getElementById("stat-corner-black");
const statCornerWhite = document.getElementById("stat-corner-white");

let cellEls = []; // 8x8 grid of { el, pieceEl }

/* ===========================================================
   BOARD DOM CONSTRUCTION (built once)
   =========================================================== */

function buildBoardDom() {
  boardEl.innerHTML = "";
  cellEls = [];
  const corners = new Set(["0,0", "0,7", "7,0", "7,7"]);
  const stars = new Set(["2,2", "2,5", "5,2", "5,5"]);

  for (let r = 0; r < 8; r++) {
    const rowEls = [];
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      if ((r + c) % 2 === 1) cell.classList.add("dark-felt");
      if (corners.has(`${r},${c}`)) cell.classList.add("corner");
      if (stars.has(`${r},${c}`)) cell.classList.add("star");
      cell.setAttribute("role", "gridcell");
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.addEventListener("click", () => onCellClick(r, c));
      boardEl.appendChild(cell);
      rowEls.push({ el: cell, pieceEl: null });
    }
    cellEls.push(rowEls);
  }
}

/* ===========================================================
   RENDERING
   =========================================================== */

function renderBoard() {
  const board = state.board;
  const prev = state.renderedBoard;
  const interactive = !state.gameOver && !state.aiThinking
    && (state.gameMode === "pvp" || state.currentPlayer === state.humanColor);
  const validMoves = (state.gameOver || !interactive) ? [] : getValidMoves(board, state.currentPlayer);
  const validSet = new Set(validMoves.map((m) => `${m.row},${m.col}`));
  const lastMoveKey = state.lastMove ? `${state.lastMove.row},${state.lastMove.col}` : null;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const { el } = cellEls[r][c];
      const value = board[r][c];
      const prevValue = prev ? prev[r][c] : EMPTY;
      const key = `${r},${c}`;

      el.classList.toggle("legal", validSet.has(key));
      el.classList.toggle("last-move", key === lastMoveKey);

      // remove any existing dot
      const existingDot = el.querySelector(".move-dot");
      if (existingDot) existingDot.remove();

      if (value === EMPTY) {
        const existingPiece = el.querySelector(".piece");
        if (existingPiece) existingPiece.remove();
        cellEls[r][c].pieceEl = null;
        if (validSet.has(key)) {
          const dot = document.createElement("div");
          dot.className = "move-dot";
          el.appendChild(dot);
        }
        continue;
      }

      let pieceEl = cellEls[r][c].pieceEl;

      if (prevValue === EMPTY && value !== EMPTY) {
        // brand new piece placed here
        pieceEl = document.createElement("div");
        pieceEl.className = `piece piece-${value === BLACK ? "black" : "white"}`;
        el.appendChild(pieceEl);
        cellEls[r][c].pieceEl = pieceEl;
      } else if (prevValue !== EMPTY && prevValue !== value) {
        // flipped
        if (!pieceEl) {
          pieceEl = document.createElement("div");
          el.appendChild(pieceEl);
          cellEls[r][c].pieceEl = pieceEl;
        }
        pieceEl.className = `piece piece-${value === BLACK ? "black" : "white"} flipping`;
        // eslint-disable-next-line no-unused-expressions
        pieceEl.offsetWidth; // restart animation
      }
      // else: unchanged, leave as-is
    }
  }

  state.renderedBoard = cloneBoard(board);
  renderScores();
  renderTurn();
  renderStats();
  renderControlsAvailability();
}

function renderScores() {
  const { black, white } = countPieces(state.board);
  bumpIfChanged(blackScoreEl, black);
  bumpIfChanged(whiteScoreEl, white);
}

function bumpIfChanged(el, value) {
  const changed = el.textContent !== String(value);
  el.textContent = value;
  if (changed) {
    el.classList.remove("bump");
    // eslint-disable-next-line no-unused-expressions
    void el.offsetWidth;
    el.classList.add("bump");
  }
}

function renderTurn() {
  if (state.gameOver) {
    turnTextEl.textContent = "Game over";
    thinkingEl.hidden = true;
    return;
  }
  const colorName = state.currentPlayer === BLACK ? "Black" : "White";
  turnDotEl.classList.toggle("white", state.currentPlayer === WHITE);

  if (state.aiThinking) {
    turnTextEl.textContent = `${colorName} (computer) to move`;
    thinkingEl.hidden = false;
  } else if (state.gameMode === "pvc" && state.currentPlayer !== state.humanColor) {
    turnTextEl.textContent = `${colorName} (computer) to move`;
    thinkingEl.hidden = false;
  } else if (state.gameMode === "pvc") {
    turnTextEl.textContent = `Your turn (${colorName})`;
    thinkingEl.hidden = true;
  } else {
    turnTextEl.textContent = `${colorName} to move`;
    thinkingEl.hidden = true;
  }
}

function renderStats() {
  statMove.textContent = state.moveCount;
  const validBlack = getValidMoves(state.board, BLACK).length;
  const validWhite = getValidMoves(state.board, WHITE).length;
  statValidBlack.textContent = validBlack;
  statValidWhite.textContent = validWhite;
  const corners = countCorners(state.board);
  statCornerBlack.textContent = corners.black;
  statCornerWhite.textContent = corners.white;
}

function renderControlsAvailability() {
  undoBtn.disabled = state.moveHistory.length === 0 || state.aiThinking;
  colorField.style.display = state.gameMode === "pvc" ? "" : "none";
  difficultyField.style.display = state.gameMode === "pvc" ? "" : "none";
}

/* ===========================================================
   LOG + TOAST
   =========================================================== */

function logMessage(text) {
  const line = document.createElement("div");
  line.textContent = text;
  gameLogEl.appendChild(line);
  gameLogEl.scrollTop = gameLogEl.scrollHeight;
  // cap log length
  while (gameLogEl.children.length > 60) {
    gameLogEl.removeChild(gameLogEl.firstChild);
  }
}

let toastTimer = null;
function showToast(text, duration = 1800) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, duration);
}

function squareName(row, col) {
  return `${"abcdefgh"[col]}${row + 1}`;
}

/* ===========================================================
   TURN MANAGEMENT & MOVE EXECUTION
   =========================================================== */

function snapshotState() {
  return {
    board: cloneBoard(state.board),
    currentPlayer: state.currentPlayer,
    moveCount: state.moveCount,
    lastMove: state.lastMove,
    gameOver: state.gameOver,
    winner: state.winner,
  };
}

function pushHistory() {
  state.moveHistory.push(snapshotState());
}

/** Applies a move for the current player, flips pieces, updates score,
 *  switches the turn (handling passes), and checks for game over. */
function makeMove(row, col) {
  if (state.gameOver || state.aiThinking) return false;

  const player = state.currentPlayer;
  const flips = getFlips(state.board, row, col, player);
  if (state.board[row][col] !== EMPTY || flips.length === 0) {
    sounds.invalid();
    return false;
  }

  pushHistory();

  state.board = applyMoveToBoard(state.board, row, col, player);
  state.lastMove = { row, col };
  state.moveCount++;

  sounds.place();
  if (flips.length > 0) setTimeout(() => sounds.flip(), 90);

  logMessage(`${player === BLACK ? "Black" : "White"} played ${squareName(row, col)} (${flips.length} flipped)`);

  advanceTurnAfterMove();
  renderBoard();
  maybeTriggerAI();
  return true;
}

/** Decides whose turn is next, handling the "no legal move → pass" rule,
 *  and detects game-over when neither side can move / the board is full. */
function advanceTurnAfterMove() {
  const next = opponent(state.currentPlayer);
  const nextHasMoves = getValidMoves(state.board, next).length > 0;
  const currentStillHasMoves = getValidMoves(state.board, state.currentPlayer).length > 0;

  if (nextHasMoves) {
    state.currentPlayer = next;
    return;
  }

  // Next player has no legal move: pass back, unless current player is
  // ALSO stuck, in which case the game is over.
  if (currentStillHasMoves) {
    logMessage(`${next === BLACK ? "Black" : "White"} has no valid moves — pass`);
    showToast(`${next === BLACK ? "Black" : "White"} has no valid move — turn passes back`);
    sounds.pass();
    // state.currentPlayer stays the same (it plays again)
    return;
  }

  endGame();
}

function endGame() {
  state.gameOver = true;
  const { black, white } = countPieces(state.board);
  if (black > white) state.winner = BLACK;
  else if (white > black) state.winner = WHITE;
  else state.winner = "draw";

  const summary = state.winner === "draw"
    ? `Game over — draw ${black}–${white}`
    : `Game over — ${state.winner === BLACK ? "Black" : "White"} wins ${black}–${white}`;
  logMessage(summary);

  if (state.winner === "draw") sounds.draw(); else sounds.win();

  setTimeout(showGameOverModal, 380);
}

function checkGameOver() {
  const board = state.board;
  const full = countPieces(board).black + countPieces(board).white === 64;
  const noMoves = getValidMoves(board, BLACK).length === 0 && getValidMoves(board, WHITE).length === 0;
  return full || noMoves;
}

/* ===========================================================
   AI TURN HANDLING
   =========================================================== */

function maybeTriggerAI() {
  if (state.gameOver) return;
  if (state.gameMode !== "pvc") return;
  if (state.currentPlayer === state.humanColor) return;

  state.aiThinking = true;
  renderBoard();

  // Small delay so the "thinking" indicator is visible and the UI stays responsive
  // before the (synchronous) search runs.
  setTimeout(() => {
    const move = getAIMove(state.board, state.currentPlayer, state.difficulty);
    state.aiThinking = false;

    if (!move) {
      // Shouldn't normally happen (advanceTurnAfterMove already checks this),
      // but guard defensively.
      renderBoard();
      return;
    }
    makeMove(move.row, move.col);
  }, 420);
}

/* ===========================================================
   UNDO
   =========================================================== */

function undoMove() {
  if (state.moveHistory.length === 0 || state.aiThinking) return;

  let snap = state.moveHistory.pop();
  restoreSnapshot(snap);

  // In Player vs Computer mode, one undo should return control to the human:
  // if the position we just restored has the COMPUTER to move, undo once more.
  if (state.gameMode === "pvc" && !state.gameOver && state.currentPlayer !== state.humanColor
      && state.moveHistory.length > 0) {
    snap = state.moveHistory.pop();
    restoreSnapshot(snap);
  }

  logMessage("Move undone");
  renderBoard();
}

function restoreSnapshot(snap) {
  state.board = snap.board;
  state.currentPlayer = snap.currentPlayer;
  state.moveCount = snap.moveCount;
  state.lastMove = snap.lastMove;
  state.gameOver = snap.gameOver;
  state.winner = snap.winner;
  if (modalOverlay && !modalOverlay.hidden) hideGameOverModal();
}

/* ===========================================================
   GAME OVER MODAL
   =========================================================== */

function showGameOverModal() {
  const { black, white } = countPieces(state.board);
  modalPiece.className = "modal-piece";
  if (state.winner === "draw") {
    modalPiece.classList.add("piece-black");
    modalPiece.style.background = "linear-gradient(90deg, var(--black-piece) 50%, var(--white-piece) 50%)";
    modalTitle.textContent = "It's a draw";
  } else {
    modalPiece.classList.add(state.winner === BLACK ? "piece-black" : "piece-white");
    modalPiece.style.background = "";
    modalTitle.textContent = `${state.winner === BLACK ? "Black" : "White"} wins`;
  }
  modalSubtitle.textContent = `${black} — ${white}`;
  modalOverlay.hidden = false;
}

function hideGameOverModal() {
  modalOverlay.hidden = true;
}

/* ===========================================================
   NEW GAME / RESTART
   =========================================================== */

function initializeGame() {
  state = newState();
  gameLogEl.innerHTML = "";
  buildBoardDom();
  state.renderedBoard = null;
  hideGameOverModal();
  logMessage(`New game — ${state.gameMode === "pvc" ? "Player vs Computer" : "Player vs Player"}`);
  renderBoard();
  maybeTriggerAI();
}

/* ===========================================================
   EVENT WIRING
   =========================================================== */

function onCellClick(row, col) {
  if (state.gameOver || state.aiThinking) return;
  if (state.gameMode === "pvc" && state.currentPlayer !== state.humanColor) return;
  makeMove(row, col);
}

function wireSegmentedGroup(groupId, onChange) {
  const group = document.getElementById(groupId);
  group.addEventListener("click", (e) => {
    const btn = e.target.closest(".segment");
    if (!btn) return;
    [...group.children].forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    onChange(btn);
  });
}

function setupEventListeners() {
  newGameBtn.addEventListener("click", initializeGame);
  restartBtn.addEventListener("click", initializeGame);
  undoBtn.addEventListener("click", undoMove);

  modalNewGameBtn.addEventListener("click", () => { hideGameOverModal(); initializeGame(); });
  modalCloseBtn.addEventListener("click", hideGameOverModal);
  modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) hideGameOverModal(); });

  soundToggleBtn.addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    soundToggleBtn.querySelector(".sound-on").hidden = !state.soundOn;
    soundToggleBtn.querySelector(".sound-off").hidden = state.soundOn;
    if (state.soundOn) playTone(440, 0.06, "sine", 0.05);
  });

  wireSegmentedGroup("mode-select", () => { initializeGame(); });
  wireSegmentedGroup("color-select", () => { initializeGame(); });
  wireSegmentedGroup("difficulty-select", (btn) => {
    if (state) state.difficulty = btn.dataset.difficulty;
  });
}

/* ===========================================================
   BOOT
   =========================================================== */

document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  initializeGame();
});
