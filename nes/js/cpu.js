/* 6502 CPU — official opcodes + common unofficials used by NES games. */
(function (g) {
  "use strict";

  const FN = 0x80, FV = 0x40, FU = 0x20, FB = 0x10, FD = 0x08, FI = 0x04, FZ = 0x02, FC = 0x01;

  function CPU(bus) {
    this.bus = bus;
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xfd;
    this.pc = 0;
    this.p = 0x24;
    this.cycles = 0;
    this.stall = 0;
    this.nmi = false;
    this.irq = false;
    this._nmiEdge = false;
  }

  CPU.prototype.reset = function () {
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xfd;
    this.p = 0x24;
    this.pc = this.read16(0xfffc);
    this.cycles = 7;
    this.stall = 0;
    this.nmi = false;
    this.irq = false;
    this._nmiEdge = false;
  };

  CPU.prototype.read = function (a) { return this.bus.cpuRead(a & 0xffff) & 0xff; };
  CPU.prototype.write = function (a, v) { this.bus.cpuWrite(a & 0xffff, v & 0xff); };
  CPU.prototype.read16 = function (a) {
    return this.read(a) | (this.read((a + 1) & 0xffff) << 8);
  };
  CPU.prototype.read16Bug = function (a) {
    const lo = this.read(a);
    const hi = this.read((a & 0xff00) | ((a + 1) & 0xff));
    return lo | (hi << 8);
  };

  CPU.prototype.push = function (v) {
    this.write(0x100 + this.sp, v);
    this.sp = (this.sp - 1) & 0xff;
  };
  CPU.prototype.pop = function () {
    this.sp = (this.sp + 1) & 0xff;
    return this.read(0x100 + this.sp);
  };

  CPU.prototype.getC = function () { return this.p & FC ? 1 : 0; };
  CPU.prototype.setZN = function (v) {
    this.p = (this.p & ~(FZ | FN)) | (v & 0xff ? 0 : FZ) | (v & FN);
  };
  CPU.prototype.setC = function (on) { this.p = on ? (this.p | FC) : (this.p & ~FC); };
  CPU.prototype.setV = function (on) { this.p = on ? (this.p | FV) : (this.p & ~FV); };
  CPU.prototype.setI = function (on) { this.p = on ? (this.p | FI) : (this.p & ~FI); };
  CPU.prototype.setD = function (on) { this.p = on ? (this.p | FD) : (this.p & ~FD); };

  CPU.prototype.triggerNmi = function () { this._nmiEdge = true; };

  CPU.prototype._pushP = function (brk) {
    let p = this.p | FU;
    p = brk ? (p | FB) : (p & ~FB);
    this.push(p);
  };

  CPU.prototype._takeInterrupt = function (vec, brk) {
    this.push(this.pc >> 8);
    this.push(this.pc & 0xff);
    this._pushP(brk);
    this.setI(true);
    this.pc = this.read16(vec);
    this.cycles += 7;
  };

  CPU.prototype.step = function () {
    if (this.stall > 0) {
      this.stall--;
      this.cycles++;
      return 1;
    }
    if (this._nmiEdge) {
      this._nmiEdge = false;
      this._takeInterrupt(0xfffa, false);
      return 7;
    }
    if (this.irq && !(this.p & FI)) {
      this._takeInterrupt(0xfffe, false);
      return 7;
    }

    const op = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    const start = this.cycles;
    this._exec(op);
    let used = this.cycles - start;
    if (used <= 0) {
      this.cycles += 2;
      used = 2;
    }
    return used;
  };

  function pageCrossed(a, b) { return (a & 0xff00) !== (b & 0xff00); }

  CPU.prototype._exec = function (op) {
    const C = this;
    let addr, extra = 0, val, t, lo, hi;

    const imm = function () { const a = C.pc; C.pc = (C.pc + 1) & 0xffff; return a; };
    const zp = function () { const a = C.read(C.pc); C.pc = (C.pc + 1) & 0xffff; return a; };
    const zpx = function () { return (C.read(C.pc++) + C.x) & 0xff; };
    const zpy = function () { return (C.read(C.pc++) + C.y) & 0xff; };
    const abs = function () { const a = C.read16(C.pc); C.pc = (C.pc + 2) & 0xffff; return a; };
    const absx = function (pen) {
      const base = C.read16(C.pc); C.pc = (C.pc + 2) & 0xffff;
      const a = (base + C.x) & 0xffff;
      if (pen && pageCrossed(base, a)) extra = 1;
      return a;
    };
    const absy = function (pen) {
      const base = C.read16(C.pc); C.pc = (C.pc + 2) & 0xffff;
      const a = (base + C.y) & 0xffff;
      if (pen && pageCrossed(base, a)) extra = 1;
      return a;
    };
    const indx = function () {
      const z = (C.read(C.pc++) + C.x) & 0xff;
      return C.read(z) | (C.read((z + 1) & 0xff) << 8);
    };
    const indy = function (pen) {
      const z = C.read(C.pc++);
      const base = C.read(z) | (C.read((z + 1) & 0xff) << 8);
      const a = (base + C.y) & 0xffff;
      if (pen && pageCrossed(base, a)) extra = 1;
      return a;
    };
    const rel = function () {
      let off = C.read(C.pc++);
      if (off & 0x80) off -= 256;
      return off;
    };

    const lda = function (a) { C.a = C.read(a); C.setZN(C.a); };
    const ldx = function (a) { C.x = C.read(a); C.setZN(C.x); };
    const ldy = function (a) { C.y = C.read(a); C.setZN(C.y); };
    const sta = function (a) { C.write(a, C.a); };
    const stx = function (a) { C.write(a, C.x); };
    const sty = function (a) { C.write(a, C.y); };
    const adc = function (a) {
      const m = C.read(a);
      t = C.a + m + C.getC();
      C.setC(t > 0xff);
      C.setV(!!((~(C.a ^ m) & (C.a ^ t)) & 0x80));
      C.a = t & 0xff;
      C.setZN(C.a);
    };
    const sbc = function (a) {
      const m = C.read(a) ^ 0xff;
      t = C.a + m + C.getC();
      C.setC(t > 0xff);
      C.setV(!!((~(C.a ^ m) & (C.a ^ t)) & 0x80));
      C.a = t & 0xff;
      C.setZN(C.a);
    };
    const anda = function (a) { C.a &= C.read(a); C.setZN(C.a); };
    const ora = function (a) { C.a |= C.read(a); C.setZN(C.a); };
    const eor = function (a) { C.a ^= C.read(a); C.setZN(C.a); };
    const cmpx = function (reg, a) {
      t = (reg - C.read(a)) & 0x1ff;
      C.setC(reg >= C.read ? (reg >= (t === ((reg - (t & 0xff)) & 0xff) ? C.read(a) : C.read(a))) : false);
    };
    const cmp = function (reg, a) {
      const m = C.read(a);
      C.setC(reg >= m);
      C.setZN((reg - m) & 0xff);
    };
    const bit = function (a) {
      val = C.read(a);
      C.p = (C.p & ~(FZ | FV | FN)) | (val & (FV | FN)) | ((C.a & val) ? 0 : FZ);
    };
    const aslM = function (a) {
      val = C.read(a);
      C.setC(val & 0x80);
      val = (val << 1) & 0xff;
      C.write(a, val);
      C.setZN(val);
    };
    const lsrM = function (a) {
      val = C.read(a);
      C.setC(val & 1);
      val >>= 1;
      C.write(a, val);
      C.setZN(val);
    };
    const rolM = function (a) {
      val = C.read(a);
      const c = C.getC();
      C.setC(val & 0x80);
      val = ((val << 1) | c) & 0xff;
      C.write(a, val);
      C.setZN(val);
    };
    const rorM = function (a) {
      val = C.read(a);
      const c = C.getC();
      C.setC(val & 1);
      val = (val >> 1) | (c << 7);
      C.write(a, val);
      C.setZN(val);
    };
    const inc = function (a) { val = (C.read(a) + 1) & 0xff; C.write(a, val); C.setZN(val); };
    const dec = function (a) { val = (C.read(a) - 1) & 0xff; C.write(a, val); C.setZN(val); };
    const branch = function (cond) {
      const off = rel();
      if (cond) {
        extra += 1;
        t = (C.pc + off) & 0xffff;
        if (pageCrossed(C.pc, t)) extra += 1;
        C.pc = t;
      }
    };

    switch (op) {
      // official
      case 0x00: // BRK
        C.pc = (C.pc + 1) & 0xffff;
        C._takeInterrupt(0xfffe, true);
        return;
      case 0x01: ora(indx()); C.cycles += 6; break;
      case 0x05: ora(zp()); C.cycles += 3; break;
      case 0x06: aslM(zp()); C.cycles += 5; break;
      case 0x08: C._pushP(true); C.cycles += 3; break;
      case 0x09: C.a |= C.read(imm()); C.setZN(C.a); C.cycles += 2; break;
      case 0x0a:
        C.setC(C.a & 0x80); C.a = (C.a << 1) & 0xff; C.setZN(C.a); C.cycles += 2; break;
      case 0x0d: ora(abs()); C.cycles += 4; break;
      case 0x0e: aslM(abs()); C.cycles += 6; break;
      case 0x10: branch(!(C.p & FN)); C.cycles += 2 + extra; break;
      case 0x11: ora(indy(true)); C.cycles += 5 + extra; break;
      case 0x15: ora(zpx()); C.cycles += 4; break;
      case 0x16: aslM(zpx()); C.cycles += 6; break;
      case 0x18: C.setC(false); C.cycles += 2; break;
      case 0x19: ora(absy(true)); C.cycles += 4 + extra; break;
      case 0x1d: ora(absx(true)); C.cycles += 4 + extra; break;
      case 0x1e: aslM(absx(false)); C.cycles += 7; break;
      case 0x20: // JSR
        addr = abs();
        t = (C.pc - 1) & 0xffff;
        C.push(t >> 8); C.push(t & 0xff);
        C.pc = addr;
        C.cycles += 6;
        break;
      case 0x21: anda(indx()); C.cycles += 6; break;
      case 0x24: bit(zp()); C.cycles += 3; break;
      case 0x25: anda(zp()); C.cycles += 3; break;
      case 0x26: rolM(zp()); C.cycles += 5; break;
      case 0x28: {
        const p = C.pop();
        C.p = (p & ~FB) | FU;
        C.cycles += 4;
        break;
      }
      case 0x29: C.a &= C.read(imm()); C.setZN(C.a); C.cycles += 2; break;
      case 0x2a: {
        const c = C.getC();
        C.setC(C.a & 0x80);
        C.a = ((C.a << 1) | c) & 0xff;
        C.setZN(C.a);
        C.cycles += 2;
        break;
      }
      case 0x2c: bit(abs()); C.cycles += 4; break;
      case 0x2d: anda(abs()); C.cycles += 4; break;
      case 0x2e: rolM(abs()); C.cycles += 6; break;
      case 0x30: branch(C.p & FN); C.cycles += 2 + extra; break;
      case 0x31: anda(indy(true)); C.cycles += 5 + extra; break;
      case 0x35: anda(zpx()); C.cycles += 4; break;
      case 0x36: rolM(zpx()); C.cycles += 6; break;
      case 0x38: C.setC(true); C.cycles += 2; break;
      case 0x39: anda(absy(true)); C.cycles += 4 + extra; break;
      case 0x3d: anda(absx(true)); C.cycles += 4 + extra; break;
      case 0x3e: rolM(absx(false)); C.cycles += 7; break;
      case 0x40: // RTI
        C.p = (C.pop() & ~FB) | FU;
        lo = C.pop(); hi = C.pop();
        C.pc = lo | (hi << 8);
        C.cycles += 6;
        break;
      case 0x41: eor(indx()); C.cycles += 6; break;
      case 0x45: eor(zp()); C.cycles += 3; break;
      case 0x46: lsrM(zp()); C.cycles += 5; break;
      case 0x48: C.push(C.a); C.cycles += 3; break;
      case 0x49: C.a ^= C.read(imm()); C.setZN(C.a); C.cycles += 2; break;
      case 0x4a:
        C.setC(C.a & 1); C.a >>= 1; C.setZN(C.a); C.cycles += 2; break;
      case 0x4c: C.pc = abs(); C.cycles += 3; break;
      case 0x4d: eor(abs()); C.cycles += 4; break;
      case 0x4e: lsrM(abs()); C.cycles += 6; break;
      case 0x50: branch(!(C.p & FV)); C.cycles += 2 + extra; break;
      case 0x51: eor(indy(true)); C.cycles += 5 + extra; break;
      case 0x55: eor(zpx()); C.cycles += 4; break;
      case 0x56: lsrM(zpx()); C.cycles += 6; break;
      case 0x58: C.setI(false); C.cycles += 2; break;
      case 0x59: eor(absy(true)); C.cycles += 4 + extra; break;
      case 0x5d: eor(absx(true)); C.cycles += 4 + extra; break;
      case 0x5e: lsrM(absx(false)); C.cycles += 7; break;
      case 0x60: // RTS
        lo = C.pop(); hi = C.pop();
        C.pc = ((lo | (hi << 8)) + 1) & 0xffff;
        C.cycles += 6;
        break;
      case 0x61: adc(indx()); C.cycles += 6; break;
      case 0x65: adc(zp()); C.cycles += 3; break;
      case 0x66: rorM(zp()); C.cycles += 5; break;
      case 0x68: C.a = C.pop(); C.setZN(C.a); C.cycles += 4; break;
      case 0x69: adc(imm()); C.cycles += 2; break;
      case 0x6a: {
        const c = C.getC();
        C.setC(C.a & 1);
        C.a = (C.a >> 1) | (c << 7);
        C.setZN(C.a);
        C.cycles += 2;
        break;
      }
      case 0x6c: {
        addr = abs();
        C.pc = C.read16Bug(addr);
        C.cycles += 5;
        break;
      }
      case 0x6d: adc(abs()); C.cycles += 4; break;
      case 0x6e: rorM(abs()); C.cycles += 6; break;
      case 0x70: branch(C.p & FV); C.cycles += 2 + extra; break;
      case 0x71: adc(indy(true)); C.cycles += 5 + extra; break;
      case 0x75: adc(zpx()); C.cycles += 4; break;
      case 0x76: rorM(zpx()); C.cycles += 6; break;
      case 0x78: C.setI(true); C.cycles += 2; break;
      case 0x79: adc(absy(true)); C.cycles += 4 + extra; break;
      case 0x7d: adc(absx(true)); C.cycles += 4 + extra; break;
      case 0x7e: rorM(absx(false)); C.cycles += 7; break;
      case 0x81: sta(indx()); C.cycles += 6; break;
      case 0x84: sty(zp()); C.cycles += 3; break;
      case 0x85: sta(zp()); C.cycles += 3; break;
      case 0x86: stx(zp()); C.cycles += 3; break;
      case 0x88: C.y = (C.y - 1) & 0xff; C.setZN(C.y); C.cycles += 2; break;
      case 0x8a: C.a = C.x; C.setZN(C.a); C.cycles += 2; break;
      case 0x8c: sty(abs()); C.cycles += 4; break;
      case 0x8d: sta(abs()); C.cycles += 4; break;
      case 0x8e: stx(abs()); C.cycles += 4; break;
      case 0x90: branch(!(C.p & FC)); C.cycles += 2 + extra; break;
      case 0x91: sta(indy(false)); C.cycles += 6; break;
      case 0x94: sty(zpx()); C.cycles += 4; break;
      case 0x95: sta(zpx()); C.cycles += 4; break;
      case 0x96: stx(zpy()); C.cycles += 4; break;
      case 0x98: C.a = C.y; C.setZN(C.a); C.cycles += 2; break;
      case 0x99: sta(absy(false)); C.cycles += 5; break;
      case 0x9a: C.sp = C.x; C.cycles += 2; break;
      case 0x9d: sta(absx(false)); C.cycles += 5; break;
      case 0xa0: C.y = C.read(imm()); C.setZN(C.y); C.cycles += 2; break;
      case 0xa1: lda(indx()); C.cycles += 6; break;
      case 0xa2: C.x = C.read(imm()); C.setZN(C.x); C.cycles += 2; break;
      case 0xa4: ldy(zp()); C.cycles += 3; break;
      case 0xa5: lda(zp()); C.cycles += 3; break;
      case 0xa6: ldx(zp()); C.cycles += 3; break;
      case 0xa8: C.y = C.a; C.setZN(C.y); C.cycles += 2; break;
      case 0xa9: C.a = C.read(imm()); C.setZN(C.a); C.cycles += 2; break;
      case 0xaa: C.x = C.a; C.setZN(C.x); C.cycles += 2; break;
      case 0xac: ldy(abs()); C.cycles += 4; break;
      case 0xad: lda(abs()); C.cycles += 4; break;
      case 0xae: ldx(abs()); C.cycles += 4; break;
      case 0xb0: branch(C.p & FC); C.cycles += 2 + extra; break;
      case 0xb1: lda(indy(true)); C.cycles += 5 + extra; break;
      case 0xb4: ldy(zpx()); C.cycles += 4; break;
      case 0xb5: lda(zpx()); C.cycles += 4; break;
      case 0xb6: ldx(zpy()); C.cycles += 4; break;
      case 0xb8: C.setV(false); C.cycles += 2; break;
      case 0xb9: lda(absy(true)); C.cycles += 4 + extra; break;
      case 0xba: C.x = C.sp; C.setZN(C.x); C.cycles += 2; break;
      case 0xbc: ldy(absx(true)); C.cycles += 4 + extra; break;
      case 0xbd: lda(absx(true)); C.cycles += 4 + extra; break;
      case 0xbe: ldx(absy(true)); C.cycles += 4 + extra; break;
      case 0xc0: cmp(C.y, imm()); C.cycles += 2; break;
      case 0xc1: cmp(C.a, indx()); C.cycles += 6; break;
      case 0xc4: cmp(C.y, zp()); C.cycles += 3; break;
      case 0xc5: cmp(C.a, zp()); C.cycles += 3; break;
      case 0xc6: dec(zp()); C.cycles += 5; break;
      case 0xc8: C.y = (C.y + 1) & 0xff; C.setZN(C.y); C.cycles += 2; break;
      case 0xc9: cmp(C.a, imm()); C.cycles += 2; break;
      case 0xca: C.x = (C.x - 1) & 0xff; C.setZN(C.x); C.cycles += 2; break;
      case 0xcc: cmp(C.y, abs()); C.cycles += 4; break;
      case 0xcd: cmp(C.a, abs()); C.cycles += 4; break;
      case 0xce: dec(abs()); C.cycles += 6; break;
      case 0xd0: branch(!(C.p & FZ)); C.cycles += 2 + extra; break;
      case 0xd1: cmp(C.a, indy(true)); C.cycles += 5 + extra; break;
      case 0xd5: cmp(C.a, zpx()); C.cycles += 4; break;
      case 0xd6: dec(zpx()); C.cycles += 6; break;
      case 0xd8: C.setD(false); C.cycles += 2; break;
      case 0xd9: cmp(C.a, absy(true)); C.cycles += 4 + extra; break;
      case 0xdd: cmp(C.a, absx(true)); C.cycles += 4 + extra; break;
      case 0xde: dec(absx(false)); C.cycles += 7; break;
      case 0xe0: cmp(C.x, imm()); C.cycles += 2; break;
      case 0xe1: sbc(indx()); C.cycles += 6; break;
      case 0xe4: cmp(C.x, zp()); C.cycles += 3; break;
      case 0xe5: sbc(zp()); C.cycles += 3; break;
      case 0xe6: inc(zp()); C.cycles += 5; break;
      case 0xe8: C.x = (C.x + 1) & 0xff; C.setZN(C.x); C.cycles += 2; break;
      case 0xe9: sbc(imm()); C.cycles += 2; break;
      case 0xea: C.cycles += 2; break;
      case 0xec: cmp(C.x, abs()); C.cycles += 4; break;
      case 0xed: sbc(abs()); C.cycles += 4; break;
      case 0xee: inc(abs()); C.cycles += 6; break;
      case 0xf0: branch(C.p & FZ); C.cycles += 2 + extra; break;
      case 0xf1: sbc(indy(true)); C.cycles += 5 + extra; break;
      case 0xf5: sbc(zpx()); C.cycles += 4; break;
      case 0xf6: inc(zpx()); C.cycles += 6; break;
      case 0xf8: C.setD(true); C.cycles += 2; break;
      case 0xf9: sbc(absy(true)); C.cycles += 4 + extra; break;
      case 0xfd: sbc(absx(true)); C.cycles += 4 + extra; break;
      case 0xfe: inc(absx(false)); C.cycles += 7; break;

      // unofficial used by many carts
      case 0x1a: case 0x3a: case 0x5a: case 0x7a: case 0xda: case 0xfa:
      case 0x80: case 0x82: case 0x89: case 0xc2: case 0xe2:
        C.pc = (C.pc + 1) & 0xffff; C.cycles += 2; break;
      case 0x04: case 0x44: case 0x64:
        C.pc = (C.pc + 1) & 0xffff; C.cycles += 3; break;
      case 0x14: case 0x34: case 0x54: case 0x74: case 0xd4: case 0xf4:
        C.pc = (C.pc + 1) & 0xffff; C.cycles += 4; break;
      case 0x0c:
        C.pc = (C.pc + 2) & 0xffff; C.cycles += 4; break;
      case 0x1c: case 0x3c: case 0x5c: case 0x7c: case 0xdc: case 0xfc:
        absx(true); C.cycles += 4 + extra; break;
      case 0xeb: sbc(imm()); C.cycles += 2; break;
      case 0xa3: C.a = C.x = C.read(indx()); C.setZN(C.a); C.cycles += 6; break;
      case 0xa7: C.a = C.x = C.read(zp()); C.setZN(C.a); C.cycles += 3; break;
      case 0xaf: C.a = C.x = C.read(abs()); C.setZN(C.a); C.cycles += 4; break;
      case 0xb3: C.a = C.x = C.read(indy(true)); C.setZN(C.a); C.cycles += 5 + extra; break;
      case 0xb7: C.a = C.x = C.read(zpy()); C.setZN(C.a); C.cycles += 4; break;
      case 0xbf: C.a = C.x = C.read(absy(true)); C.setZN(C.a); C.cycles += 4 + extra; break;
      case 0x83: C.write(indx(), C.a & C.x); C.cycles += 6; break;
      case 0x87: C.write(zp(), C.a & C.x); C.cycles += 3; break;
      case 0x8f: C.write(abs(), C.a & C.x); C.cycles += 4; break;
      case 0x97: C.write(zpy(), C.a & C.x); C.cycles += 4; break;
      case 0xc3: { addr = indx(); val = (C.read(addr) - 1) & 0xff; C.write(addr, val); cmp(C.a, addr); C.cycles += 8; break; }
      case 0xc7: { addr = zp(); val = (C.read(addr) - 1) & 0xff; C.write(addr, val); cmp(C.a, addr); C.cycles += 5; break; }
      case 0xcf: { addr = abs(); val = (C.read(addr) - 1) & 0xff; C.write(addr, val); cmp(C.a, addr); C.cycles += 6; break; }
      case 0xd3: { addr = indy(false); val = (C.read(addr) - 1) & 0xff; C.write(addr, val); cmp(C.a, addr); C.cycles += 8; break; }
      case 0xd7: { addr = zpx(); val = (C.read(addr) - 1) & 0xff; C.write(addr, val); cmp(C.a, addr); C.cycles += 6; break; }
      case 0xdb: { addr = absy(false); val = (C.read(addr) - 1) & 0xff; C.write(addr, val); cmp(C.a, addr); C.cycles += 7; break; }
      case 0xdf: { addr = absx(false); val = (C.read(addr) - 1) & 0xff; C.write(addr, val); cmp(C.a, addr); C.cycles += 7; break; }
      case 0xe3: { addr = indx(); val = (C.read(addr) + 1) & 0xff; C.write(addr, val); sbc(addr); C.cycles += 8; break; }
      case 0xe7: { addr = zp(); val = (C.read(addr) + 1) & 0xff; C.write(addr, val); sbc(addr); C.cycles += 5; break; }
      case 0xef: { addr = abs(); val = (C.read(addr) + 1) & 0xff; C.write(addr, val); sbc(addr); C.cycles += 6; break; }
      case 0xf3: { addr = indy(false); val = (C.read(addr) + 1) & 0xff; C.write(addr, val); sbc(addr); C.cycles += 8; break; }
      case 0xf7: { addr = zpx(); val = (C.read(addr) + 1) & 0xff; C.write(addr, val); sbc(addr); C.cycles += 6; break; }
      case 0xfb: { addr = absy(false); val = (C.read(addr) + 1) & 0xff; C.write(addr, val); sbc(addr); C.cycles += 7; break; }
      case 0xff: { addr = absx(false); val = (C.read(addr) + 1) & 0xff; C.write(addr, val); sbc(addr); C.cycles += 7; break; }
      case 0x03: { addr = indx(); val = C.read(addr); C.setC(val & 0x80); val = (val << 1) & 0xff; C.write(addr, val); C.a |= val; C.setZN(C.a); C.cycles += 8; break; }
      case 0x07: { addr = zp(); val = C.read(addr); C.setC(val & 0x80); val = (val << 1) & 0xff; C.write(addr, val); C.a |= val; C.setZN(C.a); C.cycles += 5; break; }
      default:
        C.cycles += 2;
        break;
    }
  };

  g.NesCPU = CPU;
})(typeof window !== "undefined" ? window : globalThis);
