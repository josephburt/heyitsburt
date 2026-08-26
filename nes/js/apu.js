/* NES APU — pulse/triangle/noise + frame counter. Mixed into a ring buffer. */
(function (g) {
  "use strict";

  const LENGTH = [
    10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
    12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30
  ];
  const TRI_SEQ = [15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,0,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];
  const NOISE_P = [4,8,16,32,64,96,128,160,202,254,380,508,762,1016,2034,4068];
  const DUTY = [
    [0,1,0,0,0,0,0,0],
    [0,1,1,0,0,0,0,0],
    [0,1,1,1,1,0,0,0],
    [1,0,0,1,1,1,1,1]
  ];

  function Pulse() {
    this.enabled = false;
    this.length = 0;
    this.timer = 0;
    this.period = 0;
    this.duty = 0;
    this.seq = 0;
    this.envStart = false;
    this.envVol = 0;
    this.envDiv = 0;
    this.constVol = false;
    this.volume = 0;
    this.loop = false;
    this.sweepEn = false;
    this.sweepP = 0;
    this.sweepN = false;
    this.sweepS = 0;
    this.sweepDiv = 0;
    this.sweepReload = false;
    this.ch = 0;
  }
  Pulse.prototype.write = function (reg, val) {
    switch (reg & 3) {
      case 0:
        this.duty = val >> 6;
        this.loop = !!(val & 0x20);
        this.constVol = !!(val & 0x10);
        this.volume = val & 0x0f;
        break;
      case 1:
        this.sweepEn = !!(val & 0x80);
        this.sweepP = (val >> 4) & 7;
        this.sweepN = !!(val & 8);
        this.sweepS = val & 7;
        this.sweepReload = true;
        break;
      case 2:
        this.period = (this.period & 0x700) | val;
        break;
      case 3:
        this.period = (this.period & 0xff) | ((val & 7) << 8);
        this.seq = 0;
        if (this.enabled) this.length = LENGTH[val >> 3];
        this.envStart = true;
        break;
    }
  };
  Pulse.prototype.clockTimer = function () {
    if (this.timer === 0) {
      this.timer = this.period;
      this.seq = (this.seq + 1) & 7;
    } else this.timer--;
  };
  Pulse.prototype.clockEnvelope = function () {
    if (this.envStart) {
      this.envStart = false;
      this.envVol = 15;
      this.envDiv = this.volume;
    } else if (this.envDiv === 0) {
      this.envDiv = this.volume;
      if (this.envVol > 0) this.envVol--;
      else if (this.loop) this.envVol = 15;
    } else this.envDiv--;
  };
  Pulse.prototype.clockLength = function () {
    if (!this.loop && this.length > 0) this.length--;
  };
  Pulse.prototype.clockSweep = function () {
    const change = this.period >> this.sweepS;
    let target = this.sweepN ? this.period - change - (this.ch === 0 ? 1 : 0) : this.period + change;
    if (target < 0) target = 0;
    const mute = this.period < 8 || target > 0x7ff;
    if (this.sweepDiv === 0 && this.sweepEn && this.sweepS > 0 && !mute) this.period = target & 0x7ff;
    if (this.sweepDiv === 0 || this.sweepReload) {
      this.sweepDiv = this.sweepP;
      this.sweepReload = false;
    } else this.sweepDiv--;
    return mute;
  };
  Pulse.prototype.out = function () {
    if (!this.enabled || this.length === 0 || this.period < 8) return 0;
    if (!DUTY[this.duty][this.seq]) return 0;
    return this.constVol ? this.volume : this.envVol;
  };

  function Triangle() {
    this.enabled = false;
    this.length = 0;
    this.timer = 0;
    this.period = 0;
    this.seq = 0;
    this.lin = 0;
    this.linReload = 0;
    this.linCtrl = false;
    this.reloadF = false;
  }
  Triangle.prototype.write = function (reg, val) {
    switch (reg & 3) {
      case 0:
        this.linCtrl = !!(val & 0x80);
        this.linReload = val & 0x7f;
        break;
      case 2:
        this.period = (this.period & 0x700) | val;
        break;
      case 3:
        this.period = (this.period & 0xff) | ((val & 7) << 8);
        if (this.enabled) this.length = LENGTH[val >> 3];
        this.reloadF = true;
        break;
    }
  };
  Triangle.prototype.clockTimer = function () {
    if (this.timer === 0) {
      this.timer = this.period;
      if (this.length > 0 && this.lin > 0) this.seq = (this.seq + 1) & 31;
    } else this.timer--;
  };
  Triangle.prototype.clockLinear = function () {
    if (this.reloadF) this.lin = this.linReload;
    else if (this.lin > 0) this.lin--;
    if (!this.linCtrl) this.reloadF = false;
  };
  Triangle.prototype.clockLength = function () {
    if (!this.linCtrl && this.length > 0) this.length--;
  };
  Triangle.prototype.out = function () {
    if (!this.enabled || this.length === 0 || this.lin === 0 || this.period < 2) return 0;
    return TRI_SEQ[this.seq];
  };

  function Noise() {
    this.enabled = false;
    this.length = 0;
    this.timer = 0;
    this.period = 4;
    this.shift = 1;
    this.mode = false;
    this.envStart = false;
    this.envVol = 0;
    this.envDiv = 0;
    this.constVol = false;
    this.volume = 0;
    this.loop = false;
  }
  Noise.prototype.write = function (reg, val) {
    switch (reg & 3) {
      case 0:
        this.loop = !!(val & 0x20);
        this.constVol = !!(val & 0x10);
        this.volume = val & 0x0f;
        break;
      case 2:
        this.mode = !!(val & 0x80);
        this.period = NOISE_P[val & 0x0f];
        break;
      case 3:
        if (this.enabled) this.length = LENGTH[val >> 3];
        this.envStart = true;
        break;
    }
  };
  Noise.prototype.clockTimer = function () {
    if (this.timer === 0) {
      this.timer = this.period;
      const b = this.mode ? 6 : 1;
      const bit = (this.shift ^ (this.shift >> b)) & 1;
      this.shift = (this.shift >> 1) | (bit << 14);
    } else this.timer--;
  };
  Noise.prototype.clockEnvelope = function () {
    if (this.envStart) {
      this.envStart = false;
      this.envVol = 15;
      this.envDiv = this.volume;
    } else if (this.envDiv === 0) {
      this.envDiv = this.volume;
      if (this.envVol > 0) this.envVol--;
      else if (this.loop) this.envVol = 15;
    } else this.envDiv--;
  };
  Noise.prototype.clockLength = function () {
    if (!this.loop && this.length > 0) this.length--;
  };
  Noise.prototype.out = function () {
    if (!this.enabled || this.length === 0 || (this.shift & 1)) return 0;
    return this.constVol ? this.volume : this.envVol;
  };

  function APU(nes) {
    this.nes = nes;
    this.p1 = new Pulse(); this.p1.ch = 0;
    this.p2 = new Pulse(); this.p2.ch = 1;
    this.tri = new Triangle();
    this.noi = new Noise();
    this.cycles = 0;
    this.frame = 0;
    this.mode5 = false;
    this.irqInhibit = false;
    this.frameIrq = false;
    this.sampleBuf = new Float32Array(8192);
    this.sHead = 0;
    this.sTail = 0;
    this.sAcc = 0;
    this.sHold = 0;
    this.cpuRate = 1789773;
    this.outRate = 44100;
    this.sPeriod = this.cpuRate / this.outRate;
  }

  APU.prototype.reset = function () {
    this.write(0x15, 0);
    this.cycles = 0;
    this.frame = 0;
    this.frameIrq = false;
    this.sHead = this.sTail = 0;
  };

  APU.prototype.read = function (addr) {
    if (addr === 0x4015) {
      let r = 0;
      if (this.p1.length > 0) r |= 1;
      if (this.p2.length > 0) r |= 2;
      if (this.tri.length > 0) r |= 4;
      if (this.noi.length > 0) r |= 8;
      if (this.frameIrq) r |= 0x40;
      this.frameIrq = false;
      return r;
    }
    return 0;
  };

  APU.prototype.write = function (addr, val) {
    switch (addr) {
      case 0x4000: case 0x4001: case 0x4002: case 0x4003: this.p1.write(addr, val); break;
      case 0x4004: case 0x4005: case 0x4006: case 0x4007: this.p2.write(addr, val); break;
      case 0x4008: case 0x400a: case 0x400b: this.tri.write(addr, val); break;
      case 0x400c: case 0x400e: case 0x400f: this.noi.write(addr, val); break;
      case 0x4015:
        this.p1.enabled = !!(val & 1); if (!this.p1.enabled) this.p1.length = 0;
        this.p2.enabled = !!(val & 2); if (!this.p2.enabled) this.p2.length = 0;
        this.tri.enabled = !!(val & 4); if (!this.tri.enabled) this.tri.length = 0;
        this.noi.enabled = !!(val & 8); if (!this.noi.enabled) this.noi.length = 0;
        break;
      case 0x4017:
        this.mode5 = !!(val & 0x80);
        this.irqInhibit = !!(val & 0x40);
        if (this.irqInhibit) this.frameIrq = false;
        this.frame = 0;
        if (this.mode5) this.clockFrame(true);
        break;
    }
  };

  APU.prototype.clockEnvelope = function () {
    this.p1.clockEnvelope();
    this.p2.clockEnvelope();
    this.noi.clockEnvelope();
    this.tri.clockLinear();
  };
  APU.prototype.clockLength = function () {
    this.p1.clockLength(); this.p1.clockSweep();
    this.p2.clockLength(); this.p2.clockSweep();
    this.tri.clockLength();
    this.noi.clockLength();
  };
  APU.prototype.clockFrame = function (forceLen) {
    // 4-step: env on 0-3, len on 1,3; irq on 3
    // 5-step: env on 0,1,2,4; len on 1,4
    if (this.mode5) {
      this.clockEnvelope();
      if (forceLen || this.frame === 1 || this.frame === 4) this.clockLength();
    } else {
      this.clockEnvelope();
      if (this.frame === 1 || this.frame === 3) this.clockLength();
      if (this.frame === 3 && !this.irqInhibit) this.frameIrq = true;
    }
  };

  APU.prototype.mix = function () {
    const p = this.p1.out() + this.p2.out();
    const t = this.tri.out();
    const n = this.noi.out();
    const pulse = p ? 95.88 / (8128 / p + 100) : 0;
    const tn = 159.79 / (1 / ((t / 8227) + (n / 12241)) + 100);
    return (pulse + tn) * 0.7;
  };

  APU.prototype.step = function (cpuCycles) {
    for (let i = 0; i < cpuCycles; i++) {
      this.cycles++;
      if (this.cycles & 1) {
        this.p1.clockTimer();
        this.p2.clockTimer();
        this.noi.clockTimer();
      }
      this.tri.clockTimer();

      // quarter frame ~ 7457 cpu cycles
      if (this.cycles % 7457 === 0) {
        this.clockFrame(false);
        this.frame = this.mode5 ? (this.frame + 1) % 5 : (this.frame + 1) & 3;
      }

      this.sAcc++;
      if (this.sAcc >= this.sPeriod) {
        this.sAcc -= this.sPeriod;
        const s = this.mix();
        const next = (this.sHead + 1) & 8191;
        if (next !== this.sTail) {
          this.sampleBuf[this.sHead] = s;
          this.sHead = next;
        }
        this.sHold = s;
      }
    }
    this.nes.cpu.irq = this.nes.cpu.irq || (this.frameIrq && !this.irqInhibit);
  };

  APU.prototype.pullSample = function () {
    if (this.sTail === this.sHead) return this.sHold;
    const s = this.sampleBuf[this.sTail];
    this.sTail = (this.sTail + 1) & 8191;
    return s;
  };

  g.NesAPU = APU;
})(typeof window !== "undefined" ? window : globalThis);
