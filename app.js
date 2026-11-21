(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const boardEl = $('#board');
  const game = new Chess();

  let selected = null;
  let playerColor = 'w';
  let flipped = false;
  let lastMove = null;
  let engine = null;
  let engineReady = false;
  let analysisRun = 0;
  let recommendedMove = null;
  let dragFrom = null;
  let pointerDrag = null;
  let suppressClick = false;

  const symbols = { wp:'♙', wn:'♘', wb:'♗', wr:'♖', wq:'♕', wk:'♔', bp:'♟', bn:'♞', bb:'♝', br:'♜', bq:'♛', bk:'♚' };

  function pieceKey(piece) { return piece ? `${piece.color}${piece.type}` : ''; }

  function squareName(row, col) {
    const file = 'abcdefgh'[col];
    const rank = 8 - row;
    return `${file}${rank}`;
  }

  function render() {
    boardEl.innerHTML = '';
    const rows = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    const cols = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    const board = game.board();

    for (const row of rows) {
      for (const col of cols) {
        const square = squareName(row, col);
        const piece = board[row][col];
        const button = document.createElement('button');
        button.className = `square ${(row + col) % 2 ? 'dark' : 'light'}`;
        button.dataset.square = square;
        button.setAttribute('aria-label', `${square}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : ''}`);

        if (selected === square) button.classList.add('selected');
        if (lastMove && (lastMove.from === square || lastMove.to === square)) button.classList.add(lastMove.from === square ? 'last-from' : 'last-to');

        if (selected) {
          const moveCandidates = game.moves({ square: selected, verbose: true });
          const candidate = moveCandidates.find((move) => move.to === square);
          if (candidate) button.classList.add(candidate.captured ? 'legal-capture' : 'legal');
        }

        if (piece) {
          const span = document.createElement('span');
          span.className = `piece ${piece.color === 'w' ? 'white' : 'black'}`;
          span.textContent = symbols[pieceKey(piece)];
          button.appendChild(span);
        }

        if (col === (flipped ? 7 : 0)) {
          const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = square[1]; button.appendChild(rank);
        }
        if (row === (flipped ? 0 : 7)) {
          const coord = document.createElement('span'); coord.className = 'coord'; coord.textContent = square[0]; button.appendChild(coord);
        }

        button.addEventListener('click', (event) => {
          if (suppressClick) {
            suppressClick = false;
            return;
          }
          onSquareClick(event);
        });
        boardEl.appendChild(button);
      }
    }
  }

  function onSquareClick(event) {
    const square = event.currentTarget.dataset.square;
    const piece = game.get(square);

    if (selected) {
      const options = { from: selected, to: square, promotion: 'q' };
      try {
        const move = game.move(options);
        if (move) {
          lastMove = { from: move.from, to: move.to };
          selected = null;
          clearMoveArrow();
          render();
          updateFen();
          analyzePosition();
          return;
        }
      } catch (_) {}
    }

    if (piece && piece.color === game.turn()) {
      selected = square;
    } else {
      selected = null;
    }
    render();
  }

  function updateFen() { $('#fenInput').value = game.fen(); }

  function setPosition(fen) {
    const ok = fen ? game.load(fen) : false;
    if (!ok) return false;
    selected = null;
    lastMove = null;
    recommendedMove = null;
    clearMoveArrow();
    render();
    updateFen();
    return true;
  }

  function formatMove(moveText) {
    if (!moveText) return '—';
    const map = { a:'a', b:'b', c:'c', d:'d', e:'e', f:'f', g:'g', h:'h' };
    const match = moveText.match(/^([a-h])([1-8])([a-h])([1-8])([qrbn])?$/);
    if (!match) return moveText;
    const promotion = match[5] ? ({q:'=Q', r:'=R', b:'=B', n:'=N'})[match[5]] : '';
    return `${map[match[1]]}${match[2]} → ${map[match[3]]}${match[4]}${promotion}`;
  }

  function formatPv(pv) {
    if (!pv) return [];
    return pv.trim().split(/\s+/).slice(0, 8).map(formatMove);
  }

  function initEngine() {
    const status = $('#engineStatus');
    try {
      const urls = [
        '/stockfish-11-asm.js'
      ];
      engine = new Worker(urls[0]);
      engine.onmessage = (event) => handleEngineLine(typeof event.data === 'string' ? event.data : event.data.toString());
      engine.onerror = () => {
        status.className = 'engine-status';
        status.innerHTML = '<i></i> Engine unavailable';
        engineReady = false;
        $('#lineStatus').textContent = 'Unavailable';
      };
      engine.postMessage('uci');
    } catch (_) {
      status.className = 'engine-status';
      status.innerHTML = '<i></i> Engine unavailable';
    }
  }

  function handleEngineLine(line) {
    const status = $('#engineStatus');
    if (line === 'uciok') {
      engine.postMessage('isready');
    } else if (line === 'readyok') {
      engineReady = true;
      status.className = 'engine-status ready';
      status.innerHTML = '<i></i> Engine ready';
    } else if (line.startsWith('info ')) {
      const depthMatch = line.match(/\bdepth (\d+)/);
      const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
      const pvMatch = line.match(/\bpv (.+)$/);

      if (depthMatch) $('#depthValue').textContent = depthMatch[1];
      if (scoreMatch) {
        const side = game.turn() === 'w' ? 1 : -1;
        let text;
        if (scoreMatch[1] === 'mate') {
          text = `M${Math.abs(Number(scoreMatch[2]))}`;
        } else {
          let cp = Number(scoreMatch[2]) * side;
          text = `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
        }
        $('#evaluation').textContent = text;
      }
      if (pvMatch) {
        const moves = formatPv(pvMatch[1]);
        $('#principalLine').innerHTML = moves.length
          ? moves.map((move) => `<li>${move}</li>`).join('')
          : '<li>Calculating...</li>';
        $('#lineStatus').textContent = 'Searching';
      }
    } else if (line.startsWith('bestmove ')) {
      const move = line.split(/\s+/)[1];
      recommendedMove = move;
      $('#bestMove').textContent = formatMove(move);
      drawMoveArrow(move);
      $('#lineStatus').textContent = 'Complete';
    }
  }

  function analyzePosition() {
    if (!engineReady || !engine) {
      $('#lineStatus').textContent = engineReady ? 'Idle' : 'Loading engine';
      return;
    }
    const depth = $('#depthRange').value;
    analysisRun++;
    engine.postMessage('stop');
    engine.postMessage('ucinewgame');
    engine.postMessage(`position fen ${game.fen()}`);
    engine.postMessage(`go depth ${depth}`);
    $('#bestMove').textContent = 'Calculating...';
    $('#evaluation').textContent = '—';
    $('#lineStatus').textContent = 'Searching';
  }

  function clearMoveArrow() {
    $('#boardWrapArrow')?.remove();
  }

  function squareCenter(square) {
    if (!/^([a-h])([1-8])$/.test(square)) return null;
    const fileIndex = 'abcdefgh'.indexOf(square[0]);
    const rankIndex = Number(square[1]) - 1;
    const displayFile = flipped ? 7 - fileIndex : fileIndex;
    const displayRank = flipped ? rankIndex : 7 - rankIndex;
    return {
      x: (displayFile + 0.5) * 100,
      y: (displayRank + 0.5) * 100
    };
  }

  function drawMoveArrow(moveText) {
    clearMoveArrow();
    if (!moveText || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(moveText)) return;
    const from = squareCenter(moveText.slice(0, 2));
    const to = squareCenter(moveText.slice(2, 4));
    if (!from || !to) return;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (!length) return;
    const ux = dx / length;
    const uy = dy / length;
    const startX = from.x + ux * 22;
    const startY = from.y + uy * 22;
    const endX = to.x - ux * 28;
    const endY = to.y - uy * 28;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.id = 'boardWrapArrow';
    svg.classList.add('best-move-arrow');
    svg.setAttribute('viewBox', '0 0 800 800');

    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', startX);
    line.setAttribute('y1', startY);
    line.setAttribute('x2', endX);
    line.setAttribute('y2', endY);

    const headSize = 38;
    const perpendicularX = -uy;
    const perpendicularY = ux;
    const points = [
      `${endX + ux * 22},${endY + uy * 22}`,
      `${endX - ux * headSize + perpendicularX * headSize},${endY - uy * headSize + perpendicularY * headSize}`,
      `${endX - ux * headSize - perpendicularX * headSize},${endY - uy * headSize - perpendicularY * headSize}`
    ].join(' ');

    const polygon = document.createElementNS(svgNS, 'polygon');
    polygon.setAttribute('points', points);
    svg.append(line, polygon);
    $('.board-wrap').appendChild(svg);
  }

  $('#colorPicker').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    playerColor = button.dataset.color;
    document.querySelectorAll('#colorPicker button').forEach((item) => item.classList.toggle('active', item === button));
    flipped = playerColor === 'b';
    $('#youSide').textContent = playerColor === 'w' ? 'White' : 'Black';
    $('#opponentSide').textContent = playerColor === 'w' ? 'Black' : 'White';
    render();
    if (recommendedMove) drawMoveArrow(recommendedMove);
  });

  $('#startPositionBtn').addEventListener('click', () => setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
  $('#loadFenBtn').addEventListener('click', () => {
    const fen = $('#fenInput').value.trim();
    if (!setPosition(fen)) alert('That FEN is invalid. Check the position and try again.');
  });
  $('#fenInput').addEventListener('change', () => {
    const fen = $('#fenInput').value.trim();
    if (fen) setPosition(fen);
  });
  $('#analyzeBtn').addEventListener('click', analyzePosition);
  $('#resetBtn').addEventListener('click', () => setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
  $('#undoBtn').addEventListener('click', () => {
    const move = game.undo();
    if (move) lastMove = null;
    selected = null;
    render();
    updateFen();
  });
  $('#flipBtn').addEventListener('click', () => {
    flipped = !flipped;
    render();
    if (recommendedMove) drawMoveArrow(recommendedMove);
  });
  $('#depthRange').addEventListener('input', () => { $('#depthValue').textContent = $('#depthRange').value; });

  render();
  updateFen();
  initEngine();

  function createDragPieceElement(sourceSquare) {
    const sourcePiece = sourceSquare.querySelector('.piece');
    if (!sourcePiece) return null;
    const ghost = document.createElement('div');
    ghost.className = `drag-ghost ${sourcePiece.classList.contains('white') ? 'white' : 'black'}`;
    ghost.textContent = sourcePiece.textContent;
    return ghost;
  }

  function moveDragPiece(event) {
    if (!pointerDrag) return;
    pointerDrag.style.left = `${event.clientX}px`;
    pointerDrag.style.top = `${event.clientY}px`;

    document.querySelectorAll('.drag-hover').forEach((square) => square.classList.remove('drag-hover'));
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('button[data-square]');
    if (target) target.classList.add('drag-hover');
  }

  function executeMove(from, to) {
    try {
      const move = game.move({ from, to, promotion: 'q' });
      if (!move) return false;
      lastMove = { from: move.from, to: move.to };
      selected = null;
      dragFrom = null;
      clearMoveArrow();
      render();
      updateFen();
      analyzePosition();
      return true;
    } catch (_) {
      return false;
    }
  }

  function finishPointerDrag(event) {
    if (!pointerDrag) return;
    suppressClick = true;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('button[data-square]');
    const from = dragFrom;
    const to = target?.dataset.square;

    pointerDrag.remove();
    pointerDrag = null;
    dragFrom = null;
    selected = null;
    document.querySelectorAll('.drag-origin,.drag-hover').forEach((square) => {
      square.classList.remove('drag-origin', 'drag-hover');
    });

    if (from && to && from !== to) executeMove(from, to);
    else render();
  }

  boardEl.addEventListener('pointerdown', (event) => {
    const sourceSquare = event.target.closest('button[data-square]');
    if (!sourceSquare) return;
    const square = sourceSquare.dataset.square;
    const piece = game.get(square);
    if (!piece || piece.color !== game.turn()) return;

    event.preventDefault();
    dragFrom = square;
    selected = square;
    pointerDrag = createDragPieceElement(sourceSquare);
    if (!pointerDrag) return;

    sourceSquare.classList.add('drag-origin');
    document.body.appendChild(pointerDrag);
    pointerDrag.classList.add('lifted');
    pointerDrag.style.left = `${event.clientX}px`;
    pointerDrag.style.top = `${event.clientY}px`;
  });

  window.addEventListener('pointermove', moveDragPiece);
  window.addEventListener('pointerup', finishPointerDrag);
  window.addEventListener('pointercancel', finishPointerDrag);
})();
