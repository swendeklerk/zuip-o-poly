export const BOARD_SIZE = 11;

export function getBoardCells() {
  const cells = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      cells.push({
        row,
        col,
        tileId: getTileIdForPosition(row, col)
      });
    }
  }

  return cells;
}

function getTileIdForPosition(row, col) {
  if (row === 0) {
    return col + 1;
  }

  if (col === BOARD_SIZE - 1 && row >= 1 && row <= 9) {
    return row + 11;
  }

  if (row === BOARD_SIZE - 1) {
    return 31 - col;
  }

  if (col === 0 && row >= 1 && row <= 9) {
    return 41 - row;
  }

  return null;
}
