/** MIDI 音高编号转频率（Hz）。A4 = MIDI 69 = 440 Hz，十二平均律。 */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}
