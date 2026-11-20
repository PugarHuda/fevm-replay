"""Turns calls in tail position into tail calls in a WebAssembly module.

Fe's WebAssembly backend emits fevm's opcode dispatch, which is a chain of
tail calls natively (each handler calls the next), as plain `call`s. Each
opcode then takes a frame of the engine's stack, and a long run of opcodes
overflows it ("Maximum call stack size exceeded"). This rewrites a `call` to
`return_call` where nothing but leaving the function follows it: the call
is followed by `return`, by the function's end, or by `br`/`end` to a block
whose end leads only through more `end`s to `return` or the function's end.
Only calls from and to functions that return nothing are rewritten, so no
value has to flow through the blocks left. `call` (0x10) and `return_call`
(0x12) have the same immediate, so the module is patched in place: every
offset stays where it was.

    python web/tailcalls.py module.wasm module.manifest.json

rewrites the module in place and puts its new SHA-256 and size in the
manifest.
"""
import hashlib
import json
import sys


def uleb(b, i):
    r = s = 0
    while True:
        x = b[i]
        i += 1
        r |= (x & 0x7F) << s
        s += 7
        if x < 0x80:
            return r, i


def sleb(b, i):
    r = s = 0
    while True:
        x = b[i]
        i += 1
        r |= (x & 0x7F) << s
        s += 7
        if x < 0x80:
            if x & 0x40:
                r -= 1 << s
            return r, i


def blocktype(b, i):
    x = b[i]
    if x == 0x40 or x in (0x7F, 0x7E, 0x7D, 0x7C, 0x7B, 0x70, 0x6F):
        return i + 1
    _, i = sleb(b, i)
    return i


def memarg(b, i):
    align, i = uleb(b, i)
    if align & 0x40:  # multi-memory: a memory index follows
        _, i = uleb(b, i)
    _, i = uleb(b, i)
    return i


def decode(b, i, end):
    """Instructions of one body as (offset, opcode, immediate)."""
    out = []
    while i < end:
        at = i
        op = b[i]
        i += 1
        imm = None
        if op in (0x02, 0x03, 0x04):
            i = blocktype(b, i)
        elif op in (0x0C, 0x0D, 0x10, 0x12, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0xD2):
            imm, i = uleb(b, i)
        elif op == 0x0E:
            n, i = uleb(b, i)
            for _ in range(n + 1):
                _, i = uleb(b, i)
        elif op in (0x11, 0x13):
            _, i = uleb(b, i)
            _, i = uleb(b, i)
        elif op == 0x1C:
            n, i = uleb(b, i)
            i += n
        elif 0x28 <= op <= 0x3E:
            i = memarg(b, i)
        elif op in (0x3F, 0x40):
            _, i = uleb(b, i)
        elif op == 0x41:
            _, i = sleb(b, i)
        elif op == 0x42:
            _, i = sleb(b, i)
        elif op == 0x43:
            i += 4
        elif op == 0x44:
            i += 8
        elif op == 0xD0:
            i += 1
        elif op == 0xFC:
            sub, i = uleb(b, i)
            if sub in (8, 10, 12, 14):
                _, i = uleb(b, i)
                _, i = uleb(b, i)
            elif sub in (9, 11, 13, 15, 16, 17):
                _, i = uleb(b, i)
        elif op == 0xFD:
            raise SystemExit("SIMD instructions are not handled")
        elif op in (0x00, 0x01, 0x05, 0x0B, 0x0F, 0x1A, 0x1B, 0xD1) or 0x45 <= op <= 0xC4:
            pass
        else:
            raise SystemExit(f"opcode 0x{op:02x} at 0x{at:x} is not handled")
        out.append((at, op, imm))
    return out


def rewrite(b):
    b = bytearray(b)
    assert b[:4] == b"\0asm"
    i = 8
    types, imported, funcs, bodies = [], 0, [], []
    while i < len(b):
        sid = b[i]
        size, j = uleb(b, i + 1)
        end = j + size
        if sid == 1:  # types
            n, j = uleb(b, j)
            for _ in range(n):
                assert b[j] == 0x60
                np, j = uleb(b, j + 1)
                j += np
                nr, j = uleb(b, j)
                j += nr
                types.append(nr)
        elif sid == 2:  # imports
            n, j = uleb(b, j)
            for _ in range(n):
                ln, j = uleb(b, j)
                j += ln
                ln, j = uleb(b, j)
                j += ln
                kind = b[j]
                j += 1
                if kind == 0:
                    t, j = uleb(b, j)
                    funcs.append(t)
                    imported += 1
                elif kind == 1:
                    j += 1
                    flags, j = uleb(b, j + 0)
                    _, j = uleb(b, j)
                    if flags & 1:
                        _, j = uleb(b, j)
                elif kind == 2:
                    flags, j = uleb(b, j)
                    _, j = uleb(b, j)
                    if flags & 1:
                        _, j = uleb(b, j)
                elif kind == 3:
                    j += 2
                else:
                    raise SystemExit("unknown import kind")
        elif sid == 3:  # functions
            n, j = uleb(b, j)
            for _ in range(n):
                t, j = uleb(b, j)
                funcs.append(t)
        elif sid == 10:  # code
            n, j = uleb(b, j)
            for k in range(n):
                sz, j = uleb(b, j)
                start, body_end = j, j + sz
                nl, j = uleb(b, j)
                for _ in range(nl):
                    _, j = uleb(b, j)
                    j += 1
                bodies.append((imported + k, j, body_end))
                j = body_end
        i = end

    void = lambda f: types[funcs[f]] == 0
    patched = 0
    for f, start, end in bodies:
        if not void(f):
            continue
        ins = decode(b, start, end)
        # Each structured instruction's end (and an `if`'s `else`), and each
        # `end`'s opener.
        stack, match, kind = [], {}, {}
        for n, (_, op, _) in enumerate(ins):
            if op in (0x02, 0x03, 0x04):
                stack.append(n)
                kind[n] = op
            elif op == 0x05:
                match[("else", stack[-1])] = n
            elif op == 0x0B:
                if stack:
                    opener = stack.pop()
                    match[opener] = n
                    match[("opener", n)] = opener
        last = len(ins) - 1  # the function's own `end`

        def leaves(n):
            """Whether control at instruction `n` only leaves the function."""
            seen = 0
            while seen < 10000:
                seen += 1
                if n >= last:
                    return True
                op = ins[n][1]
                if op == 0x0F:
                    return True
                if op == 0x0B:
                    opener = match.get(("opener", n))
                    if opener is None:
                        return True
                    n += 1
                    continue
                if op == 0x05:  # the end of an `if`'s then-arm: go to the if's end
                    opener = next(o for o, e in match.items() if isinstance(o, tuple) and o[0] == "else" and e == n)[1]
                    n = match[opener]
                    continue
                return False
            return False

        def target_end(n, depth):
            """The instruction after which `br depth` at `n` continues."""
            open_ = []
            for m in range(n, -1, -1):
                op = ins[m][1]
                if op == 0x0B and m != n:
                    open_.append(m)
                elif op in (0x02, 0x03, 0x04):
                    if open_ and match.get(m) == open_[-1]:
                        open_.pop()
                        continue
                    if depth == 0:
                        if kind[m] == 0x03:
                            return None  # a loop: `br` goes back to its start
                        return match[m]
                    depth -= 1
            return last  # the function's body

        for n, (at, op, imm) in enumerate(ins):
            if op != 0x10 or not void(imm) or n + 1 > last:
                continue
            nxt = ins[n + 1]
            ok = False
            if nxt[1] == 0x0F:
                ok = True
            elif nxt[1] in (0x0B, 0x05):
                ok = leaves(n + 1)
            elif nxt[1] == 0x0C:
                e = target_end(n + 1, nxt[2])
                ok = e is not None and leaves(e)
            if ok:
                b[at] = 0x12
                patched += 1
    return bytes(b), patched


if __name__ == "__main__":
    module, manifest = sys.argv[1], sys.argv[2]
    out, patched = rewrite(open(module, "rb").read())
    open(module, "wb").write(out)
    doc = json.load(open(manifest))
    doc["module"]["sha256"] = hashlib.sha256(out).hexdigest()
    doc["module"]["size"] = len(out)
    open(manifest, "w", newline=chr(10)).write(json.dumps(doc, indent=2) + chr(10))
    print(f"{patched} calls in tail position made tail calls")
