# Temperament Library for TE Tuner

A collection of **1650 twelve-note historical and microtonal temperaments** in `.tetemp` format, derived from the [Scala scale library](https://www.huygens-fokker.org/scala/) by Manuel Op de Coul.

Intended for use with the **TE — Temperament** Android tuning app.

**https://mesjetiu.github.io/temperaments/**

---

## Contents

| File | Description |
|------|-------------|
| `TETemperamentExport_all12.tetemp` | 1650 temperaments in `.tetemp` JSON format (import-ready) |
| `temperamentos_La0.txt` | Human-readable list: cent offsets per note, A = 0 reference |
| `scales/scl/` | Source Scala `.scl` files (~5400 files, 1650 with exactly 12 notes) |

---

## Format: `.tetemp`

The `.tetemp` file is a JSON object containing an array of temperament entries:

```json
{
  "temperaments": [
    {
      "name": "Full temperament name",
      "shortname": "short8",
      "intervals": [0.0, 0.039, -0.02, 0.039, -0.02, 0.078, 0.02, 0.039, 0.039, 0.0, 0.039, 0.0]
    }
  ]
}
```

### Fields

- **`name`** — Full descriptive name (from the `.scl` file description)
- **`shortname`** — Up to 8 characters, unique across the collection (derived from filename)
- **`intervals`** — Array of 12 floats: deviation from 12-TET for each note, **in semitones** (cents ÷ 100)
  - Order: C, C#, D, D#, E, F, F#, G, G#, A, B♭, B
  - C is always the reference (0.0); the app independently tunes A4 = 440 Hz

---

## Conversion Method

Each `.scl` file with exactly 12 notes was converted as follows:

```python
ET_CENTS = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100]

intervals = [0.0]  # C = reference
for i in range(11):  # C# through B
    deviation_cents = scl_cents[i] - ET_CENTS[i + 1]
    intervals.append(deviation_cents / 100.0)
```

Scala files encode pitches as cents above C (the unison/root), with 12 intervals from C# to B plus the octave (2/1). Files in both UTF-8 and Latin-1 encodings were handled.

---

## Sources

- **[Scala scale library](https://www.huygens-fokker.org/scala/)** (Manuel Op de Coul) — ~5400 `.scl` files; 1649 contain exactly 12 pitch classes
- **Bach/Lehman** temperament — from the app's original `.tetemp` file (not in Scala library)

---

## Human-Readable Format (`temperamentos_La0.txt`)

Each entry shows cent offsets relative to **A = 0**:

```
bach Lehman
  (bachl)
  C : +5.900  C#: +3.900  D : +2.000  D#: +3.900  E : -2.000  F : +7.800
  F#: +2.000  G : +3.900  G#: +3.900  A : +0.000  Bb: +3.900  B : +0.000
```

The reference note is A (not C) so the offsets match the app's display when A4 = 440 Hz is the tuning anchor.

---

## Coverage Notes

The collection does **not** include temperaments absent from the Scala library. Known gaps:

- Post-2005 temperaments
- Spanish/Iberian historical tunings (Nassarre, Torres, Soler)
- Recently documented historical organs

Contributions welcome.

---

## License

The Scala scale library files are in the public domain. The `.tetemp` conversion and this repository are released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
