// Bajan Showdown — the gameshow board.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const S = window.ShowSound;
  const SAVE_KEY = "bs-game-v2";
  const SETUP_KEY = "bs-setup-v1";
  const PW_KEY = "bs-teacher-pw";
  const chan = "BroadcastChannel" in window ? new BroadcastChannel("bajan-showdown") : null;

  const MAX_TEAMS = 4;
  const MAX_PLAYERS = 4;
  const TEAM_COLOURS = ["#ffc726", "#5ec8ff", "#ff8a5c", "#7be0a0"];
  const DEFAULT_NAMES = ["Team Trident", "Team Flying Fish", "Team Green Monkey", "Team Pelican"];

  // Practice questions, so the host can try the controls without the password.
  // They're kept separate from the real questions, which stay behind the password.
  const SAMPLE = [
    { slot: 1, question: "Name something students sell at school to make extra money.", answers: [
      { text: "Snacks", points: 30 }, { text: "Sweeties", points: 22 }, { text: "Freeze pops", points: 14 },
      { text: "Tamarind balls", points: 10 }, { text: "Cupcakes", points: 8 }, { text: "Bracelets", points: 6 },
      { text: "Homework answers", points: 4 } ] },
    { slot: 2, question: "Name something you'll find on a Bajan gallery.", answers: [
      { text: "Chairs", points: 30 }, { text: "Potted plants", points: 22 }, { text: "Somebody watching the road", points: 14 },
      { text: "Shoes", points: 10 }, { text: "The dog", points: 8 }, { text: "A broom", points: 5 } ] },
    { slot: 3, question: "Name something that's always broken at school.", answers: [
      { text: "The fan", points: 26 }, { text: "The toilets", points: 22 }, { text: "The printer", points: 16 },
      { text: "The projector", points: 12 }, { text: "The water cooler", points: 10 }, { text: "The bell", points: 6 } ] },
  ];

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const sess = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
    del(k) { try { sessionStorage.removeItem(k); } catch {} },
  };

  let title = "Bajan Showdown";
  let pool = [];       // questions loaded from the server (or samples)
  let isDemo = false;
  let G = null;        // the game in progress
  let history = [];    // undo stack (JSON snapshots)
  let renderedRound = -1;

  // ---------- screens ----------
  function show(id) {
    document.body.dataset.screen = id;
    requestAnimationFrame(() => window.initMarquees && window.initMarquees());
  }

  function setTitle(t) {
    title = t || "Bajan Showdown";
    document.title = title;
    const h = $("#game-title");
    h.textContent = "";
    const words = title.split(" ");
    const first = words.length > 1 ? words.slice(0, Math.ceil(words.length / 2)).join(" ") : title;
    const rest = words.length > 1 ? words.slice(Math.ceil(words.length / 2)).join(" ") : "";
    [first, rest].filter(Boolean).forEach((w) => { const s = document.createElement("span"); s.textContent = w; h.append(s, " "); });
  }

  async function loadTitle() {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      if (r.ok) setTitle((await r.json()).title);
    } catch {}
  }

  // ---------- host sign-in ----------
  const dlg = $("#login");
  function openLogin(msg = "") {
    $("#login-error").textContent = msg;
    if (!dlg.open) dlg.showModal();
    $("#login-pw").focus();
  }
  async function loadGame(pw) {
    const btn = $("#login-go");
    btn.disabled = true;
    try {
      const r = await fetch("/api/game", { headers: { "x-teacher-password": pw }, cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 401) sess.del(PW_KEY);
        return openLogin(j.error || "The questions couldn't be loaded. Check your connection and try again.");
      }
      sess.set(PW_KEY, pw);
      if (!j.questions.length) return openLogin("No questions are switched on for the game. Turn some on in the teacher page first.");
      if (dlg.open) dlg.close();
      setTitle(j.title);
      pool = j.questions;
      isDemo = false;
      openSetup();
    } catch {
      openLogin("The question bank can't be reached. Check your connection, or practise with sample questions.");
    } finally {
      btn.disabled = false;
    }
  }
  $("#host-btn").addEventListener("click", () => {
    S.unlock();
    const pw = sess.get(PW_KEY);
    if (pw) loadGame(pw); else openLogin();
  });
  $("#login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const pw = $("#login-pw").value;
    if (pw) loadGame(pw);
  });
  $("#login-cancel").addEventListener("click", () => dlg.close());
  $("#demo-btn").addEventListener("click", () => {
    if (dlg.open) dlg.close();
    pool = SAMPLE;
    isDemo = true;
    openSetup();
  });

  // ---------- setup ----------
  // The team setup is remembered between games on this computer.
  function loadSetup() {
    const saved = store.get(SETUP_KEY) || {};
    const count = [2, 3, 4].includes(saved.count) ? saved.count : 4;
    const teams = Array.from({ length: MAX_TEAMS }, (_, i) => {
      const t = (saved.teams && saved.teams[i]) || {};
      const size = Number.isInteger(t.size) && t.size >= 1 && t.size <= MAX_PLAYERS ? t.size : MAX_PLAYERS;
      const players = Array.from({ length: MAX_PLAYERS }, (_, k) => String((t.players && t.players[k]) || ""));
      return { name: typeof t.name === "string" ? t.name : DEFAULT_NAMES[i], size, players };
    });
    return { count, teams };
  }
  let setup = loadSetup();
  const saveSetup = () => store.set(SETUP_KEY, setup);

  function el(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => (k in e ? (e[k] = v) : e.setAttribute(k, v)));
    e.append(...kids.filter((k) => k != null));
    return e;
  }

  function renderTeamCards() {
    const box = $("#team-cards");
    box.textContent = "";
    box.dataset.count = setup.count;
    setup.teams.slice(0, setup.count).forEach((t, i) => {
      const name = el("input", { maxLength: 22, value: t.name, placeholder: DEFAULT_NAMES[i], "aria-label": `Team ${i + 1} name` });
      name.addEventListener("input", () => { t.name = name.value; saveSetup(); });

      const size = el("select", { "aria-label": `Players on team ${i + 1}` },
        ...[1, 2, 3, 4].map((n) => el("option", { value: n, textContent: `${n} player${n === 1 ? "" : "s"}` })));
      size.value = String(t.size);

      const players = el("div", { className: "player-inputs" });
      const drawPlayers = () => {
        players.textContent = "";
        for (let k = 0; k < t.size; k++) {
          const p = el("input", { maxLength: 16, value: t.players[k], placeholder: `Player ${k + 1}`, "aria-label": `Team ${i + 1}, player ${k + 1}` });
          p.addEventListener("input", () => { t.players[k] = p.value; saveSetup(); });
          players.append(p);
        }
      };
      size.addEventListener("change", () => { t.size = Number(size.value); saveSetup(); drawPlayers(); });
      drawPlayers();

      box.append(el("fieldset", { className: "team-card", style: `--tc:${TEAM_COLOURS[i]}` },
        el("legend", { className: "visually-hidden" }, `Team ${i + 1}`),
        el("div", { className: "team-card-head" }, el("span", { "aria-hidden": "true" }, `Team ${i + 1}`), size),
        name,
        players));
    });
  }
  $("#team-count").addEventListener("change", (e) => {
    setup.count = Number(e.target.value);
    saveSetup();
    renderTeamCards();
  });

  function openSetup() {
    const n = pool.length;
    $("#setup-count").textContent = isDemo
      ? `${n} sample questions loaded for practice.`
      : `${n} question${n === 1 ? "" : "s"} ready.`;
    const sel = $("#rounds");
    sel.textContent = "";
    const choices = [...new Set([3, 4, 5, 6, 8, 10].filter((x) => x < n).concat(n))];
    choices.forEach((c) => {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c === n ? `All ${n} questions` : `${c} rounds`;
      sel.append(o);
    });
    const preferred = choices.includes(6) ? 6 : n;
    sel.value = String(preferred);
    $("#team-count").value = String(setup.count);
    renderTeamCards();
    show("screen-setup");
  }
  $("#setup-back").addEventListener("click", () => show("screen-title"));

  function defaultMults(n) {
    const m = Array(n).fill(1);
    if (n >= 4) { m[n - 2] = 2; m[n - 1] = 3; } else if (n === 3) m[2] = 2;
    return m;
  }

  $("#setup-form").addEventListener("submit", (e) => {
    e.preventDefault();
    S.unlock();
    let order = pool.map((_, i) => i);
    if ($("#order").value === "shuffle") {
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    }
    order = order.slice(0, Number($("#rounds").value) || pool.length);
    const n = order.length;
    G = {
      v: 2,
      title,
      demo: isDemo,
      questions: order.map((i) => pool[i]),
      teams: setup.teams.slice(0, setup.count).map((t, i) => ({
        name: t.name.trim() || DEFAULT_NAMES[i],
        score: 0,
        players: t.players.slice(0, t.size).map((p, k) => p.trim() || `Player ${k + 1}`),
      })),
      target: Number($("#target").value) || 0,
      round: 0,
      mults: defaultMults(n),
      revealed: [],
      scored: [],
      strikes: 0,
      control: null,  // team playing this round, once the face-off is won
      turn: 0,        // answers that team has given since winning the face-off
      awardedTo: null,
      lastAward: 0,
      showQuestion: true,
      skipArmed: false,
      phase: "play",
    };
    history = [];
    renderedRound = -1;
    shownScore.length = 0;
    save();
    show("screen-board");
    render();
    broadcast();
    S.intro();
  });

  // ---------- game logic ----------
  const cur = () => G.questions[G.round];
  const mult = () => G.mults[G.round] || 1;
  const bankNow = () => (G.awardedTo !== null ? 0 : G.scored.reduce((t, i) => t + (cur().answers[i]?.points || 0), 0) * mult());
  const isLastRound = () => G.round >= G.questions.length - 1;
  const targetReached = () => G.target > 0 && G.teams.some((t) => t.score >= G.target);
  const gameOverNext = () => isLastRound() || targetReached();
  const isTeam = (t) => Number.isInteger(t) && t >= 0 && t < G.teams.length;

  // Where the round is: face-off, a team playing, a steal, or banked.
  function stage() {
    if (G.awardedTo !== null) return "done";
    if (G.control === null) return "faceoff";
    if (G.strikes >= 3) return "steal";
    return "playing";
  }
  // Each round, the next player on every team comes up for the face-off.
  const faceoffIndex = (team) => G.round % team.players.length;
  const faceoffPlayer = (team) => team.players[faceoffIndex(team)];
  // After winning the face-off, the team answers in turn, starting with the
  // player after the one who faced off.
  function upNext() {
    const team = G.teams[G.control];
    return team.players[(faceoffIndex(team) + 1 + G.turn) % team.players.length];
  }

  function save() { if (G) store.set(SAVE_KEY, G); }
  function snapshot() { history.push(JSON.stringify(G)); if (history.length > 80) history.shift(); }

  let transient = "";
  let transientTimer = null;
  function say(msg, ms = 2600) {
    transient = msg;
    clearTimeout(transientTimer);
    transientTimer = setTimeout(() => { transient = ""; renderBanner(); }, ms);
    renderBanner();
  }

  function act(cmd, arg) {
    if (cmd === "undo") {
      const prev = history.pop();
      if (!prev) return say("Nothing to undo");
      const wasEnd = G && G.phase === "end";
      G = JSON.parse(prev);
      if (wasEnd || G.phase === "play") show("screen-board");
      return commit();
    }
    if (!G || G.phase !== "play") return;
    const q = cur();
    switch (cmd) {
      case "reveal": {
        const i = Number(arg);
        if (!(i >= 0 && i < q.answers.length) || G.revealed.includes(i)) return;
        snapshot();
        if (stage() === "playing") G.turn += 1;
        G.revealed.push(i);
        G.skipArmed = false;
        if (G.awardedTo === null) { G.scored.push(i); S.ding(); hit(i); } else S.flip();
        break;
      }
      case "strike": {
        if (G.awardedTo !== null || G.strikes >= 3) return;
        snapshot();
        G.strikes += 1;
        if (G.control !== null && G.strikes < 3) G.turn += 1;
        showXs(G.strikes);
        S.buzz();
        if (G.strikes === 3 && G.control !== null) setTimeout(() => S.steal(), 1000);
        break;
      }
      case "buzz":
        showXs(1);
        S.buzz();
        return;
      case "control": {
        const t = Number(arg);
        if (G.awardedTo !== null || !isTeam(t)) return;
        snapshot();
        G.control = G.control === t ? null : t;
        G.turn = 0;
        break;
      }
      case "award": {
        const t = Number(arg);
        if (G.awardedTo !== null || !isTeam(t)) return;
        const amount = bankNow();
        snapshot();
        G.teams[t].score += amount;
        G.awardedTo = t;
        G.lastAward = amount;
        S.award();
        break;
      }
      case "revealRest": {
        const rest = q.answers.map((_, i) => i).filter((i) => !G.revealed.includes(i));
        if (!rest.length) return;
        snapshot();
        G.revealed.push(...rest);
        stagger(rest);
        break;
      }
      case "mult": {
        const m = Number(arg);
        if (![1, 2, 3].includes(m) || G.awardedTo !== null) return;
        snapshot();
        G.mults[G.round] = m;
        break;
      }
      case "next": {
        if (G.awardedTo === null && bankNow() > 0 && !G.skipArmed) {
          G.skipArmed = true;
          say("The bank hasn't been given out. Press Next again to skip it.", 4000);
          break;
        }
        snapshot();
        if (gameOverNext()) { G.phase = "end"; commit(); return showWinner(); }
        G.round += 1;
        Object.assign(G, { revealed: [], scored: [], strikes: 0, control: null, turn: 0, awardedTo: null, lastAward: 0, skipArmed: false, showQuestion: true });
        S.round();
        break;
      }
      case "finish": {
        snapshot();
        G.phase = "end";
        commit();
        return showWinner();
      }
      case "toggleQuestion":
        G.showQuestion = !G.showQuestion;
        break;
      default:
        return;
    }
    commit();
  }

  function commit() { save(); if (G.phase === "play") render(); broadcast(); }

  // ---------- rendering ----------
  const board = $("#board");
  const tiles = [];
  for (let i = 0; i < 8; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tile";
    b.style.setProperty("--o", i);
    b.innerHTML = '<span class="tile-inner"><span class="face front"><span class="num"></span></span><span class="face back"><span class="ans"></span><span class="pts"></span></span></span>';
    b.addEventListener("click", () => act("reveal", i));
    tiles.push(b);
  }
  // Column order: 1–4 down the left, 5–8 down the right.
  board.append(...tiles);

  // Team boxes go either side of the bank: 2 left and 2 right for four teams.
  let builtTeams = 0;
  function buildTeams() {
    const n = G.teams.length;
    if (builtTeams === n) return;
    builtTeams = n;
    const bar = $("#scorebar");
    const bank = $("#bank-box");
    $$(".team", bar).forEach((e) => e.remove());
    const left = Math.ceil(n / 2);
    G.teams.forEach((_, i) => {
      const box = el("div", { className: "team", id: `team-${i}`, style: `--tc:${TEAM_COLOURS[i]}` },
        el("span", { className: "team-name" }),
        el("span", { className: "team-score" }, "0"),
        el("span", { className: "team-player" }));
      if (i < left) bank.before(box); else bar.append(box);
    });
    bar.style.gridTemplateColumns = `repeat(${left}, minmax(0, 1fr)) auto repeat(${n - left}, minmax(0, 1fr))`;
    bar.dataset.teams = n;

    [["#ctl-group", "control", "btn-blue"], ["#award-group", "award", ""]].forEach(([gid, cmd, cls]) => {
      const g = $(gid);
      $$("button", g).forEach((b) => b.remove());
      G.teams.forEach((_, i) => {
        g.append(el("button", { type: "button", className: `btn btn-small team-btn ${cls}`.trim(), id: `${cmd}-${i}`, style: `--tc:${TEAM_COLOURS[i]}`, "data-cmd": cmd, "data-arg": i }));
      });
    });
  }

  const shownScore = [];
  function tweenScore(el, idx, to) {
    const from = shownScore[idx] ?? to;
    shownScore[idx] = to;
    if (from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 900;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1 && shownScore[idx] === to) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function render() {
    if (!G) return;
    buildTeams();
    const q = cur();
    const n = q.answers.length;
    const st = stage();

    G.teams.forEach((t, i) => {
      const box = $(`#team-${i}`);
      $(".team-name", box).textContent = t.name;
      tweenScore($(".team-score", box), i, t.score);
      let line = "";
      if (st === "faceoff") line = `Face-off: ${faceoffPlayer(t)}`;
      else if (st === "playing" && i === G.control) line = `Up: ${upNext()}`;
      else if (st === "steal" && i !== G.control) line = "Can steal";
      $(".team-player", box).textContent = line || " ";
      box.classList.toggle("has-control", G.control === i && G.awardedTo === null);
      box.classList.toggle("can-steal", st === "steal" && i !== G.control);
      box.classList.toggle("won-round", G.awardedTo === i);
      $(`#control-${i}`).textContent = t.name;
      $(`#control-${i}`).classList.toggle("is-on", G.control === i);
      $(`#award-${i}`).textContent = t.name;
    });

    $("#bank").textContent = bankNow();
    const m = mult();
    $("#mult").hidden = m === 1;
    $("#mult").textContent = m === 2 ? "Double" : "Triple";
    $$("#pips svg").forEach((s, i) => s.classList.toggle("on", i < G.strikes));

    $("#round-label").textContent = `Round ${G.round + 1} of ${G.questions.length}`;
    $("#q-status").textContent =
      st === "faceoff" ? "Face-off" :
      st === "playing" ? `${G.teams[G.control].name} playing` :
      st === "steal" ? "Steal" : "";
    const qt = $("#q-text");
    qt.textContent = q.question;
    qt.classList.toggle("hidden-q", !G.showQuestion);

    const newRound = renderedRound !== G.round;
    if (newRound) board.classList.add("instant");
    tiles.forEach((t, i) => {
      const a = q.answers[i];
      t.classList.toggle("empty", !a);
      t.disabled = !a;
      t.setAttribute("aria-label", a ? (G.revealed.includes(i) ? `${a.text}, ${a.points} points` : `Answer ${i + 1}, hidden`) : "No answer");
      $(".num", t).textContent = a ? i + 1 : "";
      $(".ans", t).textContent = a ? a.text : "";
      $(".pts", t).textContent = a ? a.points : "";
      t.classList.toggle("revealed", Boolean(a) && G.revealed.includes(i));
    });
    if (newRound) {
      void board.offsetWidth;
      board.classList.remove("instant");
      renderedRound = G.round;
      requestAnimationFrame(fitAll);
    }

    $$(".mult-btn").forEach((b) => b.classList.toggle("is-on", Number(b.dataset.arg) === m));
    $$('[data-cmd="award"], [data-cmd="mult"], [data-cmd="strike"], [data-cmd="control"]').forEach((b) => (b.disabled = G.awardedTo !== null));
    $('[data-cmd="revealRest"]').disabled = G.revealed.length >= n;
    $('[data-cmd="undo"]').disabled = history.length === 0;
    $("#next-btn").textContent = gameOverNext() ? "See the winner" : "Next round";
    renderBanner();
  }

  const listNames = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

  let lastBanner = "";
  function renderBanner() {
    if (!G) return;
    const el = $("#banner");
    let text = "", cls = "";
    if (transient) text = transient;
    else if (G.awardedTo !== null) text = G.lastAward ? `${G.teams[G.awardedTo].name} +${G.lastAward}` : `${G.teams[G.awardedTo].name} gets nothing`;
    else if (G.strikes === 3 && G.control !== null) {
      text = G.teams.length === 2 ? `${G.teams[1 - G.control].name} can steal` : "Steal! Any other team";
      cls = "steal";
    }
    else if (G.strikes === 3) { text = "Three strikes"; cls = "steal"; }
    else if (G.scored.length === cur().answers.length) text = "Board cleared";
    el.className = "banner" + (cls ? " " + cls : "");
    el.textContent = text;
    if (text && text !== lastBanner) { void el.offsetWidth; el.classList.add("pop"); }
    lastBanner = text;
  }

  // Shrink long answers until they fit their tile.
  function fit(el) {
    el.style.fontSize = "";
    if (!el.clientWidth) return;
    let size = parseFloat(getComputedStyle(el).fontSize);
    let guard = 0;
    el.style.flexWrap = "wrap";
    while ((el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && size > 11 && guard++ < 40) {
      size *= 0.92;
      el.style.fontSize = size + "px";
    }
  }
  function fitAll() { tiles.forEach((t) => fit($(".ans", t))); }
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitAll, 120); });

  function hit(i) {
    const t = tiles[i];
    t.classList.remove("hit");
    void t.offsetWidth;
    t.classList.add("hit");
    setTimeout(() => t.classList.remove("hit"), 1000);
  }

  function stagger(list) {
    list.forEach((i, k) => {
      const inner = $(".tile-inner", tiles[i]);
      inner.style.transitionDelay = `${k * 0.22}s`;
      setTimeout(() => S.flip(), k * 220 + 80);
      setTimeout(() => (inner.style.transitionDelay = ""), k * 220 + 900);
    });
  }

  let xTimer;
  function showXs(count) {
    const box = $("#strikes");
    box.textContent = "";
    for (let i = 0; i < count; i++) {
      box.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 100 100"><use href="#x-mark"/></svg>');
    }
    clearTimeout(xTimer);
    xTimer = setTimeout(() => (box.textContent = ""), 1300);
  }

  // ---------- winner ----------
  function showWinner() {
    const ranked = G.teams.map((t, i) => ({ ...t, i })).sort((a, b) => b.score - a.score);
    const best = ranked[0].score;
    const leaders = ranked.filter((t) => t.score === best);
    if (leaders.length > 1) {
      $("#winner-name").textContent = "It's a tie";
      $("#winner-line").textContent = `${listNames(leaders.map((t) => t.name))} share the top spot with ${best} points.`;
    } else {
      $("#winner-name").textContent = leaders[0].name;
      $("#winner-line").textContent = `wins with ${best} points`;
    }
    const sc = $("#winner-scores");
    sc.textContent = "";
    const ord = (n) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || "th");
    ranked.forEach((t) => {
      const place = ranked.findIndex((x) => x.score === t.score) + 1; // ties share a place
      sc.append(el("div", { style: `--tc:${TEAM_COLOURS[t.i]}` },
        el("small", {}, ord(place)), el("span", {}, t.name), el("b", {}, String(t.score))));
    });
    show("screen-winner");
    S.fanfare();
    confetti();
  }

  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = $("#confetti");
    const ctx = c.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const colours = ["#ffc726", "#ffe9a0", "#00267f", "#1547c9", "#000000", "#fff4d6"];
    const bits = Array.from({ length: 180 }, () => ({
      x: Math.random() * innerWidth,
      y: -20 - Math.random() * innerHeight * 0.6,
      w: 6 + Math.random() * 8,
      h: 8 + Math.random() * 12,
      vy: 2 + Math.random() * 3.5,
      vx: -1.5 + Math.random() * 3,
      r: Math.random() * Math.PI,
      vr: -0.15 + Math.random() * 0.3,
      c: colours[(Math.random() * colours.length) | 0],
    }));
    const t0 = performance.now();
    const frame = (now) => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      bits.forEach((p) => {
        p.x += p.vx + Math.sin((now + p.y) / 400) * 0.6;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r)));
        ctx.restore();
      });
      if (now - t0 < 6500 && document.body.dataset.screen === "screen-winner") requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
    requestAnimationFrame(frame);
  }

  $("#again-btn").addEventListener("click", () => { if (!pool.length) pool = G.questions; openSetup(); });
  $("#back-board-btn").addEventListener("click", () => act("undo"));
  $("#winner-title-btn").addEventListener("click", () => show("screen-title"));

  // ---------- host bar ----------
  $("#hostbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cmd]");
    if (!b) return;
    act(b.dataset.cmd, b.dataset.arg);
  });
  const more = $("#more-menu");
  $("#more-btn").addEventListener("click", () => {
    more.hidden = !more.hidden;
    $("#more-btn").setAttribute("aria-expanded", String(!more.hidden));
  });
  document.addEventListener("click", (e) => {
    if (!more.hidden && !e.target.closest("#more-menu, #more-btn")) { more.hidden = true; $("#more-btn").setAttribute("aria-expanded", "false"); }
  });

  function syncSoundBtn() { $("#sound-btn").textContent = S.isMuted() ? "Sound off" : "Sound on"; }
  function toggleMute() { S.toggleMute(); syncSoundBtn(); say(S.isMuted() ? "Sound off" : "Sound on", 1200); }
  $("#sound-btn").addEventListener("click", toggleMute);
  syncSoundBtn();

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  $("#fs-btn").addEventListener("click", toggleFullscreen);

  function toggleControls() {
    const hidden = document.body.classList.toggle("controls-hidden");
    $("#show-controls").hidden = !hidden;
    more.hidden = true;
    setTimeout(fitAll, 50);
  }
  $("#hide-btn").addEventListener("click", toggleControls);
  $("#show-controls").addEventListener("click", toggleControls);
  $("#menu-btn").addEventListener("click", () => { more.hidden = true; show("screen-title"); refreshResume(); });

  $("#remote-btn").addEventListener("click", () => {
    window.open("host.html", "bajan-host", "popup,width=560,height=920");
  });

  document.addEventListener("keydown", (e) => {
    if (document.body.dataset.screen !== "screen-board") return;
    if (e.target.closest("input, textarea, select, dialog") || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (/^[1-8]$/.test(k)) act("reveal", Number(k) - 1);
    else if (k === "x") act("strike");
    else if (k === "z") act("buzz");
    else if (k === "r") act("revealRest");
    else if (k === "n") act("next");
    else if (k === "u") act("undo");
    else if (k === "q") act("toggleQuestion");
    else if (k === "h") toggleControls();
    else if (k === "f") toggleFullscreen();
    else if (k === "m") toggleMute();
    else return;
    e.preventDefault();
  });

  // ---------- host remote (second window, same browser) ----------
  function broadcast() {
    if (!chan) return;
    const live = G && G.phase === "play";
    chan.postMessage({
      type: "state",
      title,
      state: G ? {
        ...G,
        colours: TEAM_COLOURS,
        stage: live ? stage() : "end",
        faceoff: G.teams.map((t) => faceoffPlayer(t)),
        upNext: live && stage() === "playing" ? upNext() : null,
        bankNow: live ? bankNow() : 0,
        gameOverNext: live && gameOverNext(),
        canUndo: history.length > 0,
      } : null,
    });
  }
  if (chan) {
    chan.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === "hello") broadcast();
      else if (m.type === "cmd") {
        const scr = document.body.dataset.screen;
        if (scr === "screen-board" || (scr === "screen-winner" && m.cmd === "undo")) act(m.cmd, m.arg);
      }
    };
  }

  // ---------- resume after a refresh ----------
  function refreshResume() {
    const saved = store.get(SAVE_KEY);
    $("#resume-btn").hidden = !(saved && saved.v === 2 && saved.phase === "play");
  }
  $("#resume-btn").addEventListener("click", () => {
    const saved = store.get(SAVE_KEY);
    if (!saved) return;
    S.unlock();
    G = saved;
    isDemo = Boolean(saved.demo);
    if (!pool.length) pool = isDemo ? SAMPLE : saved.questions;
    history = [];
    renderedRound = -1;
    shownScore.length = 0;
    show("screen-board");
    render();
    broadcast();
  });

  // ---------- start ----------
  const params = new URLSearchParams(location.search);
  refreshResume();
  show("screen-title");
  loadTitle();
  if (params.has("demo")) { pool = SAMPLE; isDemo = true; openSetup(); }
})();
