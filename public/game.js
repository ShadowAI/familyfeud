// Bajan Showdown — the gameshow board.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const S = window.ShowSound;
  const SAVE_KEY = "bs-game-v1";
  const PW_KEY = "bs-teacher-pw";
  const chan = "BroadcastChannel" in window ? new BroadcastChannel("bajan-showdown") : null;

  // Sample questions so the host can practise before students have written any.
  // The point values are made up for practice.
  const SAMPLE = [
    { slot: 1, author: "Sample", formClass: "", question: "Name a dish you'd find at a Bajan Sunday lunch.", answers: [
      { text: "Macaroni pie", points: 34 }, { text: "Baked chicken", points: 22 }, { text: "Rice and peas", points: 15 },
      { text: "Fried plantain", points: 10 }, { text: "Coleslaw", points: 8 }, { text: "Pigeon peas", points: 5 } ] },
    { slot: 2, author: "Sample", formClass: "", question: "Name something you'd see on Grand Kadooment Day.", answers: [
      { text: "Costumes", points: 31 }, { text: "Music trucks", points: 24 }, { text: "Feathers", points: 15 },
      { text: "Big crowds", points: 12 }, { text: "Soca artistes", points: 9 }, { text: "Police", points: 5 } ] },
    { slot: 3, author: "Sample", formClass: "", question: "Name a beach in Barbados.", answers: [
      { text: "Crane Beach", points: 25 }, { text: "Accra Beach", points: 20 }, { text: "Brownes Beach", points: 16 },
      { text: "Bathsheba", points: 13 }, { text: "Miami Beach", points: 10 }, { text: "Carlisle Bay", points: 8 }, { text: "Mullins", points: 4 } ] },
    { slot: 4, author: "Sample", formClass: "", question: "Name a snack you'd buy at the school tuck shop.", answers: [
      { text: "Fish cakes", points: 29 }, { text: "Cheese cutter", points: 23 }, { text: "Turnover", points: 14 },
      { text: "Tamarind balls", points: 12 }, { text: "Sugar cake", points: 9 } ] },
    { slot: 5, author: "Sample", formClass: "", question: "Name a parish in Barbados.", answers: [
      { text: "St. Michael", points: 30 }, { text: "Christ Church", points: 21 }, { text: "St. James", points: 15 },
      { text: "St. Philip", points: 11 }, { text: "St. Lucy", points: 8 }, { text: "St. Andrew", points: 6 },
      { text: "St. Joseph", points: 4 }, { text: "St. Peter", points: 3 } ] },
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
  let pool = [];       // approved questions loaded from the server (or samples)
  let isDemo = false;
  let G = null;        // the game in progress
  let history = [];    // undo stack (JSON snapshots)
  let renderedRound = -1;
  let statusTimer = null;

  // ---------- screens ----------
  function show(id) {
    document.body.dataset.screen = id;
    if (id === "screen-title") startStatusPolling(); else stopStatusPolling();
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

  // ---------- title screen: live slot count ----------
  async function loadStatus() {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      if (!r.ok) throw new Error();
      const st = await r.json();
      setTitle(st.title);
      const dots = $("#slot-dots");
      dots.textContent = "";
      const taken = new Set(st.taken);
      for (let i = 1; i <= st.slotCount; i++) {
        const d = document.createElement("span");
        if (taken.has(i)) d.className = "taken";
        dots.append(d);
      }
      const text = $("#slot-text");
      text.textContent = "";
      if (!st.open) text.textContent = "Question writing is closed.";
      else if (st.left === 0) text.textContent = "Every question slot is taken.";
      else text.textContent = `${st.left} of ${st.slotCount} question slots left`;
      const small = document.createElement("small");
      small.textContent = st.open && st.left > 0 ? "First come, first served. One question each." : `${st.slotCount - st.left} questions written by the class`;
      text.append(small);
    } catch {
      $("#slot-dots").textContent = "";
      $("#slot-text").textContent = "The question bank isn't connected yet, so you can only practise with sample questions for now.";
    }
  }
  function startStatusPolling() { loadStatus(); stopStatusPolling(); statusTimer = setInterval(loadStatus, 15000); }
  function stopStatusPolling() { clearInterval(statusTimer); }

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
      if (!j.questions.length) return openLogin("No questions are approved yet. Approve some on the teacher page first.");
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
  function openSetup() {
    const n = pool.length;
    $("#setup-count").textContent = isDemo
      ? `${n} sample questions loaded for practice.`
      : `${n} approved question${n === 1 ? "" : "s"} from the class.`;
    const sel = $("#rounds");
    sel.textContent = "";
    const choices = [...new Set([3, 4, 5, 6, 8, 10].filter((x) => x < n).concat(n))];
    choices.forEach((c) => {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c === n ? `All ${n} questions` : `${c} rounds`;
      sel.append(o);
    });
    sel.value = n >= 4 ? String(Math.min(n, choices.includes(4) ? 4 : n)) : String(n);
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
      v: 1,
      title,
      demo: isDemo,
      questions: order.map((i) => pool[i]),
      teams: [
        { name: $("#t0").value.trim() || "Team Trident", score: 0 },
        { name: $("#t1").value.trim() || "Team Flying Fish", score: 0 },
      ],
      target: Number($("#target").value) || 0,
      showAuthor: $("#show-author").checked,
      round: 0,
      mults: defaultMults(n),
      revealed: [],
      scored: [],
      strikes: 0,
      control: null,
      awardedTo: null,
      lastAward: 0,
      showQuestion: true,
      skipArmed: false,
      phase: "play",
    };
    history = [];
    renderedRound = -1;
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
        G.revealed.push(i);
        G.skipArmed = false;
        if (G.awardedTo === null) { G.scored.push(i); S.ding(); hit(i); } else S.flip();
        break;
      }
      case "strike": {
        if (G.awardedTo !== null || G.strikes >= 3) return;
        snapshot();
        G.strikes += 1;
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
        if (G.awardedTo !== null || (t !== 0 && t !== 1)) return;
        snapshot();
        G.control = G.control === t ? null : t;
        break;
      }
      case "award": {
        const t = Number(arg);
        if (G.awardedTo !== null || (t !== 0 && t !== 1)) return;
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
        Object.assign(G, { revealed: [], scored: [], strikes: 0, control: null, awardedTo: null, lastAward: 0, skipArmed: false, showQuestion: true });
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

  const shownScore = [null, null];
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
    const q = cur();
    const n = q.answers.length;

    G.teams.forEach((t, i) => {
      const el = $(`#team-${i}`);
      $(".team-name", el).textContent = t.name;
      tweenScore($(".team-score", el), i, t.score);
      el.classList.toggle("has-control", G.control === i && G.awardedTo === null);
      $(`#ctl-${i}`).textContent = t.name;
      $(`#ctl-${i}`).classList.toggle("is-on", G.control === i);
      $(`#award-${i}`).textContent = t.name;
    });

    $("#bank").textContent = bankNow();
    const m = mult();
    $("#mult").hidden = m === 1;
    $("#mult").textContent = m === 2 ? "Double" : "Triple";
    $$("#pips svg").forEach((s, i) => s.classList.toggle("on", i < G.strikes));

    $("#round-label").textContent = `Round ${G.round + 1} of ${G.questions.length}`;
    $("#q-author").textContent = G.showAuthor && q.author && q.author !== "Sample" ? `Question by ${q.author}${q.formClass ? `, ${q.formClass}` : ""}` : "";
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

  let lastBanner = "";
  function renderBanner() {
    if (!G) return;
    const el = $("#banner");
    let text = "", cls = "";
    if (transient) text = transient;
    else if (G.awardedTo !== null) text = G.lastAward ? `${G.teams[G.awardedTo].name} +${G.lastAward}` : `${G.teams[G.awardedTo].name} gets nothing`;
    else if (G.strikes === 3 && G.control !== null) { text = `${G.teams[1 - G.control].name} can steal`; cls = "steal"; }
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
    const [a, b] = G.teams;
    const tie = a.score === b.score;
    const w = a.score > b.score ? a : b;
    $("#winner-name").textContent = tie ? "It's a tie" : w.name;
    $("#winner-line").textContent = tie ? `${a.score} points each. What a game.` : `wins with ${w.score} points`;
    const sc = $("#winner-scores");
    sc.textContent = "";
    [a, b].forEach((t) => {
      const d = document.createElement("div");
      const s = document.createElement("span");
      s.textContent = t.name;
      const n = document.createElement("b");
      n.textContent = t.score;
      d.append(s, n);
      sc.append(d);
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
    chan.postMessage({
      type: "state",
      title,
      state: G ? { ...G, bankNow: G.phase === "play" ? bankNow() : 0, gameOverNext: G.phase === "play" && gameOverNext(), canUndo: history.length > 0 } : null,
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
    $("#resume-btn").hidden = !(saved && saved.v === 1 && saved.phase === "play");
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
    show("screen-board");
    render();
    broadcast();
  });

  // ---------- start ----------
  const params = new URLSearchParams(location.search);
  refreshResume();
  show("screen-title");
  if (params.has("demo")) { pool = SAMPLE; isDemo = true; openSetup(); }
})();
