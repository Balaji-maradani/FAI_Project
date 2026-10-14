# Othello — The Turning Game

A complete, playable Othello (Reversi) board game for the browser: HTML, CSS
and vanilla JavaScript only, no build step, no backend.

## 1. What is Othello?

Othello (also called Reversi) is a two-player strategy game played on an 8×8
board. Players alternate placing discs — one side black, one side white —
that are black on one face and white on the other. Any opponent discs
"trapped" in a straight line between the disc you just placed and another
disc of your own colour are flipped to your colour. The game ends when
neither player can move; whoever has the most discs on the board wins.

## 2. How the game works

- Black always moves first, from the standard starting position (two black,
  two white discs in the centre, arranged diagonally).
- On your turn, you may only place a disc on a square that captures at
  least one opposing disc.
- Legal squares are shown with a small glowing marker on the board.
- If you have no legal move, your turn is automatically passed back to your
  opponent.
- If **neither** player has a legal move, the game ends immediately, even if
  the board isn't full.
- The game also ends the moment the board fills up.
- Whoever holds more discs at the end wins; equal counts is a draw.

## 3. Technologies used

- **HTML5** — semantic structure, no template engine
- **CSS3** — custom properties (design tokens), CSS grid for the board,
  keyframe animations for placing/flipping pieces, responsive layout
- **Vanilla JavaScript (ES2019+)** — no frameworks, no bundler
- **Web Audio API** — small synthesized sound effects (no audio files to
  download)

## 4. Game rules (implementation notes)

A move at `(row, col)` is legal for `player` if the square is empty **and**
scanning outward in at least one of the 8 directions (N, S, E, W and the 4
diagonals) finds one or more consecutive opponent discs immediately followed
by one of the player's own discs. Placing the disc flips every opponent disc
found along each qualifying direction.

## 5. Algorithms used

| Concept | Where |
|---|---|
| 2D array board representation | `game.js` |
| 8-direction traversal | `getFlips()` in `game.js` |
| Legal move generation | `getValidMoves()` in `game.js` |
| Piece flipping | `getFlips()` + `applyMoveToBoard()` in `game.js` |
| Turn / pass / game-over state management | `advanceTurnAfterMove()`, `endGame()` in `game.js` |
| Minimax search | `minimax()` in `ai.js` (Medium difficulty) |
| Minimax + Alpha-Beta pruning | `alphaBetaSearch()` in `ai.js` (Hard difficulty) |
| Heuristic evaluation | `evaluateBoard()` in `ai.js` |
| Positional weighting | `POSITION_WEIGHTS` matrix in `ai.js` |
| Mobility analysis | inside `evaluateBoard()` in `ai.js` |

`getFlips(board, row, col, player)` is the single source of truth for the
directional scan — it's used both to decide whether a move is legal
(`getFlips(...).length > 0`) and to actually flip discs when a move is
played, so the scanning logic is never duplicated.

## 6. AI architecture

The AI is a pure function with no DOM access:

```js
const move = getAIMove(board, player, difficulty); // -> {row, col} | null
```

The game controller (`game.js`) is the only thing that ever touches the
board state or the DOM; it calls `getAIMove()`, applies whatever move comes
back through the same `makeMove()` path a human move takes, and re-renders.

```
UI
 │
 ▼
Game Controller (game.js)
 │
 ├── Board State
 ├── Move Validation
 ├── Piece Flipping
 ├── Turn Management
 └── Game Over
        │
        ▼
       AI (ai.js)
        │
        ├── Move Generation   (reuses getValidMoves from game.js)
        ├── Minimax           (Medium)
        ├── Alpha-Beta        (Hard)
        └── Evaluation
```

### Difficulty levels

- **Easy** — picks uniformly at random among the legal moves. Intentionally
  weak, no lookahead.
- **Medium** — full minimax, searching 2–4 plies ahead depending on how
  many branches are available, so the browser never stalls.
- **Hard** — minimax with alpha-beta pruning, searching 4–7 plies ahead. The
  search depth increases automatically in the endgame (when few empty
  squares remain), effectively solving the last several moves outright.
  Moves are also ordered by their static positional weight before search,
  which makes the pruning far more effective.

### Minimax, in short

Minimax explores the tree of possible future moves: on the AI's own turns it
picks the move that **maximizes** its evaluation score; on the opponent's
(simulated) turns it assumes they'll play well and pick the move that
**minimizes** the AI's score. The result is the best move assuming rational
play from both sides, `depth` moves ahead.

### Alpha-beta pruning, in short

Alpha-beta pruning is the same search, but it keeps track of the best score
the maximizer can already guarantee (`alpha`) and the best score the
minimizer can already guarantee (`beta`). As soon as a branch is found that
could never beat what the other side can already force, the rest of that
branch is skipped (`beta <= alpha`). The final chosen move is identical to
plain minimax — pruning only cuts search time, not search quality — which
is what lets Hard mode search noticeably deeper than Medium in the same
amount of time.

### Heuristic evaluation

Since counting discs alone is a poor guide for most of the game (a big lead
in the middle game is often given back), `evaluateBoard()` combines four
signals, all from the perspective of the player being evaluated for:

```
score = positional weights (per-square table, corners weighted heavily)
      + piece difference (weighted lightly early, more heavily near the end)
      + mobility (your legal moves vs. your opponent's)
      + corner control (a direct bonus for each corner you hold)
```

### Positional weighting

A fixed 8×8 weight table scores each square:

```
100  -20   10    5    5   10  -20  100
-20  -50   -2   -2   -2   -2  -50  -20
 10   -2   -1   -1   -1   -1   -2   10
  5   -2   -1   -1   -1   -1   -2    5
  5   -2   -1   -1   -1   -1   -2    5
 10   -2   -1   -1   -1   -1   -2   10
-20  -50   -2   -2   -2   -2  -50  -20
100  -20   10    5    5   10  -20  100
```

Corners score very highly, since a disc placed there can never be flipped.
The squares diagonally adjacent to each corner score very negatively (the
classic Othello "X-square" trap), because occupying one of those early
often hands the opponent an easy path to capture the corner itself.

### Mobility analysis

`(your legal move count − opponent's legal move count)`, normalised, is
added to the score. Restricting your opponent's options while keeping your
own open is often more valuable in the middle game than the raw disc count.

## 7. How to run the project

No build step, no server required — just open `index.html` in any modern
browser. If your browser blocks local file access for the module-less
scripts (rare, but some setups are stricter about `file://`), serve the
folder locally instead, e.g.:

```bash
cd othello
python3 -m http.server 8000
# then open http://localhost:8000
```

## 8. Project folder structure

```
othello/
│
├── index.html    — page structure, board markup, side panel, modal
├── style.css     — design tokens, layout, board/piece styling, animations
├── game.js       — board rules, rendering, turn management, undo, sound
├── ai.js         — evaluation function, minimax, alpha-beta, difficulty
└── README.md     — this file
```

## 9. Features

- Player vs Player and Player vs Computer modes, with a choice of colour
- Three AI difficulties (Easy / Medium / Hard)
- Legal-move highlighting, piece placement and 3D flip animations
- Undo (in Player vs Computer mode, one undo reverts both the computer's
  move and your own, returning you to your last decision point)
- New Game / Restart
- Live statistics: move number, legal moves and corners held per side
- A short game log
- Optional sound effects (togglable, synthesized — no audio files)
- Fully responsive, down to small mobile screens
