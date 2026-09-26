// Flat 2D chess board built from DOM elements. Same interface as Board3D.

const FILES = 'abcdefgh';
const fileOf = (sq) => FILES.indexOf(sq[0]);
const rankOf = (sq) => Number(sq[1]) - 1;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Solid glyphs for both colours (CSS colours them); U+FE0E keeps them out of emoji style.
export const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
export const VS = '︎';

export class Board2D {
  constructor({ board, squares, pieces }) {
    this.board = board;
    this.squaresEl = squares;
    this.piecesEl = pieces;
    this.inputEl = board;
    this.flip = false;
    this.squares = new Map();
    this.pieces = new Map(); // square -> { el, type, color }
    this.drag = null;
    this.build();
  }

  displayCol(sq) {
    return this.flip ? 7 - fileOf(sq) : fileOf(sq);
  }

  displayRow(sq) {
    return this.flip ? rankOf(sq) : 7 - rankOf(sq);
  }

  squareAt(col, row) {
    const file = this.flip ? 7 - col : col;
    const rank = this.flip ? row : 7 - row;
    return `${FILES[file]}${rank + 1}`;
  }

  build() {
    this.squaresEl.innerHTML = '';
    this.squares.clear();
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const sq = this.squareAt(col, row);
        const node = document.createElement('div');
        const light = (fileOf(sq) + rankOf(sq)) % 2 === 1;
        node.className = `cs-sq ${light ? 'light' : 'dark'}`;
        node.dataset.sq = sq;
        if (col === 0) {
          const r = document.createElement('span');
          r.className = 'coord rank';
          r.textContent = sq[1];
          node.appendChild(r);
        }
        if (row === 7) {
          const f = document.createElement('span');
          f.className = 'coord file';
          f.textContent = sq[0];
          node.appendChild(f);
        }
        this.squaresEl.appendChild(node);
        this.squares.set(sq, node);
      }
    }
  }

  place(node, sq) {
    node.style.setProperty('--x', this.displayCol(sq));
    node.style.setProperty('--y', this.displayRow(sq));
  }

  makePiece(type, color, sq, { appear = false } = {}) {
    const node = document.createElement('div');
    node.className = `cs-pc ${color}${appear ? ' appear' : ''}`;
    const glyph = document.createElement('span');
    glyph.textContent = GLYPH[type] + VS;
    node.appendChild(glyph);
    this.place(node, sq);
    this.piecesEl.appendChild(node);
    return { el: node, type, color };
  }

  // ---- interface ---------------------------------------------------------

  show(visible) {
    this.board.hidden = !visible;
  }

  setOrientation(flip) {
    if (this.flip === flip && this.squares.size) return;
    this.flip = flip;
    this.build();
    this.pieces.forEach((p, sq) => this.place(p.el, sq));
  }

  setShowCoords(show) {
    this.board.classList.toggle('hide-coords', !show);
  }

  setPosition(chess, { appear = false } = {}) {
    this.piecesEl.innerHTML = '';
    this.pieces.clear();
    chess.board().flat().forEach((p) => {
      if (p) this.pieces.set(p.square, this.makePiece(p.type, p.color, p.square, { appear }));
    });
  }

  removePiece(sq, { animate = true } = {}) {
    const piece = this.pieces.get(sq);
    if (!piece) return;
    this.pieces.delete(sq);
    if (!animate) {
      piece.el.remove();
      return;
    }
    piece.el.classList.add('taken-out');
    setTimeout(() => piece.el.remove(), 420);
  }

  async playMove({ from, to }, chess) {
    const moving = this.pieces.get(from);
    let captured = false;
    if (moving) {
      if (this.pieces.has(to)) {
        this.removePiece(to);
        captured = true;
      }
      this.pieces.delete(from);
      this.pieces.set(to, moving);
      moving.el.classList.add('moving');
      this.place(moving.el, to);
      if (moving.type === 'k' && Math.abs(fileOf(from) - fileOf(to)) === 2) {
        const rank = from[1];
        const [rookFrom, rookTo] = fileOf(to) === 6 ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`];
        const rook = this.pieces.get(rookFrom);
        if (rook) {
          this.pieces.delete(rookFrom);
          this.pieces.set(rookTo, rook);
          this.place(rook.el, rookTo);
        }
      }
      await wait(240);
      moving.el.classList.remove('moving');
    }
    return { captured: this.settle(chess).captured || captured };
  }

  applyLocalMove(from, to) {
    const piece = this.pieces.get(from);
    if (!piece) return;
    if (this.pieces.has(to)) this.removePiece(to);
    this.pieces.delete(from);
    this.pieces.set(to, piece);
    piece.el.classList.remove('dragging');
    piece.el.style.transform = '';
    this.place(piece.el, to);
    this.drag = null;
  }

  settle(chess) {
    const target = new Map();
    chess.board().flat().forEach((p) => p && target.set(p.square, p));
    let captured = false;
    this.pieces.forEach((piece, sq) => {
      const want = target.get(sq);
      if (!want) {
        this.removePiece(sq);
        captured = true;
      } else if (want.type !== piece.type || want.color !== piece.color) {
        this.removePiece(sq, { animate: false });
        this.pieces.set(sq, this.makePiece(want.type, want.color, sq, { appear: true }));
      }
    });
    target.forEach((want, sq) => {
      if (!this.pieces.has(sq)) this.pieces.set(sq, this.makePiece(want.type, want.color, sq, { appear: true }));
    });
    return { captured };
  }

  setHighlights({ last = null, selected = null, targets = [], check = null, hover = null } = {}) {
    this.squares.forEach((node) => node.classList.remove('last', 'selected', 'target', 'capture', 'check', 'hover-target'));
    last?.forEach((sq) => this.squares.get(sq)?.classList.add('last'));
    if (selected) this.squares.get(selected)?.classList.add('selected');
    targets.forEach(({ sq, capture }) => {
      const node = this.squares.get(sq);
      node?.classList.add('target');
      if (capture) node?.classList.add('capture');
    });
    if (check) this.squares.get(check)?.classList.add('check');
    if (hover) this.squares.get(hover)?.classList.add('hover-target');
  }

  squareFromEvent(event) {
    const rect = this.board.getBoundingClientRect();
    const col = Math.floor(((event.clientX - rect.left) / rect.width) * 8);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * 8);
    if (col < 0 || row < 0 || col > 7 || row > 7) return null;
    return this.squareAt(col, row);
  }

  dragStart(sq) {
    const piece = this.pieces.get(sq);
    if (piece) this.drag = { from: sq, piece };
  }

  dragMove(event) {
    if (!this.drag) return;
    const rect = this.board.getBoundingClientRect();
    const size = rect.width / 8;
    const { el } = this.drag.piece;
    el.classList.add('dragging');
    el.style.transform = `translate(${event.clientX - rect.left - size / 2}px, ${event.clientY - rect.top - size / 2}px)`;
  }

  dragEnd(sq) {
    this.drag = null;
    const piece = this.pieces.get(sq);
    if (!piece) return;
    piece.el.classList.remove('dragging');
    piece.el.style.transform = '';
  }
}
