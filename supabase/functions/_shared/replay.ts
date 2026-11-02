export type ReplayResult = {
  score: number;
  gameOver: boolean;
  moveCount: number;
};

type Position = { x: number; y: number };
type Board = (number | null)[][];

function randomFrom(seed: number) {
  let state = seed >>> 0;
  if (!state) state = 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function availableCells(board: Board): Position[] {
  const cells: Position[] = [];
  for (let x = 0; x < 6; x++) {
    for (let y = 0; y < 6; y++) {
      if (board[x][y] === null) cells.push({ x, y });
    }
  }
  return cells;
}

function addTile(board: Board, random: () => number) {
  const cells = availableCells(board);
  if (!cells.length) return;
  const cell = cells[Math.floor(random() * cells.length)];
  board[cell.x][cell.y] = random() < 0.9 ? 2 : 4;
}

function hasMoves(board: Board): boolean {
  for (let x = 0; x < 6; x++) {
    for (let y = 0; y < 6; y++) {
      const value = board[x][y];
      if (value === null) return true;
      if (x < 5 && board[x + 1][y] === value) return true;
      if (y < 5 && board[x][y + 1] === value) return true;
    }
  }
  return false;
}

function move(board: Board, direction: number): { moved: boolean; score: number } {
  const vectors = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 }
  ];
  const vector = vectors[direction];
  const xs = direction === 1 ? [5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5];
  const ys = direction === 2 ? [5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5];
  const merged = new Set<string>();
  let changed = false;
  let score = 0;

  for (const x of xs) {
    for (const y of ys) {
      const value = board[x][y];
      if (value === null) continue;

      let nextX = x;
      let nextY = y;
      while (
        nextX + vector.x >= 0 && nextX + vector.x < 6 &&
        nextY + vector.y >= 0 && nextY + vector.y < 6 &&
        board[nextX + vector.x][nextY + vector.y] === null
      ) {
        nextX += vector.x;
        nextY += vector.y;
      }

      const targetX = nextX + vector.x;
      const targetY = nextY + vector.y;
      if (
        targetX >= 0 && targetX < 6 && targetY >= 0 && targetY < 6 &&
        board[targetX][targetY] === value &&
        !merged.has(targetX + "," + targetY)
      ) {
        board[targetX][targetY] = value * 2;
        board[x][y] = null;
        merged.add(targetX + "," + targetY);
        score += value * 2;
        changed = true;
      } else if (nextX !== x || nextY !== y) {
        board[nextX][nextY] = value;
        board[x][y] = null;
        changed = true;
      }
    }
  }

  return { moved: changed, score };
}

export function replay(seed: number, moves: number[]): ReplayResult {
  const board: Board = Array.from({ length: 6 }, () =>
    Array<number | null>(6).fill(null)
  );
  const random = randomFrom(seed);
  let score = 0;
  let moveCount = 0;

  addTile(board, random);
  addTile(board, random);

  for (const direction of moves) {
    if (!Number.isInteger(direction) || direction < 0 || direction > 3) {
      throw new Error("Move history contains an invalid direction.");
    }
    const result = move(board, direction);
    if (!result.moved) throw new Error("Move history contains an impossible move.");
    score += result.score;
    addTile(board, random);
    moveCount++;
    if (!hasMoves(board)) {
      if (moveCount !== moves.length) {
        throw new Error("Move history continues after the game ended.");
      }
      break;
    }
  }

  return { score, gameOver: !hasMoves(board), moveCount };
}
