# Temperament Library

A collection of **1649 twelve-note historical and microtonal temperaments**, derived from the [Scala scale library](https://www.huygens-fokker.org/scala/) by Manuel Op de Coul.

Each entry lists the deviation from 12-TET for all 12 notes, in cents, with A = 0 as reference.

**https://mesjetiu.github.io/temperaments/**

---

## Contents

| File | Description |
|------|-------------|
| `docs/index.md` | Full table: all temperaments with cent offsets per note |
| `temperamentos_La0.txt` | Same data in plain text format |
| `TETemperamentExport_all12.tetemp` | JSON export (original conversion artifact) |

---

## Format

Deviations in cents from 12-TET, reference A = 0:

```
12 out of 31-tET, meantone Eb-G#
  C : +9.677  C#:-12.903  D : +3.226  D#:+19.355  E : -3.226  F :+12.903
  F#: -9.677  G : +6.452  G#:-16.129  A : +0.000  Bb:+16.129  B : -6.452
```

---

## Source

**[Scala scale library](https://www.huygens-fokker.org/scala/)** (Manuel Op de Coul) — ~5400 `.scl` files; 1649 contain exactly 12 pitch classes.

---

## License

The Scala scale library files are in the public domain. This repository is released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
