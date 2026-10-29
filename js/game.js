/* =========================================================
   もちぽよFXクエスト - ゲーム状態管理・進行ロジック
   DOMには触れない（描画は ui.js）。
   ========================================================= */
(function (root) {
  'use strict';

  var CONFIG = root.CONFIG, DATA = root.DATA, Scenarios = root.Scenarios, Battle = root.Battle, Save = root.Save;

  var Game = { state: null, battle: null, listeners: [] };

  Game.STEPS = ['npc', 'lesson', 'example', 'quiz', 'monster', 'boss', 'review'];

  /* ---------- 初期化・セーブ ---------- */
  Game.init = function () {
    Game.state = Save.load();
    return !!Game.state;
  };
  Game.newGame = function (charId, name) {
    var s = Save.defaultState();
    var ch = Game.character(charId) || DATA.characters[0];
    s.player.charId = ch.id;
    s.player.name = name || ch.name;
    s.player.analysis += ch.bonus.analysis; s.player.judgment += ch.bonus.judgment;
    s.player.patience += ch.bonus.patience; s.player.money += ch.bonus.money;
    s.player.hp = Game.maxHp(s); s.player.mp = Game.maxMp(s);
    Game.state = s;
    Game.save();
    return s;
  };
  Game.save = function () { if (Game.state) Save.save(Game.state); };
  Game.hasSave = function () { return !!Save.load(); };
  Game.character = function (id) { for (var i = 0; i < DATA.characters.length; i++) if (DATA.characters[i].id === id) return DATA.characters[i]; return null; };
  Game.chapter = function (id) { for (var i = 0; i < DATA.chapters.length; i++) if (DATA.chapters[i].id === id) return DATA.chapters[i]; return null; };

  /* ---------- 成長 ---------- */
  Game.maxHp = function (s) { s = s || Game.state; return CONFIG.battle.playerBaseHp + (s.player.level - 1) * 10; };
  Game.maxMp = function (s) { s = s || Game.state; return CONFIG.battle.playerBaseMp + (s.player.level - 1) * 3; };
  Game.expToNext = function (level) { return Math.round(CONFIG.battle.expLevelBase * level * (1 + level * 0.15)); };

  Game.addExp = function (amount) {
    var p = Game.state.player; var levelsGained = 0;
    p.exp += Math.round(amount);
    while (p.exp >= Game.expToNext(p.level)) {
      p.exp -= Game.expToNext(p.level); p.level += 1; levelsGained += 1;
      var ch = Game.character(p.charId) || DATA.characters[0];
      // 得意分野に沿って成長
      p.analysis += ch.bonus.analysis >= 3 ? 2 : 1; p.judgment += ch.bonus.judgment >= 3 ? 2 : 1;
      p.patience += ch.bonus.patience >= 3 ? 2 : 1; p.money += ch.bonus.money >= 3 ? 2 : 1;
      p.hp = Game.maxHp(); p.mp = Game.maxMp();
    }
    return levelsGained;
  };

  // 装備込みのステータス
  Game.totalStats = function () {
    var p = Game.state.player; var t = { analysis: p.analysis, judgment: p.judgment, patience: p.patience, money: p.money };
    var eff = { hintDiscount: 0, attackBonus: 0, damageCut: 0 };
    Object.keys(Game.state.equipment).forEach(function (slot) {
      var id = Game.state.equipment[slot]; if (!id || !DATA.items[id]) return;
      var it = DATA.items[id];
      if (it.stats) Object.keys(it.stats).forEach(function (k) { t[k] += it.stats[k]; });
      if (it.effect) Object.keys(it.effect).forEach(function (k) { eff[k] = (eff[k] || 0) + it.effect[k]; });
    });
    t.effects = eff;
    return t;
  };

  /* ---------- 章の進行 ---------- */
  Game.stepDone = function (chId, step) { var cs = Game.state.progress.chapterSteps[chId]; return !!(cs && cs[step]); };
  Game.markStep = function (chId, step) {
    var cs = Game.state.progress.chapterSteps[chId] || (Game.state.progress.chapterSteps[chId] = {});
    cs[step] = true; Game.save();
  };
  Game.monstersDone = function (chId) {
    var ch = Game.chapter(chId); var cs = Game.state.progress.chapterSteps[chId] || {};
    for (var i = 0; i < ch.monsters.length; i++) if (!cs['monster' + i]) return false;
    return true;
  };
  Game.isUnlocked = function (chId) { return Game.state.progress.unlockedChapters.indexOf(chId) >= 0; };
  Game.isCleared = function (chId) { return Game.state.progress.clearedChapters.indexOf(chId) >= 0; };
  Game.clearChapter = function (chId) {
    var pr = Game.state.progress;
    if (pr.clearedChapters.indexOf(chId) < 0) pr.clearedChapters.push(chId);
    var next = chId + 1;
    if (Game.chapter(next) && pr.unlockedChapters.indexOf(next) < 0) pr.unlockedChapters.push(next);
    if (chId === DATA.chapters[DATA.chapters.length - 1].id) pr.ending = true;
    var ch = Game.chapter(chId);
    if (ch.quest && !pr.quests[chId]) { pr.quests[chId] = true; Game.addExp(ch.quest.rewardExp); }
    Game.save();
  };

  /* ---------- アイテム・装備 ---------- */
  Game.addItem = function (id, qty) { var inv = Game.state.inventory; inv[id] = (inv[id] || 0) + (qty || 1); Game.save(); };
  Game.useItem = function (id) {
    var inv = Game.state.inventory, it = DATA.items[id];
    if (!it || !inv[id] || it.type !== 'consumable') return { ok: false, msg: '使えません' };
    var p = Game.state.player; var msg = '';
    if (it.effect.heal) { var before = p.hp; p.hp = Math.min(Game.maxHp(), p.hp + it.effect.heal); msg = 'HPが' + (p.hp - before) + '回復した'; }
    if (it.effect.mp) { var b2 = p.mp; p.mp = Math.min(Game.maxMp(), p.mp + it.effect.mp); msg = 'MPが' + (p.mp - b2) + '回復した'; }
    inv[id] -= 1; if (inv[id] <= 0) delete inv[id];
    Game.save();
    return { ok: true, msg: msg };
  };
  Game.equip = function (id) {
    var it = DATA.items[id]; if (!it || it.type !== 'equip' || !Game.state.inventory[id]) return false;
    var eq = Game.state.equipment;
    if (eq[it.slot] === id) { eq[it.slot] = null; } else { eq[it.slot] = id; }
    Game.save(); return true;
  };

  /* ---------- 実績 ---------- */
  Game.checkAchievements = function () {
    var got = [];
    DATA.achievements.forEach(function (a) {
      if (Game.state.achievements.indexOf(a.id) >= 0) return;
      var ok = false; try { ok = a.cond(Game.state); } catch (e) { ok = false; }
      if (ok) { Game.state.achievements.push(a.id); got.push(a); }
    });
    if (got.length) Game.save();
    return got;
  };

  /* ---------- 戦闘 ---------- */
  // kind: 'monster' | 'boss' | 'dungeon'
  Game.startBattle = function (kind, chapterId, index) {
    var b = { kind: kind, chapterId: chapterId, index: index, round: 0, log: [], finished: false, won: false };
    if (kind === 'dungeon') {
      var floor = index || 1;
      var pool = Scenarios.ids();
      b.enemy = { name: 'ダンジョンの' + ['影', '亡霊', '誘惑', '幻', '欲望', '恐怖'][floor % 6] + '（' + floor + '階）', sprite: ['shadow', 'ghost', 'bat', 'phantom', 'slime', 'lizard', 'beast', 'knight'][floor % 8], hp: 100 + floor * 20, rounds: 1, scenarios: pool, taunt: '判断を見せてみろ……' };
      b.floor = floor; b.seedOffset = floor;
    } else {
      var ch = Game.chapter(chapterId);
      b.enemy = kind === 'boss' ? ch.boss : ch.monsters[index];
      b.seedOffset = 0;
    }
    b.enemyMaxHp = b.enemy.hp; b.enemyHp = b.enemy.hp;
    b.minRounds = b.enemy.rounds; b.totalRounds = b.enemy.rounds + 3; // 想定ラウンド数＋予備（敵HPが残っていれば続く）
    b.scenarioQueue = pickScenarios(b.enemy.scenarios, b.totalRounds, kind === 'dungeon' ? (index * 31) : (Game.state.progress.battlesWon * 7 + (index || 0)));
    Game.battle = b;
    Game.nextRound();
    return b;
  };

  function pickScenarios(pool, count, salt) {
    var arr = pool.slice(); var out = [];
    // 決定的なシャッフル（salt で順番を変える）
    var x = (salt || 0) + 12345;
    function rnd() { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }
    for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    while (out.length < count) { out = out.concat(arr); }
    return out.slice(0, count);
  }

  Game.nextRound = function () {
    var b = Game.battle; if (!b || b.finished) return null;
    b.round += 1;
    var id = b.scenarioQueue[b.round - 1];
    var scn = Scenarios.build(id, b.seedOffset);
    b.current = { scenarioId: id, scn: scn, tf: scn.def.focusTF, checkedHigherTF: false, checkedIndicators: false, usedHint: false,
      sl: null, tp: null, action: null, revealed: [], result: null };
    return b.current;
  };

  Game.useHint = function () {
    var b = Game.battle, p = Game.state.player; var cost = Math.max(0, CONFIG.battle.hintMpCost - (Game.totalStats().effects.hintDiscount || 0));
    if (p.mp < cost) return { ok: false, msg: 'MPが足りない' };
    p.mp -= cost; b.current.usedHint = true; Game.save();
    return { ok: true, msg: b.current.scn.def.hint, cost: cost };
  };

  // 判断を確定し、評価・ダメージ・値動き再生の結果を返す
  Game.resolve = function (decision) {
    var b = Game.battle, cur = b.current, s = Game.state;
    decision.checkedHigherTF = cur.checkedHigherTF; decision.checkedIndicators = cur.checkedIndicators; decision.usedHint = cur.usedHint;
    if (decision.riskPercent === undefined) decision.riskPercent = s.settings.riskPercent;
    var ev = Battle.evaluate(cur.scn, decision);
    ev.scenarioId = cur.scenarioId;
    var sim = null;
    if (ev.trade) sim = Battle.simulate(cur.scn, ev.trade, 96);
    var money = Battle.applyResult(s.stats, s, ev, sim);
    var ts = Game.totalStats();

    // ダメージ計算（演出用。採点＝攻撃力）
    var enemyDmg = Math.round(ev.score * (1 + (ts.effects.attackBonus || 0)) * (ev.score >= 50 ? 1 : 0.4));
    if (b.kind === 'boss') enemyDmg = Math.round(enemyDmg * 0.9);
    var playerDmg = 0;
    if (ev.score < 60) playerDmg = Math.round((60 - ev.score) * 0.7);
    // 敵の攻撃（忍耐力と盾で軽減、評価80以上なら「損切りシールド」で無効化）
    var enemyAttack = CONFIG.battle.enemyAttackBase + (b.chapterId || 1) * 2 + (b.floor || 0) * 2;
    var shield = ev.score >= 80;
    if (!shield) playerDmg += Math.round(enemyAttack * Math.max(0.3, 1 - ts.patience * 0.03));
    playerDmg = Math.round(playerDmg * (1 - Math.min(0.6, ts.effects.damageCut || 0)));
    b.enemyHp = Math.max(0, b.enemyHp - enemyDmg);
    s.player.hp = Math.max(0, s.player.hp - playerDmg);

    // 経験値・ステータス
    var exp = ev.score * CONFIG.battle.expPerScore;
    if (ev.actionOk && decision.action === 'skip') exp += 15;
    if (b.kind === 'boss') exp *= 1.5;
    var levels = Game.addExp(exp);
    if (ev.score > s.progress.bestScore) s.progress.bestScore = ev.score;

    cur.action = decision.action; cur.sl = decision.sl; cur.tp = decision.tp;
    cur.result = { ev: ev, sim: sim, enemyDmg: enemyDmg, playerDmg: playerDmg, shield: shield, exp: Math.round(exp), levels: levels, pnl: money.pnl };
    b.log.push(cur.result);

    var outcome = 'continue';
    if (b.enemyHp <= 0) { outcome = 'win'; Game.finishBattle(true); }
    else if (s.player.hp <= 0) { outcome = 'lose'; Game.finishBattle(false); }
    else if (b.round >= b.totalRounds) {
      // 予備ラウンドも使い切って敵が残っている＝撤退（学習は記録されるが勝利にはならない）
      outcome = 'lose'; Game.finishBattle(false);
    }
    cur.result.outcome = outcome;
    cur.result.newAchievements = Game.checkAchievements();
    Game.save();
    return cur.result;
  };

  Game.finishBattle = function (won) {
    var b = Game.battle, s = Game.state; b.finished = true; b.won = won;
    if (won) {
      s.progress.battlesWon += 1;
      if (b.kind === 'monster') Game.markStep(b.chapterId, 'monster' + b.index);
      if (b.kind === 'boss') {
        Game.markStep(b.chapterId, 'boss');
        var rw = Game.chapter(b.chapterId).boss.reward; if (rw) Game.addItem(rw.item, rw.qty);
        Game.clearChapter(b.chapterId);
      }
      if (b.kind === 'dungeon' && b.floor > s.progress.dungeonBest) s.progress.dungeonBest = b.floor;
    } else {
      // 敗北：HPを半分で復活（進行は失われない）
      s.player.hp = Math.max(1, Math.round(Game.maxHp() / 2));
    }
    Game.save();
  };

  Game.rank = function () { return Battle.rank(Game.state.stats); };

  root.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
