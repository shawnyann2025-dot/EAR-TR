/** MIDI 音高编号转频率（Hz）。A4 = MIDI 69 = 440 Hz，十二平均律。 */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** midiToFreq 的反函数，结果为浮点 MIDI 号 */
export function freqToMidi(freqHz: number): number {
  return 69 + 12 * Math.log2(freqHz / 440)
}
