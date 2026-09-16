(function () {
  const FREQ_MIN = 24;
  const FREQ_MAX = 1300;
  const HOME_FREQ = 433.92;
  const PAPER = "#f6f1e6";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const year = document.getElementById("y");
  if (year) year.textContent = String(new Date().getFullYear());

  const vfoEl = document.getElementById("vfo");
  let tunedFreq = HOME_FREQ;

  function formatFreq(mhz) {
    return mhz.toFixed(3);
  }

  function setFreq(mhz) {
    tunedFreq = Math.min(FREQ_MAX, Math.max(FREQ_MIN, mhz));
    if (vfoEl) vfoEl.textContent = formatFreq(tunedFreq);
  }
  setFreq(HOME_FREQ);

  function initSpectrum() {
    const canvas = document.getElementById("spectrum");
    if (!canvas || !canvas.getContext) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    const water = document.createElement("canvas");
    const waterCtx = water.getContext("2d", { alpha: false });

    function freqToX(freq) {
      return (freq - FREQ_MIN) / (FREQ_MAX - FREQ_MIN);
    }
    function xToFreq(x) {
      return FREQ_MIN + x * (FREQ_MAX - FREQ_MIN);
    }

    const carriers = [
      { x: 0.14, w: 0.01, a: 0.45 },
      { x: 0.31, w: 0.006, a: 0.32 },
      { x: freqToX(HOME_FREQ), w: 0.009, a: 0.92 },
      { x: 0.58, w: 0.018, a: 0.28 },
      { x: 0.71, w: 0.007, a: 0.55 },
      { x: 0.84, w: 0.012, a: 0.4 },
      { x: 0.93, w: 0.005, a: 0.62 }
    ];

    let w = 0;
    let h = 0;
    let bins = new Float32Array(128);
    let inView = true;
    let tunerX = freqToX(HOME_FREQ);
    let acc = 0;
    let lastT = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      canvas.width = w;
      canvas.height = h;
      bins = new Float32Array(Math.max(96, Math.floor(canvas.clientWidth)));
      const scopeH = Math.max(1, Math.floor(h * 0.34));
      water.width = w;
      water.height = Math.max(1, h - scopeH);
      waterCtx.fillStyle = PAPER;
      waterCtx.fillRect(0, 0, water.width, water.height);
      for (let i = 0; i < Math.min(120, water.height); i += 1) {
        sample(i * 24);
        shiftWater();
      }
      paint();
    }

    function sample(t) {
      const n = bins.length;
      const scan = (Math.sin(t * 0.00018) * 0.5 + 0.5) * 0.92 + 0.04;
      for (let i = 0; i < n; i += 1) {
        const x = i / (n - 1);
        let v = 0.045 + Math.random() * 0.03;
        v += 0.02 * Math.sin(x * 21 + t * 0.0004);
        v += 0.015 * Math.sin(x * 7.3 - t * 0.00025);
        for (let c = 0; c < carriers.length; c += 1) {
          const d = (x - carriers[c].x) / carriers[c].w;
          v += carriers[c].a * Math.exp(-d * d);
        }
        const ds = (x - scan) / 0.012;
        v += 0.22 * Math.exp(-ds * ds);
        const dtune = (x - tunerX) / 0.004;
        v += 0.12 * Math.exp(-dtune * dtune);
        bins[i] = Math.min(1, v);
      }
    }

    function heat(t) {
      const stops = [
        [246, 241, 230],
        [239, 232, 216],
        [180, 168, 140],
        [26, 39, 68],
        [158, 42, 43]
      ];
      const scaled = Math.max(0, Math.min(1, t)) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(scaled));
      const f = scaled - i;
      const a = stops[i];
      const b = stops[i + 1];
      return [
        (a[0] + (b[0] - a[0]) * f) | 0,
        (a[1] + (b[1] - a[1]) * f) | 0,
        (a[2] + (b[2] - a[2]) * f) | 0
      ];
    }

    function shiftWater() {
      if (water.height > 1) {
        waterCtx.drawImage(water, 0, 0, w, water.height - 1, 0, 1, w, water.height - 1);
      }
      const row = waterCtx.createImageData(w, 1);
      const data = row.data;
      const n = bins.length;
      for (let i = 0; i < w; i += 1) {
        const idx = Math.min(n - 1, Math.floor((i / w) * n));
        const rgb = heat(Math.pow(bins[idx], 1.12));
        const p = i * 4;
        data[p] = rgb[0];
        data[p + 1] = rgb[1];
        data[p + 2] = rgb[2];
        data[p + 3] = 255;
      }
      waterCtx.putImageData(row, 0, 0);
    }

    function paint() {
      const scopeH = Math.max(1, Math.floor(h * 0.34));
      const n = bins.length;
      const dpr = window.devicePixelRatio || 1;

      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(water, 0, scopeH);

      ctx.beginPath();
      ctx.moveTo(0, scopeH);
      for (let i = 0; i < n; i += 1) {
        const x = (i / (n - 1)) * w;
        const y = scopeH - bins[i] * (scopeH - 10 * dpr);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, scopeH);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, 0, 0, scopeH);
      fill.addColorStop(0, "rgba(26, 39, 68, 0.28)");
      fill.addColorStop(0.55, "rgba(158, 42, 43, 0.12)");
      fill.addColorStop(1, "rgba(246, 241, 230, 0)");
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i < n; i += 1) {
        const x = (i / (n - 1)) * w;
        const y = scopeH - bins[i] * (scopeH - 10 * dpr);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(26, 39, 68, 0.85)";
      ctx.lineWidth = Math.max(1, dpr);
      ctx.stroke();

      const tx = tunerX * w;
      ctx.strokeStyle = "rgba(158, 42, 43, 0.55)";
      ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      ctx.moveTo(tx, 0);
      ctx.lineTo(tx, h);
      ctx.stroke();
      ctx.fillStyle = "rgba(158, 42, 43, 0.95)";
      const mark = 7 * dpr;
      ctx.fillRect(tx - mark / 2, 8 * dpr, mark, mark);
    }

    function loop(t) {
      const running = inView && document.visibilityState === "visible" && !reduceMotion;
      if (running) {
        if (!lastT) lastT = t;
        const dt = t - lastT;
        lastT = t;
        sample(t);
        acc += dt;
        if (acc > 42) {
          acc = 0;
          shiftWater();
        }
        paint();
      }
      requestAnimationFrame(loop);
    }

    resize();
    if (!reduceMotion) requestAnimationFrame(loop);
    else {
      sample(0);
      paint();
    }

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", function () {
      lastT = 0;
    });

    const io = new IntersectionObserver(function (entries) {
      inView = Boolean(entries[0] && entries[0].isIntersecting);
    }, { threshold: 0.05 });
    io.observe(canvas);

    canvas.addEventListener("pointerdown", function (event) {
      const rect = canvas.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      tunerX = x;
      setFreq(xToFreq(x));
      sample(performance.now());
      paint();
    });
  }

  initSpectrum();
})();
