/* =========================================================
   ai.js — Othello AI engine
   -----------------------------------------------------------
   This file ONLY computes moves. It never touches the DOM.
   It relies on a handful of pure board-logic helpers that are
   defined in game.js and exposed on the global scope:

     getValidMoves(board, player)   -> [{row, col}, ...]
     getFlips(board, row, col, player) -> [{row,col}, ...]
   applyMoveToBoard(board, row, col, player) -> new board (copy)
     cloneBoard(board)              -> deep copy
     opponent(player)               -> 1 <-> 2

   Public API used by game.js:
     getAIMove(board, player, difficulty) -> {row, col} | null
   ========================================================= */

/* ---------- 15. Positional weight matrix ----------
   Corners are highly prized; squares adjacent to empty
   corners (the "X-squares" and "C-squares") are penalised
   because they hand the opponent an easy path to the corner. */
const POSITION_WEIGHTS = [
  [100, -20, 10, 5, 5, 10, -20, 100],
  [-20, -50, -2, -2, -2, -2, -50, -20],
  [10, -2, -1, -1, -1, -1, -2, 10],
  [5, -2, -1, -1, -1, -1, -2, 5],
  [5, -2, -1, -1, -1, -1, -2, 5],
  [10, -2, -1, -1, -1, -1, -2, 10],
  [-20, -50, -2, -2, -2, -2, -50, -20],
  [100, -20, 10, 5, 5, 10, -20, 100],
];

const CORNERS = [[0, 0], [0, 7], [7, 0], [7, 7]];

/* ---------- 14. Evaluation function ----------
   score = positional weights + piece difference + mobility + corner control
   All terms are expressed from `player`'s point of view (positive = good for player). */
function evaluateBoard(board, player) {
  const opp = opponent(player);

  let positional = 0;
  let playerCount = 0;
  let oppCount = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c];
      if (cell === player) {
        positional += POSITION_WEIGHTS[r][c];
        playerCount++;
      } else if (cell === opp) {
        positional -= POSITION_WEIGHTS[r][c];
        oppCount++;
      }
    }
  }

  // Piece difference — weighted lightly; matters most near the end of the game.
  const totalPieces = playerCount + oppCount;
  const pieceDiffWeight = totalPieces > 50 ? 1.5 : 0.25; // count more once the board fills up
  const pieceDiff = pieceDiffWeight * (playerCount - oppCount);

  // Mobility — having more legal moves than the opponent is a real advantage.
  const playerMoves = getValidMoves(board, player).length;
  const oppMoves = getValidMoves(board, opp).length;
  let mobility = 0;
  if (playerMoves + oppMoves !== 0) {
    mobility = 10 * (playerMoves - oppMoves) / (playerMoves + oppMoves + 1);
  }

  // Corner control — corners can never be flipped, so weight them heavily on top
  // of the positional matrix (which already scores them at 100).
  let cornerScore = 0;
  for (const [r, c] of CORNERS) {
    if (board[r][c] === player) cornerScore += 25;
    else if (board[r][c] === opp) cornerScore -= 25;
  }

  return positional + pieceDiff + mobility + cornerScore;
}

/* ---------- 13. Minimax (no pruning) — used by "Medium" ---------- */
function minimax(board, depth, currentPlayer, aiPlayer) {
  const moves = getValidMoves(board, currentPlayer);
  const opp = opponent(currentPlayer);

  if (depth === 0) {
    return { score: evaluateBoard(board, aiPlayer) };
  }

  if (moves.length === 0) {
    // No legal move: pass. If the opponent also has nothing, it's terminal.
    const oppMoves = getValidMoves(board, opp);
    if (oppMoves.length === 0) {
      return { score: evaluateBoard(board, aiPlayer) };
    }
    const result = minimax(board, depth - 1, opp, aiPlayer);
    return { score: result.score };
  }

  const maximizing = currentPlayer === aiPlayer;
  let best = maximizing ? -Infinity : Infinity;
  let bestMove = moves[0];

  for (const move of moves) {
    const nextBoard = applyMoveToBoard(board, move.row, move.col, currentPlayer);
    const result = minimax(nextBoard, depth - 1, opp, aiPlayer);
    if (maximizing ? result.score > best : result.score < best) {
      best = result.score;
      bestMove = move;
    }
  }

  return { score: best, move: bestMove };
}

/* ---------- 13. Minimax + Alpha-Beta pruning — used by "Hard" ---------- */
function alphaBetaSearch(board, depth, alpha, beta, currentPlayer, aiPlayer) {
  const moves = getValidMoves(board, currentPlayer);
  const opp = opponent(currentPlayer);

  if (depth === 0) {
    return { score: evaluateBoard(board, aiPlayer) };
  }

  if (moves.length === 0) {
    const oppMoves = getValidMoves(board, opp);
    if (oppMoves.length === 0) {
      return { score: evaluateBoard(board, aiPlayer) };
    }
    const result = alphaBetaSearch(board, depth - 1, alpha, beta, opp, aiPlayer);
    return { score: result.score };
  }

  const maximizing = currentPlayer === aiPlayer;
  let bestMove = moves[0];

  // Move ordering: try corners first, then by static positional weight.
  // This makes alpha-beta pruning noticeably more effective.
  const ordered = [...moves].sort((a, b) => POSITION_WEIGHTS[b.row][b.col] - POSITION_WEIGHTS[a.row][a.col]);

  if (maximizing) {
    let best = -Infinity;
    for (const move of ordered) {
      const nextBoard = applyMoveToBoard(board, move.row, move.col, currentPlayer);
      const result = alphaBetaSearch(nextBoard, depth - 1, alpha, beta, opp, aiPlayer);
      if (result.score > best) {
        best = result.score;
        bestMove = move;
      }
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break; // prune
    }
    return { score: best, move: bestMove };
  } else {
    let best = Infinity;
    for (const move of ordered) {
      const nextBoard = applyMoveToBoard(board, move.row, move.col, currentPlayer);
      const result = alphaBetaSearch(nextBoard, depth - 1, alpha, beta, opp, aiPlayer);
      if (result.score < best) {
        best = result.score;
        bestMove = move;
      }
      beta = Math.min(beta, best);
      if (beta <= alpha) break; // prune
    }
    return { score: best, move: bestMove };
  }
}

/* ---------- 19. Difficulty dispatch ---------- */
function getAIMove(board, player, difficulty) {
  const moves = getValidMoves(board, player);
  if (moves.length === 0) return null;

  if (difficulty === "easy") {
    // Intentionally weak: purely random legal move.
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // Reduce search depth dynamically when there are many branches to explore,
  // so the browser never freezes.
  const emptyCount = 64 - countPieces(board).black - countPieces(board).white;

  if (difficulty === "medium") {
    let depth = moves.length > 8 ? 2 : 3;
    if (emptyCount <= 10) depth = 4; // play the endgame a bit more carefully
    const result = minimax(board, depth, player, player);
    return result.move || moves[0];
  }

  // hard
  let depth = 4;
  if (moves.length <= 6) depth = 5;
  if (emptyCount <= 12) depth = 6;
  if (emptyCount <= 8) depth = 7; // solve the endgame almost exhaustively
  const result = alphaBetaSearch(board, depth, -Infinity, Infinity, player, player);
  return result.move || moves[0];
}
