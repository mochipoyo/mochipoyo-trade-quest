/* =========================================================
   もちぽよFXクエスト - UI描画・画面遷移・演出
   DOM操作はすべてここに集約する。ゲームロジックは game.js / battle.js。
   ========================================================= */
(function (root) {
  'use strict';

  var CONFIG = root.CONFIG, DATA = root.DATA, Game = root.Game, Scenarios = root.Scenarios, Battle = root.Battle,
    Chart = root.Chart, Sprites = root.Sprites, Save = root.Save;

  var UI = { screen: null, chartState: { tf: '15m', visible: CONFIG.chart.visibleBars } };
  var $screen, $overlay, $toast;

  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function yen(v) { return '¥' + Math.round(v).toLocaleString('ja-JP'); }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  /* ---------- 効果音（WebAudio・自作の簡易音。初期状態はOFF） ---------- */
  var Sound = {
    ctx: null,
    play: function (type) {
      if (!Game.state || !Game.state.settings.sound) return;
      try {
        if (!Sound.ctx) Sound.ctx = new (root.AudioContext || root.webkitAudioContext)();
        var c = Sound.ctx; if (c.state === 'suspended') c.resume();
        var seq = { select: [[660, 0.05]], attack: [[220, 0.08], [440, 0.08], [880, 0.12]], hit: [[160, 0.15]], win: [[523, 0.1], [659, 0.1], [784, 0.1], [1046, 0.25]],
          levelup: [[784, 0.08], [988, 0.08], [1175, 0.08], [1568, 0.3]], lose: [[300, 0.2], [220, 0.3]], guard: [[440, 0.06], [330, 0.1]], talk: [[880, 0.03]] }[type] || [[440, 0.05]];
        var t = c.currentTime;
        seq.forEach(function (n) {
          var o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = n[0];
          g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + n[1]);
          o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + n[1]); t += n[1];
        });
      } catch (e) { /* 音が出なくてもゲームは続行 */ }
    }
  };
  UI.Sound = Sound;

  /* ---------- 共通 ---------- */
  function show(html, cls) {
    // 画面ごとにイベントリスナーを引き継がないよう、要素を作り直す
    var fresh = $screen.cloneNode(false); $screen.parentNode.replaceChild(fresh, $screen); $screen = fresh;
    $overlay.innerHTML = '';
    $screen.className = 'screen ' + (cls || '');
    $screen.innerHTML = html;
    $screen.scrollTop = 0;
    root.scrollTo(0, 0);
  }
  function toast(msg, ms) {
    $toast.textContent = msg; $toast.classList.add('show');
    clearTimeout($toast._t); $toast._t = setTimeout(function () { $toast.classList.remove('show'); }, ms || 1800);
  }
  function modal(html, cls) {
    var m = el('<div class="modal-backdrop"><div class="modal win ' + (cls || '') + '">' + html + '</div></div>');
    $overlay.appendChild(m); return m;
  }
  function closeModal(m) { if (m && m.parentNode) m.parentNode.removeChild(m); }
  function playerBars() {
    var p = Game.state.player; var mh = Game.maxHp(), mm = Game.maxMp();
    return '<div class="bars"><div class="bar hp"><span style="width:' + (p.hp / mh * 100) + '%"></span><label>HP ' + p.hp + '/' + mh + '</label></div>' +
      '<div class="bar mp"><span style="width:' + (p.mp / mm * 100) + '%"></span><label>MP ' + p.mp + '/' + mm + '</label></div></div>';
  }
  function spriteHtml(key, scale, cls) { return '<canvas class="sprite ' + (cls || '') + '" data-sprite="' + key + '" data-scale="' + (scale || 4) + '"></canvas>'; }
  function drawSprites(rootEl) {
    (rootEl || $screen).querySelectorAll('canvas[data-sprite]').forEach(function (c) { if (!c._drawn) { Sprites.draw(c, c.getAttribute('data-sprite'), parseInt(c.getAttribute('data-scale'), 10) || 4, c.hasAttribute('data-flip')); c._drawn = true; } });
  }

  /* ---------- 会話ウィンドウ（タップで進む） ---------- */
  function dialogue(name, lines, onDone, spriteKey) {
    var idx = 0;
    var box = el('<div class="dialogue-wrap"><div class="dialogue win">' + (spriteKey ? '<div class="dlg-sprite">' + spriteHtml(spriteKey, 3) + '</div>' : '') +
      '<div class="dlg-body"><div class="dlg-name">' + esc(name) + '</div><div class="dlg-text"></div><div class="dlg-next">▼</div></div></div></div>');
    $overlay.appendChild(box); drawSprites(box);
    var textEl = box.querySelector('.dlg-text'); var typing = null; var full = '';
    function typeLine() {
      full = lines[idx]; textEl.textContent = '';
      var speed = Game.state && Game.state.settings.textSpeed === 'fast' ? 8 : 28; var i = 0;
      clearInterval(typing);
      if (Game.state && Game.state.settings.textSpeed === 'instant') { textEl.textContent = full; return; }
      typing = setInterval(function () { i++; textEl.textContent = full.slice(0, i); if (i % 3 === 0) Sound.play('talk'); if (i >= full.length) clearInterval(typing); }, speed);
    }
    box.addEventListener('click', function () {
      if (textEl.textContent.length < full.length) { clearInterval(typing); textEl.textContent = full; return; }
      idx++;
      if (idx >= lines.length) { closeModal(box); if (onDone) onDone(); } else typeLine();
    });
    typeLine();
  }
  UI.dialogue = dialogue;

  /* ========================================================
     タイトル
     ======================================================== */
  UI.title = function () {
    var hasSave = Game.hasSave();
    show('<div class="title-screen"><div class="stars"></div><div class="title-logo"><div class="t1">' + esc(DATA.title) + '</div><div class="t2">' + esc(DATA.subtitle) + '</div></div>' +
      '<div class="title-heroes">' + spriteHtml('hero_sword', 5) + spriteHtml('hero_mage', 5) + spriteHtml('hero_sage', 5) + '</div>' +
      '<div class="title-menu">' + (hasSave ? '<button class="btn gold" data-act="continue">つづきから</button>' : '') +
      '<button class="btn" data-act="new">はじめから</button><button class="btn" data-act="datamgmt">データ管理</button></div>' +
      '<div class="title-note">チャートはすべて学習用の人工データです。実際の市場データではありません。<br>セーブデータはこのブラウザ内（LocalStorage）に保存されます。</div></div>', 'title');
    drawSprites();
    $screen.onclick = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-act'); if (!a) return; Sound.play('select');
      if (a === 'continue') { Game.init(); UI.worldmap(); }
      if (a === 'new') { if (hasSave && !confirm('セーブデータが上書きされます。はじめからにしますか？')) return; UI.charSelect(); }
      if (a === 'datamgmt') UI.dataManagement(true);
    };
  };

  /* ========================================================
     キャラクター選択
     ======================================================== */
  UI.charSelect = function () {
    var cards = DATA.characters.map(function (c) {
      return '<div class="char-card" data-char="' + c.id + '" style="--accent:' + c.color + '">' + spriteHtml(c.sprite, 6) + '<div class="char-name">' + esc(c.name) + '</div><div class="char-desc">' + esc(c.desc) + '</div>' +
        '<div class="char-stats">分析' + (1 + c.bonus.analysis) + ' 判断' + (1 + c.bonus.judgment) + ' 忍耐' + (1 + c.bonus.patience) + ' 資金' + (1 + c.bonus.money) + '</div></div>';
    }).join('');
    show('<div class="panel win"><h2>冒険者を選ぶ</h2><p class="muted">キャラクターごとに見た目と得意分野が変わります。チャートに対する正解は変わりません。</p>' +
      '<div class="char-grid">' + cards + '</div><div class="row"><label>名前：<input id="pname" maxlength="10" placeholder="（空欄なら職業名）"></label></div>' +
      '<div class="row"><button class="btn gold" id="start" disabled>冒険に出る</button><button class="btn" data-act="back">戻る</button></div></div>', 'select');
    drawSprites();
    var chosen = null;
    $screen.onclick = function (e) {
      var card = e.target.closest && e.target.closest('.char-card');
      if (card) { chosen = card.getAttribute('data-char'); $screen.querySelectorAll('.char-card').forEach(function (c) { c.classList.toggle('sel', c === card); }); document.getElementById('start').disabled = false; Sound.play('select'); return; }
      if (e.target.id === 'start' && chosen) {
        var name = document.getElementById('pname').value.trim();
        Game.newGame(chosen, name); var ch = Game.character(chosen);
        dialogue(ch.name, [ch.intro, '……気がつくと、見知らぬ村の前に立っていた。ここは「相場の世界」らしい。'], function () { UI.worldmap(); }, ch.sprite);
      }
      if (e.target.getAttribute('data-act') === 'back') UI.title();
    };
  };

  /* ========================================================
     ワールドマップ
     ======================================================== */
  UI.worldmap = function () {
    var s = Game.state;
    var pts = [[60, 300], [160, 240], [250, 300], [340, 210], [430, 270], [520, 180], [610, 240], [700, 150]];
    var path = 'M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join(' L ');
    var nodes = DATA.chapters.map(function (ch, i) {
      var p = pts[i]; var unlocked = Game.isUnlocked(ch.id), cleared = Game.isCleared(ch.id);
      var cls = cleared ? 'cleared' : unlocked ? 'open' : 'locked';
      return '<g class="node ' + cls + '" data-ch="' + ch.id + '" transform="translate(' + p[0] + ',' + p[1] + ')"><circle r="22"></circle><text y="6">' + esc(ch.mapIcon) + '</text><text class="label" y="42">' + esc(ch.title) + '</text>' + (cleared ? '<text class="star" y="-28">★</text>' : '') + '</g>';
    }).join('');
    var hero = Game.character(s.player.charId) || DATA.characters[0];
    var cur = pts[Math.max(0, Math.min(pts.length - 1, s.progress.unlockedChapters.length - 1))];
    var dungeonOpen = s.progress.ending;
    show('<div class="map-wrap"><div class="map-top win"><div>' + spriteHtml(hero.sprite, 3) + '<b>' + esc(s.player.name) + '</b> Lv.' + s.player.level + ' <span class="muted">' + esc(Game.rank()) + '</span></div>' + playerBars() + '</div>' +
      '<svg class="worldmap" viewBox="0 0 760 380" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1226"/><stop offset="1" stop-color="#1b3a2a"/></linearGradient></defs>' +
      '<rect width="760" height="380" fill="url(#sky)"/>' +
      '<ellipse cx="200" cy="330" rx="180" ry="40" fill="#24502f"/><ellipse cx="520" cy="320" rx="220" ry="50" fill="#23463a"/><ellipse cx="380" cy="120" rx="120" ry="30" fill="#2a2d4a"/>' +
      '<polygon points="300,250 340,170 380,250" fill="#4a4f66"/><polygon points="330,250 365,185 400,250" fill="#5a5f78"/>' +
      '<path d="' + path + '" class="road"/>' + nodes +
      '<g transform="translate(' + (cur[0] - 24) + ',' + (cur[1] - 60) + ')"><foreignObject width="48" height="48"><div xmlns="http://www.w3.org/1999/xhtml" class="map-hero">' + spriteHtml(hero.sprite, 3) + '</div></foreignObject></g></svg>' +
      '<div class="map-menu">' +
      '<button class="btn" data-act="status">ステータス</button><button class="btn" data-act="items">アイテム</button><button class="btn" data-act="achv">実績</button><button class="btn" data-act="stats">成績</button>' +
      '<button class="btn" data-act="glossary">用語辞典</button><button class="btn ' + (dungeonOpen ? 'gold' : '') + '" data-act="dungeon">エンドレスダンジョン' + (dungeonOpen ? '' : '（クリア後）') + '</button>' +
      '<button class="btn" data-act="settings">設定</button><button class="btn" data-act="title">タイトルへ</button></div>' +
      '<p class="muted small center">エリアをタップして入る。★はクリア済み、暗いエリアは未解放。</p></div>', 'map');
    drawSprites();
    $screen.onclick = function (e) {
      var g = e.target.closest && e.target.closest('g.node');
      if (g) { var ch = parseInt(g.getAttribute('data-ch'), 10); if (Game.isUnlocked(ch)) { Sound.play('select'); UI.chapter(ch); } else toast('まだ行けない。前のエリアのボスを倒そう。'); return; }
      var a = e.target.getAttribute && e.target.getAttribute('data-act'); if (!a) return; Sound.play('select');
      if (a === 'status') UI.status(); if (a === 'items') UI.items(); if (a === 'achv') UI.achievements(); if (a === 'stats') UI.stats();
      if (a === 'glossary') UI.glossary(); if (a === 'settings') UI.settings(); if (a === 'title') UI.title();
      if (a === 'dungeon') { if (dungeonOpen) UI.dungeon(); else toast('エンドレスダンジョンは相場魔王城クリア後に解放されます。'); }
    };
  };

  /* ========================================================
     章（町）画面
     ======================================================== */
  UI.chapter = function (chId) {
    var ch = Game.chapter(chId); var area = DATA.areas[ch.area];
    function done(step) { return Game.stepDone(chId, step); }
    function mark(step) { return done(step) ? '<span class="chk">✓</span>' : ''; }
    var monsters = ch.monsters.map(function (m, i) { return '<button class="btn wide" data-act="monster" data-i="' + i + '">' + spriteHtml(m.sprite, 2) + ' ' + esc(m.name) + 'と戦う ' + mark('monster' + i) + '</button>'; }).join('');
    var bossOpen = Game.monstersDone(chId);
    show('<div class="town" style="background:' + area.bg + '"><div class="town-head win"><div class="town-title">第' + ch.id + '章 ' + esc(ch.title) + '</div><div class="muted">テーマ：' + esc(ch.theme) + '</div></div>' +
      '<div class="town-scene"><div class="ground" style="background:' + area.ground + '"></div><div class="npc-stand">' + spriteHtml(ch.npc.sprite, 5) + '<div class="npc-label">' + esc(ch.npc.name) + '</div></div></div>' +
      '<div class="town-menu win"><div class="quest-line">クエスト「' + esc(ch.quest.title) + '」：' + esc(ch.quest.desc) + (Game.state.progress.quests[chId] ? ' <span class="chk">達成</span>' : '') + '</div>' +
      '<button class="btn wide" data-act="npc">' + esc(ch.npc.name) + 'と話す ' + mark('npc') + '</button>' +
      '<button class="btn wide" data-act="lesson">教えを学ぶ（' + ch.lessons.length + '項目） ' + mark('lesson') + '</button>' +
      '<button class="btn wide" data-act="example">実例チャートを見る ' + mark('example') + '</button>' +
      '<button class="btn wide" data-act="quiz">練習問題に挑戦 ' + mark('quiz') + '</button>' + monsters +
      '<button class="btn wide boss ' + (bossOpen ? '' : 'disabled') + '" data-act="boss">' + spriteHtml(ch.boss.sprite, 2) + ' ボス「' + esc(ch.boss.name) + '」に挑む ' + mark('boss') + (bossOpen ? '' : '<span class="muted">（モンスターを全て倒すと挑戦可能）</span>') + '</button>' +
      '<button class="btn wide" data-act="review">章のまとめ（復習） ' + mark('review') + '</button>' +
      '<button class="btn" data-act="map">ワールドマップへ</button></div></div>', 'chapter');
    drawSprites();
    $screen.onclick = function (e) {
      var b = e.target.closest && e.target.closest('[data-act]'); if (!b) return; var a = b.getAttribute('data-act'); Sound.play('select');
      if (a === 'npc') dialogue(ch.npc.name, ch.npc.lines, function () { Game.markStep(chId, 'npc'); UI.chapter(chId); }, ch.npc.sprite);
      if (a === 'lesson') UI.lesson(chId);
      if (a === 'example') UI.example(chId, 0);
      if (a === 'quiz') UI.quiz(chId);
      if (a === 'monster') UI.battleIntro('monster', chId, parseInt(b.getAttribute('data-i'), 10));
      if (a === 'boss') { if (bossOpen) UI.battleIntro('boss', chId, 0); else toast('先にモンスターを全て倒そう。'); }
      if (a === 'review') UI.review(chId);
      if (a === 'map') UI.worldmap();
    };
  };

  /* ---------- 教え（レッスン） ---------- */
  UI.lesson = function (chId, page) {
    var ch = Game.chapter(chId); page = page || 0; var L = ch.lessons[page];
    show('<div class="panel win lesson"><div class="muted">第' + ch.id + '章 教え ' + (page + 1) + '/' + ch.lessons.length + '</div><h2>' + esc(L.title) + '</h2><p class="lesson-text">' + esc(L.text) + '</p>' +
      '<div class="row"><button class="btn" data-act="prev" ' + (page === 0 ? 'disabled' : '') + '>前へ</button>' + (page < ch.lessons.length - 1 ? '<button class="btn gold" data-act="next">次へ</button>' : '<button class="btn gold" data-act="done">学び終える</button>') + '<button class="btn" data-act="back">町へ戻る</button></div></div>', 'lesson');
    $screen.onclick = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-act'); if (!a) return; Sound.play('select');
      if (a === 'prev') UI.lesson(chId, page - 1); if (a === 'next') UI.lesson(chId, page + 1);
      if (a === 'done') { Game.markStep(chId, 'lesson'); toast('教えを学んだ！'); UI.chapter(chId); }
      if (a === 'back') UI.chapter(chId);
    };
  };

  /* ---------- 実例チャート ---------- */
  UI.example = function (chId, idx) {
    var ch = Game.chapter(chId); var id = ch.examples[idx]; var scn = Scenarios.build(id, 0); var def = scn.def;
    UI.chartState.tf = def.focusTF; UI.chartState.showDiv = true;
    show('<div class="panel win example"><div class="muted">第' + ch.id + '章 実例 ' + (idx + 1) + '/' + ch.examples.length + '</div><h2>' + esc(def.title) + '</h2>' +
      chartBlock() + '<div class="explain"><b>この場面の適切な判断：' + esc(Battle.ACTION_LABEL[def.correct]) + '</b><p>' + esc(def.explain[def.correct]) + '</p><div id="exam-desc" class="muted small"></div></div>' +
      '<div class="row">' + (idx < ch.examples.length - 1 ? '<button class="btn gold" data-act="next">次の実例</button>' : '<button class="btn gold" data-act="done">確認した</button>') + '<button class="btn" data-act="back">町へ戻る</button></div></div>', 'example');
    bindChart(scn, [], { showLevels: true }, function (an, tfId) { document.getElementById('exam-desc').innerHTML = describeTF(an, tfId).map(esc).join('<br>'); });
    $screen.addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-act'); if (!a) return;
      if (a === 'next') UI.example(chId, idx + 1);
      if (a === 'done') { Game.markStep(chId, 'example'); UI.chapter(chId); }
      if (a === 'back') UI.chapter(chId);
    });
  };

  /* ---------- チャート共通ブロック ---------- */
  function chartBlock() {
    var tfs = CONFIG.timeframes.map(function (t) { return '<button class="tf" data-tf="' + t.id + '">' + esc(t.label) + '</button>'; }).join('');
    return '<div class="chart-box"><div class="chart-tools"><div class="tfs">' + tfs + '</div><div class="ctl"><button class="mini" data-zoom="in">＋</button><button class="mini" data-zoom="out">－</button><button class="mini" data-zig="1">ZigZag</button><button class="mini" data-expand="1">拡大</button></div></div>' +
      '<canvas class="chart" id="chart"></canvas><div class="chart-note">※学習用の人工データ（' + esc(CONFIG.market.pairName) + '）。確定済みピボットのみ実線表示。</div></div>';
  }

  // チャートの描画と操作をバインドする。revealedは公開済みの未来足（focusTFの本数で管理）
  var chartCtl = null;
  function bindChart(scn, revealedBase, opts, onRender) {
    chartCtl = { scn: scn, revealedBase: revealedBase || [], opts: opts || {}, onRender: onRender, expanded: false };
    function render() {
      var tfId = UI.chartState.tf; var tf = CONFIG.timeframes.filter(function (t) { return t.id === tfId; })[0];
      var base = root.Indicators.aggregate(scn.base, tf.factor);
      // 公開済み未来足（5分足単位で保持）を同じ集約で変換し、同一元データからの整合性を保つ
      var rev = chartCtl.revealedBase.length ? root.Indicators.aggregate(scn.base.concat(chartCtl.revealedBase), tf.factor).slice(base.length) : [];
      var an = Chart.buildView(base, rev);
      var canvas = document.getElementById('chart'); if (!canvas) return;
      var o = { visibleBars: UI.chartState.visible, showZigzag: Game.state ? Game.state.settings.showZigzag : true, tfLabel: tf.label, showDivergence: UI.chartState.showDiv };
      Object.keys(chartCtl.opts).forEach(function (k) { o[k] = chartCtl.opts[k]; });
      Chart.render(canvas, an, o);
      $screen.querySelectorAll('.tf').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tf') === tfId); });
      var zb = $screen.querySelector('[data-zig]'); if (zb) zb.classList.toggle('on', o.showZigzag);
      if (chartCtl.onRender) chartCtl.onRender(an, tfId);
      return an;
    }
    chartCtl.render = render;
    $screen.addEventListener('click', function (e) {
      var t = e.target;
      if (t.getAttribute && t.getAttribute('data-tf')) { UI.chartState.tf = t.getAttribute('data-tf'); if (chartCtl.onTf) chartCtl.onTf(UI.chartState.tf); render(); }
      if (t.getAttribute && t.getAttribute('data-zoom')) { var d = t.getAttribute('data-zoom') === 'in' ? -15 : 15; UI.chartState.visible = Math.max(CONFIG.chart.minVisible, Math.min(CONFIG.chart.maxVisible, UI.chartState.visible + d)); render(); }
      if (t.getAttribute && t.getAttribute('data-zig')) { Game.state.settings.showZigzag = !Game.state.settings.showZigzag; Game.save(); render(); }
      if (t.getAttribute && t.getAttribute('data-expand')) { var box = $screen.querySelector('.chart-box'); box.classList.toggle('expanded'); chartCtl.expanded = box.classList.contains('expanded'); t.textContent = chartCtl.expanded ? '縮小' : '拡大'; setTimeout(render, 30); }
    });
    requestAnimationFrame(render);
    root.onresize = function () { if (chartCtl && document.getElementById('chart')) chartCtl.render(); };
    return chartCtl;
  }

  // インジケーター状態の説明文（表示される値と同じ計算結果を使う）
  function describeTF(an, tfId) {
    var tf = CONFIG.timeframes.filter(function (t) { return t.id === tfId; })[0];
    var lines = ['【' + tf.label + '】'];
    var dw = { up: '高値・安値ともに切り上げ（上昇）', down: '高値・安値ともに切り下げ（下降）', range: '切り上げ・切り下げが揃わない（レンジ／方向感なし）', unknown: '確定したスイングが不足' }[an.dow.trend];
    lines.push('波形（ダウ理論）：' + dw);
    var eo = { up: 'EMA20＞30＞40（上昇の並び）', down: 'EMA20＜30＜40（下降の並び）', mixed: 'EMAが絡み合っている' }[an.emaOrder];
    lines.push('EMA：' + eo + '、価格はEMAの' + { above: '上', below: '下', between: '間' }[an.pricePos] + '、EMA20の傾きは' + { up: '上向き', down: '下向き', flat: '横ばい' }[an.emaSlope] + '、EMA20との乖離' + an.distFromEma20.toFixed(0) + 'pips');
    if (an.rciNow !== null && an.rciNow !== undefined) lines.push('RCI(9)：' + an.rciNow.toFixed(0) + '（' + { oversold_reversal: '-70付近から反転中', overbought_reversal: '+70付近から反転中', overbought: '+70以上（買われすぎ側）', oversold: '-70以下（売られすぎ側）', neutral: '中立' }[an.rciState] + '）');
    lines.push('MACD：' + (an.macdState === 'bull' ? 'MACDがシグナルの上' : 'MACDがシグナルの下') + (an.div.regularBull ? '、通常の強気ダイバージェンス' : '') + (an.div.regularBear ? '、通常の弱気ダイバージェンス' : '') + (an.div.hiddenBull ? '、強気ヒドゥンダイバージェンス' : '') + (an.div.hiddenBear ? '、弱気ヒドゥンダイバージェンス' : ''));
    lines.push('直近スイング：高値 ' + an.lastHigh.toFixed(3) + ' ／ 安値 ' + an.lastLow.toFixed(3) + '、直近5本の変化 ' + (an.surge >= 0 ? '+' : '') + an.surge.toFixed(0) + 'pips');
    return lines;
  }

  /* ---------- 練習問題 ---------- */
  UI.quiz = function (chId, idx, score) {
    var ch = Game.chapter(chId); idx = idx || 0; score = score || 0;
    if (idx >= ch.quiz.length) {
      var perfect = score === ch.quiz.length;
      show('<div class="panel win"><h2>練習問題 結果</h2><p class="big">' + score + ' / ' + ch.quiz.length + ' 問正解</p><p>' + (perfect ? '完璧！ この章の知識は身についている。' : '間違えた問題の解説をもう一度読んでおこう。') + '</p><div class="row"><button class="btn gold" data-act="done">町へ戻る</button><button class="btn" data-act="retry">もう一度</button></div></div>', 'quiz');
      Game.markStep(chId, 'quiz'); Game.addExp(10 * score); Game.save();
      $screen.onclick = function (e) { var a = e.target.getAttribute('data-act'); if (a === 'done') UI.chapter(chId); if (a === 'retry') UI.quiz(chId, 0, 0); };
      return;
    }
    var q = ch.quiz[idx];
    show('<div class="panel win quiz"><div class="muted">練習問題 ' + (idx + 1) + '/' + ch.quiz.length + '</div><h2>' + esc(q.q) + '</h2><div class="options">' + q.options.map(function (o, i) { return '<button class="btn wide opt" data-i="' + i + '">' + esc(o) + '</button>'; }).join('') + '</div><div id="qfb" class="explain hidden"></div></div>', 'quiz');
    $screen.onclick = function (e) {
      var b = e.target.closest && e.target.closest('.opt'); if (!b || $screen.querySelector('.opt.disabled')) return;
      var i = parseInt(b.getAttribute('data-i'), 10); var ok = i === q.answer;
      $screen.querySelectorAll('.opt').forEach(function (o, k) { o.classList.add('disabled'); if (k === q.answer) o.classList.add('correct'); if (k === i && !ok) o.classList.add('wrong'); });
      Sound.play(ok ? 'attack' : 'hit');
      var fb = document.getElementById('qfb'); fb.classList.remove('hidden');
      fb.innerHTML = '<b>' + (ok ? '正解！' : '不正解……') + '</b><p>' + esc(q.explain) + '</p><button class="btn gold" id="qnext">次へ</button>';
      document.getElementById('qnext').onclick = function () { UI.quiz(chId, idx + 1, score + (ok ? 1 : 0)); };
    };
  };

  /* ---------- 復習 ---------- */
  UI.review = function (chId) {
    var ch = Game.chapter(chId); var bossDone = Game.stepDone(chId, 'boss');
    show('<div class="panel win"><h2>第' + ch.id + '章のまとめ</h2><ul class="review">' + ch.review.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
      (bossDone ? '<p class="gold-text">この章はクリア済み。次のエリアへ進もう。</p>' : '<p class="muted">ボスを倒すと章クリアになる。</p>') +
      '<div class="row"><button class="btn gold" data-act="done">復習した</button></div></div>', 'review');
    $screen.onclick = function (e) { if (e.target.getAttribute('data-act') === 'done') { Game.markStep(chId, 'review'); UI.chapter(chId); } };
  };

  /* ========================================================
     戦闘
     ======================================================== */
  UI.battleIntro = function (kind, chId, index) {
    var b = Game.startBattle(kind, chId, index);
    var enemy = b.enemy;
    show('<div class="encounter"><div class="flash"></div><div class="enc-text">' + (kind === 'boss' ? '<span class="boss-tag">BOSS</span>' : '') + esc(enemy.name) + 'が現れた！</div><div class="enc-sprite">' + spriteHtml(enemy.sprite, kind === 'boss' ? 8 : 6) + '</div></div>', 'encounter');
    drawSprites(); Sound.play('hit');
    var lines = [enemy.taunt]; if (kind === 'boss') lines.unshift(enemy.intro);
    setTimeout(function () { dialogue(enemy.name, lines, function () { UI.battle(); }, enemy.sprite); }, 700);
  };

  UI.battle = function () {
    var b = Game.battle, cur = b.current, s = Game.state; var hero = Game.character(s.player.charId) || DATA.characters[0];
    UI.chartState.tf = cur.tf; UI.chartState.showDiv = false; // 戦闘中はダイバージェンス補助線を自動表示しない（自分で見抜く）
    var areaBg = b.kind === 'dungeon' ? DATA.areas.demon.bg : DATA.areas[Game.chapter(b.chapterId).area].bg;
    show('<div class="battle" style="background:' + areaBg + '">' +
      '<div class="enemy-row"><div class="enemy-info win"><div class="enemy-name">' + (b.kind === 'boss' ? '<span class="boss-tag">BOSS</span> ' : '') + esc(b.enemy.name) + '</div><div class="bar enemy"><span id="ehp" style="width:' + (b.enemyHp / b.enemyMaxHp * 100) + '%"></span><label id="ehp-label">HP ' + b.enemyHp + '/' + b.enemyMaxHp + '</label></div><div class="muted small">ラウンド ' + b.round + '（想定' + b.minRounds + '）</div></div><div class="enemy-sprite" id="enemy-sprite">' + spriteHtml(b.enemy.sprite, 6) + '</div></div>' +
      '<div class="win scenario-title">場面：<b>？？？</b> <span class="muted small">チャートを分析して行動を選ぼう</span></div>' +
      chartBlock() +
      '<div class="battle-bottom"><div class="player-info win"><div class="player-sprite" id="player-sprite">' + spriteHtml(hero.sprite, 4) + '</div><div><b>' + esc(s.player.name) + '</b> Lv.' + s.player.level + '<div id="pbars">' + playerBars() + '</div></div></div>' +
      '<div class="commands win" id="commands">' +
      '<button class="cmd buy" data-cmd="buy">買い</button><button class="cmd sell" data-cmd="sell">売り</button><button class="cmd skip" data-cmd="skip">見送り</button>' +
      '<button class="cmd" data-cmd="higher">上位足を確認</button><button class="cmd" data-cmd="ind">インジケーター確認</button><button class="cmd" data-cmd="order">損切り・利確設定</button>' +
      '<button class="cmd" data-cmd="hint">ヒント（MP' + Math.max(0, CONFIG.battle.hintMpCost - (Game.totalStats().effects.hintDiscount || 0)) + '）</button><button class="cmd" data-cmd="item">アイテム</button><button class="cmd run" data-cmd="run">撤退</button></div></div>' +
      '<div class="win msg" id="bmsg">' + esc(b.enemy.name) + 'はチャートを突きつけてきた。今は' + esc(tfLabel(cur.tf)) + '。上位足の確認から始めよう。</div></div>', 'battle');
    drawSprites();
    var ctl = bindChart(cur.scn, [], {});
    ctl.onTf = function (tf) { if (tf === '4h' || tf === '1d' || tf === '1h') { if (!cur.checkedHigherTF) { cur.checkedHigherTF = true; msg('上位足を確認した。' + describeTF(ctl.scn.states[tf], tf).slice(1, 3).join(' ')); } } };
    function msg(t) { var m = document.getElementById('bmsg'); if (m) m.textContent = t; }
    $screen.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-cmd]'); if (!btn || btn.classList.contains('disabled')) return; var c = btn.getAttribute('data-cmd'); Sound.play('select');
      if (c === 'buy' || c === 'sell' || c === 'order') openOrderPanel(c === 'order' ? 'buy' : c);
      if (c === 'skip') resolveDecision({ action: 'skip' });
      if (c === 'higher') { cur.checkedHigherTF = true; UI.chartState.tf = '4h'; ctl.render(); var st = cur.scn.states; msg('上位足を確認した。' + describeTF(st['1d'], '1d').slice(1, 2).join('') + ' ／ ' + describeTF(st['4h'], '4h').slice(1, 3).join(' ')); }
      if (c === 'ind') { cur.checkedIndicators = true; var an = ctl.render(); showIndicatorPanel(an, UI.chartState.tf); }
      if (c === 'hint') { var h = Game.useHint(); if (!h.ok) { toast(h.msg); return; } refreshBars(); modal('<h3>ヒント</h3><p>' + esc(h.msg) + '</p><p class="muted small">MPを' + h.cost + '消費した。</p><button class="btn gold" data-close="1">閉じる</button>'); }
      if (c === 'item') showItemPanel();
      if (c === 'run') { if (confirm('撤退しますか？（この戦闘の勝利にはなりません。学習記録は残ります）')) { Game.finishBattle(false); backFromBattle(); } }
    });
    UI.onUseItem = function (id) { var r = Game.useItem(id); toast(r.msg); refreshBars(); };
    function refreshBars() { var pb = document.getElementById('pbars'); if (pb) pb.innerHTML = playerBars(); var eh = document.getElementById('ehp'); if (eh) { eh.style.width = (b.enemyHp / b.enemyMaxHp * 100) + '%'; document.getElementById('ehp-label').textContent = 'HP ' + Math.max(0, b.enemyHp) + '/' + b.enemyMaxHp; } }

    function showIndicatorPanel(an, tfId) {
      modal('<h3>インジケーター確認</h3><div class="ind-list">' + describeTF(an, tfId).map(esc).join('<br>') + '</div><p class="muted small">※表示チャートと同じ計算結果。未確定のピボットは含まない。</p><button class="btn gold" data-close="1">閉じる</button>');
    }
    function showItemPanel() {
      var inv = s.inventory; var list = Object.keys(inv).filter(function (k) { return DATA.items[k] && DATA.items[k].type === 'consumable'; });
      modal('<h3>アイテム</h3>' + (list.length ? list.map(function (k) { return '<button class="btn wide" data-use="' + k + '">' + esc(DATA.items[k].name) + ' ×' + inv[k] + '<span class="muted small"> ' + esc(DATA.items[k].desc) + '</span></button>'; }).join('') : '<p class="muted">使えるアイテムがない</p>') + '<button class="btn" data-close="1">閉じる</button>');
    }

    /* --- 注文パネル --- */
    function openOrderPanel(action) {
      var sug = Battle.suggestLevels(cur.scn, action);
      var riskOpts = CONFIG.risk.riskOptions.map(function (r) { return '<option value="' + r + '" ' + (r === s.settings.riskPercent ? 'selected' : '') + '>' + r + '%' + (r > CONFIG.risk.maxSafeRiskPercent ? '（過大）' : '') + '</option>'; }).join('');
      var m = modal('<h3>注文設定</h3><div class="dir-toggle"><button class="btn ' + (action === 'buy' ? 'buy on' : '') + '" data-dir="buy">買い</button><button class="btn ' + (action === 'sell' ? 'sell on' : '') + '" data-dir="sell">売り</button></div>' +
        '<div class="order-grid"><label>エントリー価格<input type="text" id="o-entry" value="' + sug.entry.toFixed(3) + '" readonly></label>' +
        '<label>損切り価格<input type="number" step="0.001" id="o-sl" value="' + (sug.sl !== null ? sug.sl.toFixed(3) : '') + '"></label>' +
        '<label>利確価格<input type="number" step="0.001" id="o-tp" value="' + (sug.tp !== null ? sug.tp.toFixed(3) : '') + '"></label>' +
        '<label>1トレードのリスク<select id="o-risk">' + riskOpts + '</select></label></div>' +
        '<div class="row small"><button class="btn mini2" data-sug="swing">直近スイングの外側に損切り＋RR1:2</button><button class="btn mini2" data-sug="nosl">損切りなし（非推奨）</button></div>' +
        '<div id="o-calc" class="calc"></div>' +
        '<div class="row"><button class="btn gold" id="o-confirm">エントリー確定</button><button class="btn" data-close="1">キャンセル</button></div>' +
        '<p class="muted small">価格はチャート右の目盛と同じ値。損切りは直近スイング高値・安値の少し外側が教材上の目安（1pip = 0.01）。</p>', 'order');
      var dir = action;
      function recalc() {
        var entry = sug.entry; var sl = parseFloat(m.querySelector('#o-sl').value), tp = parseFloat(m.querySelector('#o-tp').value); var rp = parseFloat(m.querySelector('#o-risk').value);
        var riskPips = isNaN(sl) ? 0 : (dir === 'buy' ? entry - sl : sl - entry) / CONFIG.market.pip;
        var rewardPips = isNaN(tp) ? 0 : (dir === 'buy' ? tp - entry : entry - tp) / CONFIG.market.pip;
        var rr = riskPips > 0 ? rewardPips / riskPips : 0; var lot = Battle.lotFor(s.capital, rp, riskPips);
        m.querySelector('#o-calc').innerHTML = '損切り幅 <b>' + (riskPips > 0 ? riskPips.toFixed(0) : '―') + 'pips</b> ／ 利確幅 <b>' + (rewardPips > 0 ? rewardPips.toFixed(0) : '―') + 'pips</b> ／ リスクリワード <b>' + (rr > 0 ? '1 : ' + rr.toFixed(2) : '―') + '</b><br>想定ロット <b>' + (riskPips > 0 ? lot + '万通貨' : '―') + '</b> ／ 許容損失 <b>' + yen(s.capital * rp / 100) + '</b>（資金' + yen(s.capital) + 'の' + rp + '%）';
        chartCtl.opts = { sl: isNaN(sl) ? null : sl, tp: isNaN(tp) ? null : tp, entry: entry }; chartCtl.render();
      }
      m.addEventListener('input', recalc); m.addEventListener('change', recalc);
      m.addEventListener('click', function (e) {
        var t = e.target;
        if (t.getAttribute('data-dir')) { dir = t.getAttribute('data-dir'); sug = Battle.suggestLevels(cur.scn, dir); m.querySelectorAll('[data-dir]').forEach(function (x) { x.classList.toggle('on', x === t); x.classList.toggle('buy', x.getAttribute('data-dir') === 'buy' && x === t); x.classList.toggle('sell', x.getAttribute('data-dir') === 'sell' && x === t); }); m.querySelector('#o-sl').value = sug.sl.toFixed(3); m.querySelector('#o-tp').value = sug.tp.toFixed(3); recalc(); }
        if (t.getAttribute('data-sug') === 'swing') { m.querySelector('#o-sl').value = sug.sl.toFixed(3); m.querySelector('#o-tp').value = sug.tp.toFixed(3); recalc(); }
        if (t.getAttribute('data-sug') === 'nosl') { m.querySelector('#o-sl').value = ''; recalc(); }
        if (t.id === 'o-confirm') {
          var sl = parseFloat(m.querySelector('#o-sl').value), tp = parseFloat(m.querySelector('#o-tp').value), rp = parseFloat(m.querySelector('#o-risk').value);
          if (isNaN(sl) && !confirm('損切りなしでエントリーしますか？（教材では損切り必須です）')) return;
          closeModal(m);
          resolveDecision({ action: dir, sl: isNaN(sl) ? null : sl, tp: isNaN(tp) ? null : tp, riskPercent: rp });
        }
        if (t.getAttribute('data-close')) { chartCtl.opts = {}; chartCtl.render(); }
      });
      recalc();
    }

    /* --- 判断の確定 → 演出 → 値動き再生 → 結果 --- */
    function resolveDecision(decision) {
      var res = Game.resolve(decision);
      var ev = res.ev, sim = res.sim;
      document.getElementById('commands').classList.add('locked');
      // スキル演出
      var skillEl = el('<div class="skill-banner ' + ev.skill.effect + '">' + esc(ev.skill.name) + '</div>'); $screen.appendChild(skillEl);
      var es = document.getElementById('enemy-sprite'), ps = document.getElementById('player-sprite');
      if (ev.skill.effect === 'strike') { Sound.play('attack'); es.classList.add('shake'); ps.classList.add('lunge'); }
      else if (ev.skill.effect === 'guard') { Sound.play('guard'); ps.classList.add('glow'); }
      else { Sound.play('hit'); ps.classList.add('shake'); }
      setTimeout(function () { skillEl.remove(); es.classList.remove('shake'); ps.classList.remove('lunge', 'glow', 'shake'); }, 900);
      msg(ev.skill.name + '！ ' + (ev.trade ? 'エントリー確定。その後の値動きを進める……' : '見送りを選択。その後の値動きを確認する……'));
      // 値動き再生（focusTFの未来足を5分足単位で公開）
      var tf = CONFIG.timeframes.filter(function (t) { return t.id === cur.tf; })[0];
      UI.chartState.tf = cur.tf;
      chartCtl.opts = ev.trade ? { sl: ev.trade.sl, tp: ev.trade.tp, entry: ev.trade.entry } : {};
      var totalFocusBars = sim ? sim.bars : 32; var shown = 0;
      var timer = setInterval(function () {
        shown++;
        chartCtl.revealedBase = cur.scn.future.slice(0, shown * tf.factor);
        chartCtl.render();
        if (shown >= totalFocusBars) { clearInterval(timer); setTimeout(function () { showResult(res); }, 400); }
      }, Game.state.settings.textSpeed === 'instant' ? 25 : 90);
    }

    function showResult(res) {
      var ev = res.ev, sim = res.sim;
      // ダメージ表示
      var dmgEl = el('<div class="dmg-pop enemy">' + (res.enemyDmg > 0 ? '-' + res.enemyDmg : 'MISS') + '</div>'); document.getElementById('enemy-sprite').appendChild(dmgEl);
      if (res.playerDmg > 0) { var pd = el('<div class="dmg-pop player">-' + res.playerDmg + '</div>'); document.getElementById('player-sprite').appendChild(pd); }
      if (res.shield) { var sh = el('<div class="dmg-pop shield">損切りシールド！</div>'); document.getElementById('player-sprite').appendChild(sh); }
      refreshBars();
      var items = ev.items.map(function (it) { return '<li class="' + (it.ok ? 'ok' : 'ng') + '"><span class="mark">' + (it.ok ? '✓' : '✗') + '</span><b>' + esc(it.name) + '</b>：' + esc(it.note) + '</li>'; }).join('');
      var outcome = '';
      if (ev.trade && sim) {
        var o = { tp: '利確に到達', sl: '損切りに到達', time: '時間切れで決済（期間内に決着せず）' }[sim.outcome];
        outcome = '<div class="outcome ' + (sim.pips >= 0 ? 'win' : 'lose') + '"><b>その後の値動き：' + o + '</b>　' + (sim.pips >= 0 ? '+' : '') + sim.pips.toFixed(0) + 'pips（' + sim.bars + '本後）　損益 ' + (res.pnl >= 0 ? '+' : '') + yen(res.pnl) + (sim.ambiguous ? '<br><span class="warn">※同じ足で利確と損切りの両方に到達したため、約定順序を確定できず保守的に損切り扱いにした</span>' : '') +
          (sim.worstPips !== undefined ? '<br><span class="warn">※損切りなしのため最大含み損は ' + sim.worstPips.toFixed(0) + 'pips に達した</span>' : '') +
          '<br><span class="muted small">' + (ev.actionOk && sim.pips < 0 ? '正しい判断でも損切りになることはある。評価されるのは判断の過程。' : (!ev.actionOk && sim.pips >= 0 ? '結果は利益でも、判断の過程に問題がある。繰り返すと資金を失う。' : '過程と結果が一致した。この判断を繰り返そう。')) + '</span></div>';
      } else if (!ev.trade) {
        outcome = '<div class="outcome"><b>その後の値動き</b>：チャートで確認（' + (ev.actionOk ? '見送りが適切な場面だった' : '根拠が揃った場面だった') + '）</div>';
      }
      var achv = (res.newAchievements || []).map(function (a) { return '<div class="achv-pop">称号獲得：' + esc(a.name) + '</div>'; }).join('');
      var nextLabel = res.outcome === 'win' ? '勝利！' : res.outcome === 'lose' ? '……' : '次のラウンドへ';
      var m = modal('<div class="result-head"><div class="score">' + ev.score + '<span>点</span></div><div><div class="muted small">この場面：' + esc(cur.scn.def.title) + '</div><div>あなたの判断：<b>' + esc(ev.chosenLabel) + '</b>　適切な判断：<b class="gold-text">' + esc(ev.correctLabel) + '</b></div></div></div>' +
        '<ul class="eval">' + items + '</ul>' + (ev.violations.length ? '<div class="violations">ルール違反：' + ev.violations.map(esc).join('、') + '</div>' : '') + outcome +
        '<div class="gain">経験値 +' + res.exp + (res.levels ? '　<span class="gold-text">レベルアップ！（Lv.' + Game.state.player.level + '）</span>' : '') + '</div>' + achv +
        '<div class="row"><button class="btn gold" id="r-next">' + nextLabel + '</button></div>', 'result');
      if (res.levels) Sound.play('levelup');
      m.querySelector('#r-next').onclick = function () {
        closeModal(m);
        if (res.outcome === 'win') UI.victory();
        else if (res.outcome === 'lose') UI.defeat();
        else { Game.nextRound(); UI.battle(); }
      };
    }
  };

  function tfLabel(id) { return CONFIG.timeframes.filter(function (t) { return t.id === id; })[0].label; }

  function backFromBattle() {
    var b = Game.battle; $overlay.innerHTML = '';
    if (b.kind === 'dungeon') UI.dungeon(); else UI.chapter(b.chapterId);
  }

  UI.victory = function () {
    var b = Game.battle, s = Game.state; Sound.play('win');
    var ch = b.chapterId ? Game.chapter(b.chapterId) : null;
    var reward = (b.kind === 'boss' && ch.boss.reward) ? '<p class="gold-text">「' + esc(DATA.items[ch.boss.reward.item].name) + '」を手に入れた！</p>' : '';
    var extra = '';
    if (b.kind === 'boss') extra = '<p>' + esc(ch.boss.defeat) + '</p><p class="gold-text">第' + ch.id + '章クリア！ クエスト「' + esc(ch.quest.title) + '」達成（経験値+' + ch.quest.rewardExp + '）</p>';
    if (b.kind === 'dungeon') extra = '<p>' + b.floor + '階を突破した！</p>';
    show('<div class="panel win victory"><h2>勝利！</h2>' + spriteHtml(b.enemy.sprite, 5, 'defeated') + '<p>' + esc(b.enemy.name) + 'を倒した！</p>' + extra + reward +
      '<p class="muted small">判断の質：平均' + Battle.summarizeStats(s.stats).learningScore.toFixed(0) + '点　ランク：' + esc(Game.rank()) + '</p>' +
      '<div class="row">' + (b.kind === 'dungeon' ? '<button class="btn gold" data-act="nextfloor">次の階へ</button><button class="btn" data-act="back">ダンジョンを出る</button>' : (s.progress.ending && b.kind === 'boss' && ch.id === 8 ? '<button class="btn gold" data-act="ending">エンディングへ</button>' : '<button class="btn gold" data-act="back">町へ戻る</button>')) + '</div></div>', 'victory');
    drawSprites();
    $screen.onclick = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-act'); if (!a) return; Sound.play('select');
      if (a === 'back') backFromBattle();
      if (a === 'nextfloor') UI.battleIntro('dungeon', null, b.floor + 1);
      if (a === 'ending') UI.ending();
    };
  };

  UI.defeat = function () {
    var b = Game.battle; Sound.play('lose');
    show('<div class="panel win defeat"><h2>力尽きた……</h2><p>' + esc(b.enemy.name) + 'に押し切られた。だが学びは残る。</p><p class="muted">HPを半分回復して町に戻る。進行状況は失われない。ヒントを使い、上位足とインジケーターを確認してから判断しよう。</p><div class="row"><button class="btn gold" data-act="back">戻る</button></div></div>', 'defeat');
    $screen.onclick = function (e) { if (e.target.getAttribute('data-act') === 'back') backFromBattle(); };
  };

  /* ========================================================
     エンディング
     ======================================================== */
  UI.ending = function () {
    var hero = Game.character(Game.state.player.charId) || DATA.characters[0];
    show('<div class="ending"><div class="stars"></div><div class="ending-text">' + DATA.ending.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div>' + spriteHtml(hero.sprite, 6) + '<div class="row"><button class="btn gold" data-act="map">ワールドマップへ</button></div></div>', 'ending');
    drawSprites();
    $screen.onclick = function (e) { if (e.target.getAttribute('data-act') === 'map') UI.worldmap(); };
  };

  /* ========================================================
     エンドレスダンジョン
     ======================================================== */
  UI.dungeon = function () {
    var s = Game.state;
    show('<div class="panel win dungeon"><h2>エンドレスダンジョン</h2><p>異なる相場環境のシナリオが次々に出題される。階が進むほど敵のHPが増える。最高到達：<b>' + s.progress.dungeonBest + '階</b></p>' +
      '<p class="muted small">出題はすべて検証済みの学習シナリオ（同じ構造のデータを別の乱数で生成）。ランダムな値動きから根拠なく正解を作ることはない。</p>' +
      playerBars() + '<div class="row"><button class="btn gold" data-act="start">1階から挑む</button>' + (s.progress.dungeonBest > 0 ? '<button class="btn" data-act="continue">' + (s.progress.dungeonBest + 1) + '階から挑む</button>' : '') + '<button class="btn" data-act="map">ワールドマップへ</button></div></div>', 'dungeon');
    $screen.onclick = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-act'); if (!a) return; Sound.play('select');
      if (a === 'start') UI.battleIntro('dungeon', null, 1);
      if (a === 'continue') UI.battleIntro('dungeon', null, s.progress.dungeonBest + 1);
      if (a === 'map') UI.worldmap();
    };
  };

  /* ========================================================
     ステータス / アイテム / 実績 / 成績 / 辞典 / 設定 / データ管理
     ======================================================== */
  function backBtn() { return '<div class="row"><button class="btn" data-act="map">ワールドマップへ</button></div>'; }
  function bindBack() { $screen.onclick = function (e) { if (e.target.getAttribute && e.target.getAttribute('data-act') === 'map') UI.worldmap(); }; }

  UI.status = function () {
    var s = Game.state, p = s.player, t = Game.totalStats(), hero = Game.character(p.charId) || DATA.characters[0];
    var eq = Object.keys(s.equipment).map(function (slot) { var id = s.equipment[slot]; return '<div>' + { weapon: '武器', head: '頭', shield: '盾', accessory: '装飾' }[slot] + '：' + (id ? esc(DATA.items[id].name) : '―') + '</div>'; }).join('');
    show('<div class="panel win status"><h2>ステータス</h2><div class="status-head">' + spriteHtml(hero.sprite, 6) + '<div><div class="big">' + esc(p.name) + '</div><div>' + esc(hero.name) + '　Lv.' + p.level + '</div><div class="muted">経験値 ' + p.exp + ' / ' + Game.expToNext(p.level) + '</div><div class="gold-text">' + esc(Game.rank()) + '</div></div></div>' + playerBars() +
      '<div class="stat-grid"><div>分析力<b>' + t.analysis + '</b></div><div>判断力<b>' + t.judgment + '</b></div><div>忍耐力<b>' + t.patience + '</b></div><div>資金管理力<b>' + t.money + '</b></div></div>' +
      '<div class="muted small">仮想資金：' + yen(s.capital) + '</div><h3>装備</h3>' + eq + backBtn() + '</div>', 'status');
    drawSprites(); bindBack();
  };

  UI.items = function () {
    var s = Game.state; var inv = s.inventory;
    var list = Object.keys(inv).map(function (k) { var it = DATA.items[k]; if (!it) return ''; var equipped = it.type === 'equip' && s.equipment[it.slot] === k;
      return '<div class="item-row"><div><b>' + esc(it.name) + '</b> ×' + inv[k] + (equipped ? ' <span class="chk">装備中</span>' : '') + '<div class="muted small">' + esc(it.desc) + '</div></div>' + (it.type === 'equip' ? '<button class="btn mini2" data-eq="' + k + '">' + (equipped ? '外す' : '装備') + '</button>' : '<button class="btn mini2" data-use="' + k + '">使う</button>') + '</div>'; }).join('');
    show('<div class="panel win"><h2>アイテム・装備</h2><p class="muted small">装備は補助能力（被ダメージ軽減など）に影響するが、チャートの正解判定は変えない。</p>' + (list || '<p class="muted">何も持っていない</p>') + playerBars() + backBtn() + '</div>', 'items');
    $screen.onclick = function (e) {
      var t = e.target; if (t.getAttribute('data-act') === 'map') UI.worldmap();
      if (t.getAttribute('data-eq')) { Game.equip(t.getAttribute('data-eq')); Sound.play('select'); UI.items(); }
      if (t.getAttribute('data-use')) { var r = Game.useItem(t.getAttribute('data-use')); toast(r.msg); UI.items(); }
    };
  };

  UI.achievements = function () {
    var got = Game.state.achievements;
    show('<div class="panel win"><h2>実績・称号</h2>' + DATA.achievements.map(function (a) { var ok = got.indexOf(a.id) >= 0; return '<div class="achv ' + (ok ? 'got' : '') + '"><b>' + (ok ? '★ ' : '☆ ') + esc(a.name) + '</b><div class="muted small">' + esc(a.desc) + '</div></div>'; }).join('') + backBtn() + '</div>', 'achv');
    bindBack();
  };

  UI.stats = function () {
    var st = Game.state.stats; var sm = Battle.summarizeStats(st);
    var rows = [['トレード回数', sm.trades], ['勝率', sm.winRate.toFixed(0) + '%'], ['平均利益', yen(sm.avgProfit)], ['平均損失', yen(sm.avgLoss)], ['平均リスクリワード', sm.avgRR ? '1 : ' + sm.avgRR.toFixed(2) : '―'], ['最大ドローダウン', sm.maxDrawdown.toFixed(1) + '%'], ['見送り判断回数', sm.skips + '（正しい見送り ' + sm.correctSkips + '）'], ['ルール違反回数', sm.violations], ['学習スコア（判断の平均点）', sm.learningScore.toFixed(1)], ['仮想資金', yen(Game.state.capital)], ['総合トレーダーランク', Game.rank()]];
    var bySc = Object.keys(st.byScenario).map(function (id) { var d = Scenarios.get(id); var r = st.byScenario[id]; return '<tr><td>' + esc(d ? d.title : id) + '</td><td>' + r.correct + '/' + r.plays + '</td></tr>'; }).join('');
    show('<div class="panel win"><h2>トレード成績</h2><table class="tbl">' + rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td><b>' + esc(r[1]) + '</b></td></tr>'; }).join('') + '</table>' +
      '<p class="muted small">ランクは利益額ではなく判断の質（学習スコア・ルール違反の少なさ・判断回数）で決まる。勝率などの数値は学習上の記録であり、実際の収益を保証しない。</p>' +
      (bySc ? '<h3>場面別の正答</h3><table class="tbl">' + bySc + '</table>' : '') + backBtn() + '</div>', 'stats');
    bindBack();
  };

  UI.glossary = function () {
    show('<div class="panel win"><h2>用語辞典</h2>' + DATA.glossary.map(function (g) { return '<div class="gl"><b>' + esc(g.term) + '</b><div class="muted small">' + esc(g.desc) + '</div></div>'; }).join('') + backBtn() + '</div>', 'glossary');
    bindBack();
  };

  UI.settings = function () {
    var st = Game.state.settings;
    show('<div class="panel win"><h2>設定</h2>' +
      '<label class="row">効果音 <input type="checkbox" id="s-sound" ' + (st.sound ? 'checked' : '') + '> <span class="muted small">（自作の簡易音。初期状態はOFF）</span></label>' +
      '<label class="row">文字速度 <select id="s-speed"><option value="normal" ' + (st.textSpeed === 'normal' ? 'selected' : '') + '>ふつう</option><option value="fast" ' + (st.textSpeed === 'fast' ? 'selected' : '') + '>はやい</option><option value="instant" ' + (st.textSpeed === 'instant' ? 'selected' : '') + '>一瞬</option></select></label>' +
      '<label class="row">1トレードの初期リスク <select id="s-risk">' + CONFIG.risk.riskOptions.map(function (r) { return '<option value="' + r + '" ' + (r === st.riskPercent ? 'selected' : '') + '>' + r + '%</option>'; }).join('') + '</select> <span class="muted small">（教材では仮に1%）</span></label>' +
      '<label class="row">ZigZag表示 <input type="checkbox" id="s-zig" ' + (st.showZigzag ? 'checked' : '') + '></label>' +
      '<div class="row"><button class="btn" data-act="data">データ管理</button><button class="btn" data-act="map">ワールドマップへ</button></div></div>', 'settings');
    $screen.onchange = function () {
      st.sound = document.getElementById('s-sound').checked; st.textSpeed = document.getElementById('s-speed').value;
      st.riskPercent = parseFloat(document.getElementById('s-risk').value); st.showZigzag = document.getElementById('s-zig').checked; Game.save(); toast('設定を保存した');
    };
    $screen.onclick = function (e) { var a = e.target.getAttribute && e.target.getAttribute('data-act'); if (a === 'map') UI.worldmap(); if (a === 'data') UI.dataManagement(false); };
  };

  UI.dataManagement = function (fromTitle) {
    var has = Game.hasSave();
    show('<div class="panel win"><h2>データ管理</h2><p class="muted small">セーブデータはこのブラウザのLocalStorageに自動保存されます。ブラウザの保存データを削除したり、別の端末・ブラウザで開くと進行状況は引き継がれません。大切なデータはJSONで書き出して保管してください。</p>' +
      '<div class="row"><button class="btn" data-act="export" ' + (has ? '' : 'disabled') + '>JSONを書き出す</button><label class="btn file">JSONを読み込む<input type="file" id="imp" accept=".json,application/json" hidden></label></div>' +
      '<div class="row"><button class="btn danger" data-act="reset" ' + (has ? '' : 'disabled') + '>セーブデータを初期化</button></div>' +
      '<div class="row"><button class="btn" data-act="back">戻る</button></div></div>', 'data');
    $screen.onclick = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-act'); if (!a) return;
      if (a === 'export') { var st = Save.load(); var blob = new Blob([Save.exportJSON(st)], { type: 'application/json' }); var u = URL.createObjectURL(blob); var link = document.createElement('a'); link.href = u; link.download = 'mochipoyo-trade-quest-save.json'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); }
      if (a === 'reset') { if (confirm('本当に初期化しますか？ この操作は元に戻せません。')) { Save.reset(); Game.state = null; toast('初期化した'); UI.title(); } }
      if (a === 'back') { if (fromTitle || !Game.state) UI.title(); else UI.settings(); }
    };
    document.getElementById('imp').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return; var rd = new FileReader();
      rd.onload = function () { try { var st = Save.importJSON(rd.result); Save.save(st); Game.state = st; toast('読み込んだ'); UI.worldmap(); } catch (err) { alert('読み込みに失敗：' + err.message); } };
      rd.readAsText(f);
    };
  };

  /* ========================================================
     起動
     ======================================================== */
  UI.boot = function () {
    $screen = document.getElementById('screen'); $overlay = document.getElementById('overlay'); $toast = document.getElementById('toast');
    // 共通のモーダル閉じる処理
    $overlay.addEventListener('click', function (e) {
      var t = e.target;
      if (t.getAttribute && t.getAttribute('data-close')) closeModal(t.closest('.modal-backdrop'));
      if (t.getAttribute && t.getAttribute('data-use')) { if (UI.onUseItem) UI.onUseItem(t.getAttribute('data-use')); closeModal(t.closest('.modal-backdrop')); }
    });
    Game.init();
    UI.title();
  };

  root.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);
