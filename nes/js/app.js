(function () {
  "use strict";

  const canvas = document.getElementById("screen");
  const ctx = canvas.getContext("2d", { alpha: false });
  const img = ctx.createImageData(256, 240);
  const img32 = new Uint32Array(img.data.buffer);

  const nes = new NES();
  let paused = false;
  let muted = false;
  let running = false;
  let raf = 0;
  let frames = 0;
  let lastFps = performance.now();
  let audioCtx = null;
  let scriptNode = null;

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function blit() {
    img32.set(nes.ppu.pixels);
    ctx.putImageData(img, 0, 0);
  }

  function mapperLabel(cart) {
    const n = NES_MAPPER_NAMES[cart.mapperId] || "UNK";
    return cart.mapperId + " " + n;
  }

  function loadBytes(bytes, name) {
    try {
      const cart = nes.loadRom(bytes, name);
      document.getElementById("rom-name").textContent = name || "ROM";
      document.getElementById("mapper-info").textContent = mapperLabel(cart);
      document.getElementById("hint").textContent = "Playing “" + (name || "ROM") + "”";
      paused = false;
      document.getElementById("btn-pause").textContent = "Pause";
      document.getElementById("run-dot").classList.add("on");
      running = true;
      ensureAudio();
    } catch (err) {
      document.getElementById("hint").textContent = String(err.message || err);
    }
  }

  function ensureAudio() {
    if (muted) return;
    if (audioCtx && audioCtx.state === "running") return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
      if (audioCtx.state === "suspended") audioCtx.resume();
      if (!scriptNode) {
        const buf = 2048;
        scriptNode = audioCtx.createScriptProcessor(buf, 0, 1);
        scriptNode.onaudioprocess = function (e) {
          const out = e.outputBuffer.getChannelData(0);
          if (paused || muted || !running) {
            out.fill(0);
            return;
          }
          for (let i = 0; i < out.length; i++) out[i] = nes.apu.pullSample();
        };
        scriptNode.connect(audioCtx.destination);
      }
    } catch (e) {}
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!running || paused) return;
    nes.stepFrame();
    blit();
    frames++;
    if (now - lastFps >= 1000) {
      document.getElementById("fps").textContent = frames + " FPS";
      frames = 0;
      lastFps = now;
    }
  }

  const KEYMAP = {
    ArrowRight: 7, ArrowLeft: 6, ArrowDown: 5, ArrowUp: 4,
    KeyD: 7, KeyA: 6, KeyS: 5, KeyW: 4,
    Enter: 3, ShiftLeft: 2, ShiftRight: 2, Space: 2,
    KeyX: 1, KeyK: 1,
    KeyZ: 0, KeyJ: 0
  };

  window.addEventListener("keydown", function (e) {
    if (e.code === "KeyP") { togglePause(); e.preventDefault(); return; }
    if (e.code === "KeyR" && (e.metaKey || e.ctrlKey)) return;
    if (e.code === "KeyR") { nes.reset(); e.preventDefault(); return; }
    const b = KEYMAP[e.code];
    if (b !== undefined) {
      nes.ctrl1.setButton(b, true);
      e.preventDefault();
      ensureAudio();
    }
  });
  window.addEventListener("keyup", function (e) {
    const b = KEYMAP[e.code];
    if (b !== undefined) nes.ctrl1.setButton(b, false);
  });

  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads[0];
    if (!p) return;
    const b = p.buttons;
    const ax = p.axes;
    nes.ctrl1.setButton(0, !!(b[0] && b[0].pressed) || !!(b[2] && b[2].pressed)); // A
    nes.ctrl1.setButton(1, !!(b[1] && b[1].pressed) || !!(b[3] && b[3].pressed)); // B
    nes.ctrl1.setButton(2, !!(b[8] && b[8].pressed));
    nes.ctrl1.setButton(3, !!(b[9] && b[9].pressed));
    nes.ctrl1.setButton(4, !!(b[12] && b[12].pressed) || ax[1] < -0.5);
    nes.ctrl1.setButton(5, !!(b[13] && b[13].pressed) || ax[1] > 0.5);
    nes.ctrl1.setButton(6, !!(b[14] && b[14].pressed) || ax[0] < -0.5);
    nes.ctrl1.setButton(7, !!(b[15] && b[15].pressed) || ax[0] > 0.5);
  }
  setInterval(pollGamepad, 16);

  function togglePause() {
    paused = !paused;
    document.getElementById("btn-pause").textContent = paused ? "Resume" : "Pause";
    document.getElementById("run-dot").classList.toggle("on", running && !paused);
    if (!paused) ensureAudio();
  }

  document.getElementById("btn-pause").onclick = togglePause;
  document.getElementById("btn-reset").onclick = function () { nes.reset(); };
  document.getElementById("btn-load").onclick = function () {
    document.getElementById("file").click();
  };
  document.getElementById("file").onchange = function (e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    f.arrayBuffer().then(function (buf) { loadBytes(new Uint8Array(buf), f.name); });
  };
  document.getElementById("btn-full").onclick = function () {
    const el = document.getElementById("crt-wrap");
    if (!document.fullscreenElement) el.requestFullscreen().catch(function () {});
    else document.exitFullscreen();
  };
  document.getElementById("btn-mute").onclick = function () {
    muted = !muted;
    this.textContent = muted ? "Unmute" : "Mute";
    if (!muted) ensureAudio();
  };
  document.getElementById("chk-crt").onchange = function () {
    document.getElementById("crt-wrap").classList.toggle("crt-on", this.checked);
  };
  document.getElementById("chk-smooth").onchange = function () {
    canvas.classList.toggle("smooth", this.checked);
  };
  document.getElementById("crt-wrap").classList.add("crt-on");

  const zone = document.getElementById("drop-zone");
  window.addEventListener("dragover", function (e) { e.preventDefault(); zone.classList.add("drag"); });
  window.addEventListener("dragleave", function () { zone.classList.remove("drag"); });
  window.addEventListener("drop", function (e) {
    e.preventDefault();
    zone.classList.remove("drag");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    f.arrayBuffer().then(function (buf) { loadBytes(new Uint8Array(buf), f.name); });
  });

  window.addEventListener("click", function () { ensureAudio(); }, { once: true });
  setInterval(function () { nes.saveRam(); }, 5000);

  loadBytes(b64ToBytes(DEMO_ROM_B64), "DEMO ROM");
  raf = requestAnimationFrame(frame);
})();
