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
  let moveClassification = null;
  let preMoveEvalCp = null;
  let postMoveEvalCp = null;

  const symbols = { wp:'♙', wn:'♘', wb:'♗', wr:'♖', wq:'♕', wk:'♔', bp:'♟', bn:'♞', bb:'♝', br:'♜', bq:'♛', bk:'♚' };
  const moveLabels = {
    book: { label: 'Book', icon: '📖', className: 'book' },
    brilliant: { label: 'Brilliant', icon: '★★', className: 'brilliant' },
    great: { label: 'Great', icon: '★', className: 'great' },
    excellent: { label: 'Excellent', icon: '!', className: 'excellent' },
    good: { label: 'Good', icon: '✓', className: 'good' },
    opening: { label: 'Study', icon: '➜', className: 'opening' },
    inaccuracy: { label: 'Inaccuracy', icon: '?!', className: 'inaccuracy' },
    mistake: { label: 'Mistake', icon: '?', className: 'mistake' },
    blunder: { label: 'Blunder', icon: '??', className: 'blunder' },
    miss: { label: 'Miss', icon: '×', className: 'miss' }
  };

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
        if (moveClassification && lastMove && lastMove.to === square) {
          const badge = document.createElement('span');
          const details = moveLabels[moveClassification] || moveLabels.good;
          badge.className = `move-badge ${details.className}`;
          badge.title = details.label;
          badge.setAttribute('aria-label', details.label);
          badge.textContent = details.icon;
          button.appendChild(badge);
        }

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
    updatePositionStatus();
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
          classifyMove(move);
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
    clearMoveClassification();
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
        updateWinRate(scoreMatch[1], scoreMatch[2]);
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
    $('#whiteWinRate').textContent = '50%';
    $('#blackWinRate').textContent = '50%';
    $('#whiteWinBar').style.width = '50%';
    $('#blackWinBar').style.width = '50%';
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
    if (move) {
      lastMove = null;
      clearMoveClassification();
    }
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

  const preferences = {
    theme: 'light', board: 'classic', piece: 'classic', background: 'mist',
    coordinates: true, arrows: true, shadows: true
  };

  try {
    Object.assign(preferences, JSON.parse(localStorage.getItem('boardscout-preferences') || '{}'));
  } catch (_) {}

  const validThemes = ['light', 'dark', 'forest', 'ocean', 'ember', 'violet', 'ice', 'mono'];
  const validBoards = ['classic', 'blue', 'brown', 'pink', 'forest', 'violet', 'ember', 'slate'];
  if (!validThemes.includes(preferences.theme)) preferences.theme = 'dark';
  if (!validBoards.includes(preferences.board)) preferences.board = 'classic';

  function savePreferences() {
    localStorage.setItem('boardscout-preferences', JSON.stringify(preferences));
  }

  function applyPreferences() {
    document.documentElement.dataset.theme = preferences.theme;
    document.body.dataset.theme = preferences.theme;
    document.body.classList.toggle('dark-theme', preferences.theme === 'dark');
    document.body.classList.toggle('forest-theme', preferences.theme === 'forest');
    document.body.dataset.background = preferences.background;
    document.body.classList.remove(
      'board-classic', 'board-blue', 'board-brown', 'board-pink',
      'board-forest', 'board-violet', 'board-ember', 'board-slate'
    );
    document.body.classList.add(`board-${preferences.board}`);

    document.body.classList.remove('piece-classic', 'piece-bold', 'piece-outline');
    document.body.classList.add(`piece-${preferences.piece}`);
    document.body.classList.toggle('no-coordinates', !preferences.coordinates);
    document.body.classList.toggle('no-arrows', !preferences.arrows);
    document.body.classList.toggle('no-shadows', !preferences.shadows);

    const activeMap = [
      ['#themePicker', 'theme'], ['#boardPicker', 'board'],
      ['#piecePicker', 'piece'], ['#backgroundPicker', 'background']
    ];
    activeMap.forEach(([selector, key]) => {
      document.querySelectorAll(`${selector} [data-${key}]`).forEach((item) => {
        item.classList.toggle('active', item.dataset[key] === preferences[key]);
      });
    });
    $('#coordinatesToggle').checked = preferences.coordinates;
    $('#arrowsToggle').checked = preferences.arrows;
    $('#shadowsToggle').checked = preferences.shadows;
  }

  function openSettings() {
    $('#settingsPanel').classList.add('open');
    $('#settingsBackdrop').classList.add('open');
    $('#settingsPanel').setAttribute('aria-hidden', 'false');
    $('#settingsBackdrop').setAttribute('aria-hidden', 'false');
  }

  function closeSettings() {
    $('#settingsPanel').classList.remove('open');
    $('#settingsBackdrop').classList.remove('open');
    $('#settingsPanel').setAttribute('aria-hidden', 'true');
    $('#settingsBackdrop').setAttribute('aria-hidden', 'true');
  }

  function bindPreferencePicker(selector, key) {
    document.querySelectorAll(`${selector} [data-${key}]`).forEach((item) => {
      item.addEventListener('click', () => {
        preferences[key] = item.dataset[key];
        applyPreferences();
        savePreferences();
      });
    });
  }

  $('#settingsBtn').addEventListener('click', openSettings);
  $('#closeSettingsBtn').addEventListener('click', closeSettings);
  $('#settingsBackdrop').addEventListener('click', closeSettings);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSettings(); });

  bindPreferencePicker('#themePicker', 'theme');
  bindPreferencePicker('#boardPicker', 'board');
  bindPreferencePicker('#piecePicker', 'piece');
  bindPreferencePicker('#backgroundPicker', 'background');

  $('#coordinatesToggle').addEventListener('change', (event) => { preferences.coordinates = event.target.checked; applyPreferences(); savePreferences(); });
  $('#arrowsToggle').addEventListener('change', (event) => { preferences.arrows = event.target.checked; applyPreferences(); savePreferences(); });
  $('#shadowsToggle').addEventListener('change', (event) => { preferences.shadows = event.target.checked; applyPreferences(); savePreferences(); });
  $('#resetSettingsBtn').addEventListener('click', () => {
    Object.assign(preferences, { theme:'light', board:'classic', piece:'classic', background:'mist', coordinates:true, arrows:true, shadows:true });
    applyPreferences(); savePreferences();
  });

  applyPreferences();

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
      classifyMove(move);
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

  document.querySelectorAll('.view-tabs button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.view-tabs button').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      document.body.dataset.view = button.dataset.view;
      if (button.dataset.view === 'analysis') {
        analyzePosition();
        $('#settingsBtn').blur();
      }
    });
  });

  function classifyMove(move) {
    if (!recommendedMove) {
      moveClassification = 'good';
    } else {
      const played = `${move.from}${move.to}${move.promotion || ''}`;
      if (played === recommendedMove) {
        moveClassification = 'great';
      } else {
        moveClassification = 'good';
      }
    }

    const details = moveLabels[moveClassification] || moveLabels.good;
    const label = $(`#moveClassification`);
    if (label) {
      label.textContent = details.label;
      label.className = `move-classification ${details.className}`;
    }
  }

  function clearMoveClassification() {
    moveClassification = null;
    const label = $(`#moveClassification`);
    if (label) {
      label.textContent = 'Waiting';
      label.className = 'move-classification';
    }
  }

  function updateWinRate(scoreType, scoreValue) {
    const rawScore = Number(scoreValue);
    let whiteAdvantagePawns;

    if (scoreType === 'mate') {
      if (rawScore === 0) whiteAdvantagePawns = 0;
      else {
        const whiteMate = game.turn() === 'w' ? rawScore > 0 : rawScore < 0;
        whiteAdvantagePawns = whiteMate ? 40 : -40;
      }
    } else {
      whiteAdvantagePawns = rawScore / 100;
    }

    if (game.turn() === 'b') whiteAdvantagePawns *= -1;

    const whiteWin = 100 / (1 + Math.pow(10, -whiteAdvantagePawns / 3.5));
    const whitePercent = Math.round(Math.max(1, Math.min(99, whiteWin)));
    const blackPercent = 100 - whitePercent;

    $('#whiteWinRate').textContent = `${whitePercent}%`;
    $('#blackWinRate').textContent = `${blackPercent}%`;
    $('#whiteWinBar').style.width = `${whitePercent}%`;
    $('#blackWinBar').style.width = `${blackPercent}%`;
  }

  function updatePositionStatus() {
    const status = $('#positionStatus');
    const text = $('#positionStatusText');
    if (!status || !text) return;

    status.className = 'position-status';

    if (game.in_checkmate()) {
      const winner = game.turn() === 'w' ? 'Black' : 'White';
      status.classList.add('checkmate');
      text.textContent = `Checkmate — ${winner} wins`;
    } else if (game.in_check()) {
      const checkedSide = game.turn() === 'w' ? 'White' : 'Black';
      const isYou = (game.turn() === 'w' ? 'w' : 'b') === playerColor;
      status.classList.add('check');
      text.textContent = isYou ? `${checkedSide} — You are in check` : `${checkedSide} — Opponent is in check`;
    } else if (game.in_draw()) {
      status.classList.add('draw');
      text.textContent = 'Draw';
    } else {
      text.textContent = 'Position ready';
    }
  }
})();
