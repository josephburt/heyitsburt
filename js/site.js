(function () {
  const TZ = "America/Chicago";
  const FREQ_MIN = 24;
  const FREQ_MAX = 1300;
  const HOME_FREQ = 433.92;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const navToggle = document.querySelector(".nav-toggle");
  const navMenu = document.getElementById("nav-menu");

  if (navToggle && navMenu) {
    navToggle.addEventListener("click", function () {
      const open = navMenu.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(open));
    });

    navMenu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        navMenu.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && navMenu.classList.contains("open")) {
        navMenu.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
        navToggle.focus();
      }
    });
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(function ([k, v]) {
        if (k === "className") node.className = v;
        else if (k === "text") node.textContent = v;
        else node.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (child) {
      if (typeof child === "string") node.appendChild(document.createTextNode(child));
      else if (child) node.appendChild(child);
    });
    return node;
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric"
      });
    } catch (_) {
      return "";
    }
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatClock(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const get = function (type) {
      const part = parts.find(function (p) { return p.type === type; });
      return part ? part.value : "00";
    };
    return get("hour") + ":" + get("minute") + ":" + get("second");
  }

  function tickClocks() {
    const now = new Date();
    const local = document.getElementById("clock-local");
    const utc = document.getElementById("clock-utc");
    if (local) local.textContent = formatClock(now, TZ);
    if (utc) utc.textContent = pad(now.getUTCHours()) + ":" + pad(now.getUTCMinutes()) + ":" + pad(now.getUTCSeconds());
  }
  tickClocks();
  setInterval(tickClocks, 1000);

  const vfoEl = document.getElementById("vfo");
  const sMeter = document.getElementById("s-meter");
  const sReadout = document.getElementById("s-readout");
  const rigMode = document.getElementById("rig-mode");
  const rigState = document.getElementById("rig-state");
  const liveLabel = document.getElementById("live-label");
  const liveDot = document.getElementById("live-dot");
  const opStatus = document.getElementById("op-status");

  let live = false;
  let tunedFreq = HOME_FREQ;
  let signalLevel = 0.42;

  function formatFreq(mhz) {
    return mhz.toFixed(3);
  }

  function setFreq(mhz) {
    tunedFreq = Math.min(FREQ_MAX, Math.max(FREQ_MIN, mhz));
    if (vfoEl) vfoEl.textContent = formatFreq(tunedFreq);
  }
  setFreq(HOME_FREQ);

  if (sMeter) {
    for (let i = 0; i < 12; i += 1) {
      sMeter.appendChild(document.createElement("span"));
    }
  }

  function renderMeter(level) {
    const bars = sMeter ? sMeter.querySelectorAll("span") : [];
    const on = Math.max(1, Math.round(level * bars.length));
    bars.forEach(function (bar, i) {
      bar.classList.toggle("on", i < on);
    });
    if (sReadout) sReadout.textContent = "S" + Math.min(9, Math.max(1, Math.round(level * 9)));
  }

  function meterLoop() {
    const wobble = 0.04 * Math.sin(Date.now() / 420) + (Math.random() - 0.5) * 0.03;
    const target = live ? 0.82 : 0.38;
    signalLevel += (target + wobble - signalLevel) * 0.12;
    renderMeter(signalLevel);
    if (!reduceMotion) requestAnimationFrame(meterLoop);
  }
  renderMeter(signalLevel);
  if (!reduceMotion) requestAnimationFrame(meterLoop);
  else {
    setInterval(function () {
      signalLevel = live ? 0.8 : 0.4;
      renderMeter(signalLevel);
    }, 2000);
  }

  document.querySelectorAll(".roles button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".roles button").forEach(function (b) {
        b.classList.remove("is-active");
      });
      btn.classList.add("is-active");
      if (rigMode) rigMode.textContent = btn.getAttribute("data-mode") || "BUILD";
    });
  });

  fetch("data/now.json")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      live = Boolean(data.live);
      document.body.classList.toggle("is-live", live);
      if (liveLabel) liveLabel.textContent = live ? "LIVE" : "STANDBY";
      if (rigState) rigState.textContent = live ? "LIVE" : "STANDBY";
      if (opStatus && data.status) opStatus.textContent = data.status;
      if (liveDot) liveDot.classList.toggle("is-live", live);
    })
    .catch(function () {});

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
    let running = true;
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
      waterCtx.fillStyle = "#07090c";
      waterCtx.fillRect(0, 0, water.width, water.height);
      for (let i = 0; i < Math.min(120, water.height); i += 1) {
        sample(i * 24);
        shiftWater();
      }
      paint(0);
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
        v += (live ? 0.28 : 0.12) * Math.exp(-dtune * dtune);
        bins[i] = Math.min(1, v);
      }
    }

    function heat(t) {
      const stops = [
        [7, 9, 12],
        [18, 32, 58],
        [212, 138, 74],
        [243, 234, 220],
        [125, 255, 179]
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

      ctx.fillStyle = "#07090c";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(water, 0, scopeH);

      ctx.beginPath();
      ctx.moveTo(0, scopeH);
      for (let i = 0; i < n; i += 1) {
        const x = (i / (n - 1)) * w;
        const y = scopeH - bins[i] * (scopeH - 10 * (window.devicePixelRatio || 1));
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, scopeH);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, 0, 0, scopeH);
      fill.addColorStop(0, "rgba(125, 255, 179, 0.32)");
      fill.addColorStop(0.55, "rgba(212, 138, 74, 0.16)");
      fill.addColorStop(1, "rgba(7, 9, 12, 0)");
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i < n; i += 1) {
        const x = (i / (n - 1)) * w;
        const y = scopeH - bins[i] * (scopeH - 10 * (window.devicePixelRatio || 1));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(125, 255, 179, 0.9)";
      ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1);
      ctx.stroke();

      const tx = tunerX * w;
      ctx.strokeStyle = "rgba(243, 234, 220, 0.55)";
      ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1);
      ctx.beginPath();
      ctx.moveTo(tx, 0);
      ctx.lineTo(tx, h);
      ctx.stroke();
      ctx.fillStyle = "rgba(212, 138, 74, 0.95)";
      const mark = 7 * (window.devicePixelRatio || 1);
      ctx.fillRect(tx - mark / 2, 8 * (window.devicePixelRatio || 1), mark, mark);
    }

    function loop(t) {
      running = inView && document.visibilityState === "visible" && !reduceMotion;
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

  function cacheGet(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.t > 15 * 60 * 1000) return null;
      return parsed.v;
    } catch (_) {
      return null;
    }
  }

  function cacheSet(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value }));
    } catch (_) { /* ignore quota */ }
  }

  const YOUTUBE_CHANNEL_ID = "UCL0Gvu2R42sKsmmLSIC0kHA";
  const YOUTUBE_RSS = "https://www.youtube.com/feeds/videos.xml?channel_id=" + YOUTUBE_CHANNEL_ID;
  const YOUTUBE_FEED_API = "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(YOUTUBE_RSS);

  function youtubeIdFromLink(link) {
    if (!link) return "";
    const match = link.match(/[?&]v=([^&]+)/);
    return match ? match[1] : "";
  }

  function renderChannelCta() {
    const grid = document.getElementById("videos-grid");
    if (!grid) return;
    grid.textContent = "";
    grid.appendChild(el("a", {
      className: "video-card featured channel-cta",
      href: "https://www.youtube.com/@HeyItsBurt-Main",
      target: "_blank",
      rel: "noopener"
    }, [
      el("div", { className: "thumb placeholder", "aria-hidden": "true" }, [
        el("span", { className: "play-mark" })
      ]),
      el("div", { className: "video-body" }, [
        el("span", { className: "label", text: "// channel" }),
        el("h3", { text: "Watch the builds on YouTube" }),
        el("span", { className: "date", text: "@HeyItsBurt-Main" })
      ])
    ]));
  }

  function renderVideos(videos) {
    const grid = document.getElementById("videos-grid");
    if (!grid) return;

    if (!videos || !videos.length) {
      renderChannelCta();
      return;
    }

    grid.textContent = "";
    videos.slice(0, 3).forEach(function (video, i) {
      const card = el("a", {
        className: "video-card" + (i === 0 ? " featured" : ""),
        href: video.url,
        target: "_blank",
        rel: "noopener"
      }, [
        el("div", { className: "thumb" }, [
          el("img", { src: video.thumbnail, alt: "", loading: "lazy" })
        ]),
        el("div", { className: "video-body" }, [
          el("span", { className: "label", text: i === 0 ? "// latest transmission" : "// archive" }),
          el("h3", { text: video.title }),
          el("span", { className: "date", text: formatDate(video.published) })
        ])
      ]);
      grid.appendChild(card);
    });
  }

  function loadVideos() {
    const cached = cacheGet("videos-v2");
    if (cached && Array.isArray(cached) && cached.length) {
      renderVideos(cached);
      return;
    }
    fetch(YOUTUBE_FEED_API)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.status !== "ok" || !Array.isArray(data.items) || !data.items.length) {
          throw new Error("empty YouTube feed");
        }
        const videos = data.items.map(function (item) {
          const id = youtubeIdFromLink(item.link);
          return {
            title: item.title || "Untitled video",
            url: item.link,
            published: item.pubDate,
            thumbnail: item.thumbnail || (id ? "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" : "")
          };
        });
        cacheSet("videos-v2", videos);
        renderVideos(videos);
      })
      .catch(function () {
        renderChannelCta();
      });
  }

  loadVideos();
})();
