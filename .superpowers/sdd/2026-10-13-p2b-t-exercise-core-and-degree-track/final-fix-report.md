
# Final-fix wave report

## Item 1 (dfc2451)
- register.ts: new degreeToMidiFromTonic; variation.ts: new doMidiFor (minor uses centerMidi-9); generate.ts, testInput.ts, degree.ts use them.
- RED (before fix): `expected 62 to be >= 67` (minor pitch sweep), `expected false to be true` (do->ti->la never appears), `expected 9 <= 6` (minor tonic centering in generate.test.ts). GREEN after fix. Register unit test added.
- Snapshot: only 普通音级·听写 (minor) changed; pitches moved down about an octave (311->155 Hz etc.), tonic now at center.

## Item 2 (modulation)
- modulation.ts: FIRST_HALF_TEMPLATES (3), MAJOR_CADENCE_TEMPLATES (4, starts mi/re/do/low-la), MINOR_CADENCE_TEMPLATES (4, starts mi/do/la/ti); new tonic = oldTonic + (pc>6 ? pc-12 : pc); rng order shift, first, cadence.
- RED: seam-intersection test false, nearest-octave test `9 <= 6`, templates undefined. GREEN after.
- Deviation: brief suggested sol-start for major second half; sol(+7) after IV(+5) gives a 12-semitone seam (> 9), so the 4th major template starts on low la (-3) instead. Every stay seam {4,2,0,-3} occurs in some shift (IV/V/relative).
- Snapshots: 3 modulation snapshots updated; inspected replay MIDI: second half starts within a few semitones of first half end (e.g. 58 -> 63, 72 -> 73/65), no 12-16 semitone jumps.

## Item 3: variation.ts comment corrected (in dfc2451). Item 4: spec §7.2 and new §14.

## Final
vitest 482/482 pass (re-run without -u: no snapshot writes); tsc OK; vite build OK; purity grep OK.
