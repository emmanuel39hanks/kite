"""
Kite's sound effects, synthesised from scratch (no samples, so no licences to track).

Quiet, glassy UI sounds in the spirit of the product: soft sine partials with fast decays, a little air, a small room.
Run: python3 scripts/make-sfx.py → writes src/sfx/*.wav (48 kHz, 16-bit stereo).
"""
import math
import os
import random
import struct
import wave

SR = 48000
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "sfx")
random.seed(7)


def silence(sec):
    return [0.0] * int(SR * sec)


def tone(freq, sec, decay, amp=1.0, attack=0.002, glide_to=None):
    """A sine partial with a short attack and exponential decay; optional pitch glide."""
    n = int(SR * sec)
    out, phase = [], 0.0
    for i in range(n):
        t = i / SR
        f = freq if glide_to is None else freq + (glide_to - freq) * min(1.0, t / sec)
        phase += 2 * math.pi * f / SR
        env = min(1.0, t / attack) * math.exp(-t / decay)
        out.append(amp * env * math.sin(phase))
    return out


def noise(sec, decay, amp=1.0, attack=0.001):
    n = int(SR * sec)
    return [amp * min(1.0, (i / SR) / attack) * math.exp(-(i / SR) / decay) * (random.random() * 2 - 1) for i in range(n)]


def lowpass(x, cutoff):
    a = math.exp(-2 * math.pi * cutoff / SR)
    y, prev = [], 0.0
    for v in x:
        prev = (1 - a) * v + a * prev
        y.append(prev)
    return y


def highpass(x, cutoff):
    lp = lowpass(x, cutoff)
    return [a - b for a, b in zip(x, lp)]


def mix(*tracks, at=None):
    at = at or [0] * len(tracks)
    n = max(int(o * SR) + len(t) for t, o in zip(tracks, at))
    out = [0.0] * n
    for t, o in zip(tracks, at):
        s = int(o * SR)
        for i, v in enumerate(t):
            out[s + i] += v
    return out


def room(x, wet=0.18, tail=0.6):
    """A small, soft room: a few feedback delays, low-passed so it never sounds metallic."""
    delays = [0.0297, 0.0371, 0.0411, 0.0437]
    y = x + [0.0] * int(SR * tail)
    acc = [0.0] * len(y)
    for d in delays:
        k = int(d * SR)
        buf = [0.0] * len(y)
        g = 0.62
        for i in range(len(y)):
            buf[i] = y[i] + (g * buf[i - k] if i >= k else 0.0)
        for i in range(len(y)):
            acc[i] += buf[i] / len(delays)
    acc = lowpass(acc, 5000)
    return [d * (1 - wet) + w * wet for d, w in zip(y, acc)]


def normalize(x, peak_db):
    m = max(1e-9, max(abs(v) for v in x))
    g = 10 ** (peak_db / 20) / m
    return [v * g for v in x]


def fade_out(x, sec=0.02):
    n = int(SR * sec)
    for i in range(n):
        x[-1 - i] *= i / n
    return x


def write(name, x, peak_db=-6.0, width=0.0):
    x = fade_out(normalize(x, peak_db))
    path = os.path.join(OUT, f"{name}.wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        d = int(0.0007 * SR)  # a touch of width: the right channel lags a hair
        for i, v in enumerate(x):
            r = x[i - d] if (width and i >= d) else v
            l_, r_ = v, (v * (1 - width) + r * width)
            frames += struct.pack("<hh", int(max(-1, min(1, l_)) * 32767), int(max(-1, min(1, r_)) * 32767))
        w.writeframes(bytes(frames))
    print(f"wrote {name}.wav ({len(x) / SR:.2f}s)")


os.makedirs(OUT, exist_ok=True)

# tick: a tiny glassy tick for counters, list rows and votes.
write("tick", room(mix(tone(2400, 0.06, 0.012, 0.7), tone(4800, 0.04, 0.006, 0.25), highpass(noise(0.01, 0.002, 0.15), 3000)), 0.1, 0.2), -14)

# pop: a card or line arriving. Soft, rounded, slightly rising.
write("pop", room(mix(tone(520, 0.14, 0.045, 1.0, 0.004, 760), tone(1040, 0.1, 0.025, 0.25, 0.004, 1520)), 0.15, 0.3), -12, 0.4)

# check: something passed. Two quick notes a fifth apart, marimba-ish.
def note(f, amp=1.0):
    return mix(tone(f, 0.5, 0.12, amp), tone(f * 4, 0.2, 0.025, amp * 0.25), tone(f * 2.01, 0.3, 0.06, amp * 0.2))
write("check", room(mix(note(1046.5, 0.8), note(1568.0, 1.0), at=[0, 0.07]), 0.2, 0.5), -10, 0.5)

# refuse: a muted, low "no". Not an alarm: a soft thud with a downward bend.
write("refuse", room(mix(tone(240, 0.16, 0.05, 1.0, 0.003, 170), lowpass(noise(0.05, 0.012, 0.35), 900)), 0.12, 0.3), -11)

# whoosh: air moving, for the money flying between bars and big transitions.
def whoosh(sec=0.55, lo=300, hi=3200):
    n = int(SR * sec)
    raw = [random.random() * 2 - 1 for _ in range(n)]
    out, lp, bp = [], 0.0, 0.0
    for i, v in enumerate(raw):
        t = i / n
        c = lo + (hi - lo) * math.sin(math.pi * t)  # filter opens then closes
        a = math.exp(-2 * math.pi * c / SR)
        lp = (1 - a) * v + a * lp
        bp = 0.85 * bp + 0.15 * lp
        env = math.sin(math.pi * t) ** 1.6
        out.append((lp - bp) * env)
    return out
write("whoosh", room(whoosh(), 0.2, 0.4), -14, 0.8)

# coin: money landing. A bright little two-partial ding.
write("coin", room(mix(tone(1975, 0.5, 0.09, 0.7), tone(2637, 0.4, 0.07, 0.5), tone(5274, 0.15, 0.02, 0.15), at=[0, 0.035, 0]), 0.22, 0.5), -12, 0.5)

# warn: a gentle two-note question, falling. For "you wanted 50%".
write("warn", room(mix(note(880, 0.8), note(739.99, 0.8), at=[0, 0.11]), 0.2, 0.5), -13, 0.4)

# bloom: the Kite name. A warm major chord that swells and rings, with a little shimmer.
def pad(f, sec=2.4, amp=1.0):
    return mix(tone(f, sec, 0.9, amp, 0.12), tone(f * 2, sec, 0.6, amp * 0.25, 0.15), tone(f * 1.003, sec, 0.9, amp * 0.6, 0.14))
write("bloom", room(lowpass(mix(pad(261.63), pad(329.63, amp=0.8), pad(392.0, amp=0.7), pad(523.25, amp=0.4), tone(1568, 1.2, 0.35, 0.08, 0.2)), 4200), 0.3, 1.2), -9, 0.6)

# key: the key appearing. A soft metallic double-tick.
write("key", room(mix(tone(3200, 0.08, 0.015, 0.6), tone(4100, 0.08, 0.012, 0.4), tone(3200, 0.08, 0.015, 0.5), at=[0, 0, 0.06]), 0.2, 0.3), -15, 0.5)

# settle: the end card. A low, round resolve.
write("settle", room(lowpass(mix(pad(130.81, 2.6, 1.0), pad(196.0, 2.6, 0.6), pad(261.63, 2.6, 0.35)), 2600), 0.3, 1.4), -10, 0.6)
