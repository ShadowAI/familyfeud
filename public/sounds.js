// Original sound effects, synthesised live with the Web Audio API (no audio files).
window.ShowSound = (() => {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem("bs-muted") === "1"; } catch {}

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // One shaped note. `at` is seconds from now.
  function note({ freq, type = "sine", at = 0, dur = 0.5, gain = 0.2, attack = 0.004, glide, cutoff }) {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime + at;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (cutoff) {
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = cutoff;
      osc.connect(f);
      node = f;
    }
    node.connect(amp).connect(master());
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  let out = null;
  function master() {
    if (!out) {
      out = ctx.createDynamicsCompressor();
      out.threshold.value = -14;
      out.connect(ctx.destination);
    }
    return out;
  }

  // Bell: a fundamental plus a few bright partials.
  function bell(freq, at = 0, level = 1) {
    [[1, 0.28, 1.3], [2, 0.12, 0.9], [3.01, 0.07, 0.6], [4.2, 0.04, 0.4]].forEach(([m, g, d]) =>
      note({ freq: freq * m, at, dur: d, gain: g * level })
    );
  }

  return {
    unlock() { ac(); },
    isMuted: () => muted,
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem("bs-muted", muted ? "1" : "0"); } catch {}
      return muted;
    },

    // Correct answer revealed
    ding() {
      bell(987.77);
      bell(1318.5, 0.09, 0.8);
    },

    // Quiet tick for "reveal the rest" (no points)
    flip() {
      note({ freq: 620, type: "triangle", dur: 0.12, gain: 0.09, glide: 420 });
    },

    // Strike
    buzz() {
      note({ freq: 92, type: "sawtooth", dur: 0.85, gain: 0.32, attack: 0.01, cutoff: 1500 });
      note({ freq: 97.5, type: "sawtooth", dur: 0.85, gain: 0.28, attack: 0.01, cutoff: 1500 });
      note({ freq: 46, type: "square", dur: 0.8, gain: 0.16, attack: 0.01, cutoff: 600 });
    },

    // Steal chance: two rising tense notes
    steal() {
      note({ freq: 330, type: "square", dur: 0.22, gain: 0.08, cutoff: 1800 });
      note({ freq: 392, type: "square", at: 0.24, dur: 0.22, gain: 0.08, cutoff: 1800 });
      note({ freq: 466, type: "square", at: 0.48, dur: 0.5, gain: 0.09, cutoff: 1800 });
    },

    // Bank goes to a team
    award() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        note({ freq: f, type: "triangle", at: i * 0.09, dur: 0.5, gain: 0.18 })
      );
      bell(2093, 0.36, 0.5);
    },

    // Opening sting for a new round
    round() {
      [392, 523.25, 659.25].forEach((f, i) => note({ freq: f, type: "triangle", at: i * 0.07, dur: 0.35, gain: 0.14 }));
    },

    // Title / start of game jingle (an original tune with a calypso lilt)
    intro() {
      const seq = [
        [523.25, 0, 0.18], [659.25, 0.18, 0.18], [783.99, 0.36, 0.12], [659.25, 0.5, 0.12],
        [783.99, 0.64, 0.18], [880, 0.84, 0.18], [1046.5, 1.04, 0.6],
      ];
      seq.forEach(([f, at, d]) => {
        note({ freq: f, type: "triangle", at, dur: d + 0.15, gain: 0.17 });
        note({ freq: f / 2, type: "sine", at, dur: d + 0.1, gain: 0.08 });
      });
      bell(2093, 1.04, 0.5);
    },

    // Winner fanfare
    fanfare() {
      const seq = [
        [523.25, 0, 0.2], [523.25, 0.22, 0.12], [523.25, 0.36, 0.12], [698.46, 0.5, 0.35],
        [880, 0.9, 0.2], [783.99, 1.12, 0.2], [1046.5, 1.34, 1.1],
      ];
      seq.forEach(([f, at, d]) => {
        note({ freq: f, type: "sawtooth", at, dur: d + 0.1, gain: 0.08, cutoff: 2600 });
        note({ freq: f, type: "triangle", at, dur: d + 0.2, gain: 0.14 });
        note({ freq: f * 0.5, type: "triangle", at, dur: d + 0.2, gain: 0.08 });
      });
      bell(2093, 1.34, 0.7);
      bell(2637, 1.5, 0.5);
    },
  };
})();
