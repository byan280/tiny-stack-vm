import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Tiny stack VM: 32-bit wrap, 256 stack, 64 returns, 256 mem, 10 traps.

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR || "/input";
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || "/output";

function runProgram(prog: Buffer, input: Buffer): { bytes: number[]; code: number } {
  const stack = new Int32Array(256), ret = new Int32Array(64), mem = new Int32Array(256);
  const bytes: number[] = [];
  let sp = 0, rp = 0, pc = 0, steps = 0, nextIn = 0, outLen = 0;

  const fail = (code: number) => ({ bytes, code });

  for (;;) {
    if (steps === 1000000) return fail(10);
    if (pc < 0 || pc >= prog.length) return fail(9);
    const op = prog[pc];
    let imm: number;
    if (op === 1) imm = 1;
    else if (op === 2) imm = 4;
    else if (op >= 0x30 && op <= 0x33) imm = 2;
    else if (op <= 7 || (op >= 0x10 && op <= 0x22) || op === 0x34 || op === 0x40 || op === 0x41 || (op >= 0x50 && op <= 0x53)) imm = 0;
    else return fail(5);
    if (pc + 1 + imm > prog.length) return fail(9);
    steps++;
    const next = pc + 1 + imm;

    switch (op) {
      case 0x00:
        return fail(0);
      case 0x01: {
        if (sp === 256) return fail(3);
        let v = prog[pc + 1];
        if (v >= 128) v -= 256;
        stack[sp++] = v;
        pc = next;
        break;
      }
      case 0x02: {
        if (sp === 256) return fail(3);
        stack[sp++] = prog[pc + 1] | (prog[pc + 2] << 8) | (prog[pc + 3] << 16) | (prog[pc + 4] << 24);
        pc = next;
        break;
      }
      case 0x03:
        if (sp < 1) return fail(2);
        sp--;
        pc = next;
        break;
      case 0x04:
        if (sp < 1) return fail(2);
        if (sp === 256) return fail(3);
        stack[sp] = stack[sp - 1];
        sp++;
        pc = next;
        break;
      case 0x05: {
        if (sp < 2) return fail(2);
        const t = stack[sp - 1];
        stack[sp - 1] = stack[sp - 2];
        stack[sp - 2] = t;
        pc = next;
        break;
      }
      case 0x06:
        if (sp < 2) return fail(2);
        if (sp === 256) return fail(3);
        stack[sp] = stack[sp - 2];
        sp++;
        pc = next;
        break;
      case 0x07: {
        if (sp < 3) return fail(2);
        const a = stack[sp - 3];
        stack[sp - 3] = stack[sp - 2];
        stack[sp - 2] = stack[sp - 1];
        stack[sp - 1] = a;
        pc = next;
        break;
      }
      case 0x10:
      case 0x11:
      case 0x12:
      case 0x13:
      case 0x14:
      case 0x15:
      case 0x16:
      case 0x18:
      case 0x19:
      case 0x1a:
      case 0x1c:
      case 0x1d:
      case 0x1e:
      case 0x20:
      case 0x21:
      case 0x22: {
        if (sp < 2) return fail(2);
        const b = stack[sp - 1];
        sp--;
        const a = stack[sp - 1];
        if ((op === 0x13 || op === 0x14 || op === 0x15 || op === 0x16) && b === 0)
          return fail(4);
        let r: number;
        if (op === 0x10) r = (a + b) | 0; else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b); else if (op === 0x13) r = (a / b) | 0;
        else if (op === 0x14) r = (a % b) | 0; else if (op === 0x15) r = ((a >>> 0) / (b >>> 0)) | 0;
        else if (op === 0x16) r = ((a >>> 0) % (b >>> 0)) | 0; else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b; else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31); else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0; else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0; else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        stack[sp - 1] = r;
        pc = next;
        break;
      }
      case 0x17:
      case 0x1b: {
        if (sp < 1) return fail(2);
        stack[sp - 1] = op === 0x17 ? -stack[sp - 1] | 0 : ~stack[sp - 1];
        pc = next;
        break;
      }
      case 0x30:
      case 0x31:
      case 0x32: {
        const off = ((prog[pc + 1] | (prog[pc + 2] << 8)) << 16) >> 16;
        if (op === 0x30) {
          pc = next + off;
          break;
        }
        if (sp < 1) return fail(2);
        const v = stack[--sp];
        if ((op === 0x31 && v === 0) || (op === 0x32 && v !== 0)) pc = next + off;
        else pc = next;
        break;
      }
      case 0x33: {
        if (rp === 64) return fail(7);
        ret[rp++] = next;
        pc = prog[pc + 1] | (prog[pc + 2] << 8);
        break;
      }
      case 0x34:
        if (rp === 0) return fail(8);
        pc = ret[--rp];
        break;
      case 0x40: {
        if (sp < 1) return fail(2);
        const addr = stack[sp - 1];
        if (addr < 0 || addr > 255) return fail(6);
        stack[sp - 1] = mem[addr];
        pc = next;
        break;
      }
      case 0x41: {
        if (sp < 2) return fail(2);
        const addr = stack[sp - 1];
        const v = stack[sp - 2];
        sp -= 2;
        if (addr < 0 || addr > 255) return fail(6);
        mem[addr] = v;
        pc = next;
        break;
      }
      case 0x50: {
        if (sp < 1) return fail(2);
        const s = String(stack[--sp]);
        if (outLen + s.length > 65536) return fail(11);
        for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
        outLen += s.length;
        pc = next;
        break;
      }
      case 0x51: {
        if (sp < 1) return fail(2);
        if (outLen + 1 > 65536) return fail(11);
        bytes.push(stack[--sp] & 255);
        outLen++;
        pc = next;
        break;
      }
      case 0x52:
        if (sp === 256) return fail(3);
        stack[sp++] = nextIn < input.length ? input[nextIn++] : -1;
        pc = next;
        break;
      case 0x53: {
        if (sp < 1) return fail(2);
        return fail(stack[--sp] & 255);
      }
    }
  }
}

const ids = readdirSync(INPUT_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

const rd = (p: string): Buffer => {
  try {
    return readFileSync(p);
  } catch {
    return Buffer.alloc(0);
  }
};

for (const id of ids) {
  const dir = join(INPUT_DIR, id);
  const { bytes, code } = runProgram(rd(join(dir, "program.bin")), rd(join(dir, "input.bin")));
  const d = join(OUTPUT_DIR, id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "stdout.bin"), Buffer.from(bytes));
  writeFileSync(join(d, "exit.txt"), String(code));
}
