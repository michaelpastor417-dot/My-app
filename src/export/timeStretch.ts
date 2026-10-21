/**
 * Change audio duration without changing pitch, using WSOLA (waveform
 * similarity overlap-add): the input is cut into overlapping windowed frames
 * taken at the new rate, and each frame is shifted slightly to where it best
 * lines up with the previous one, so the waveform stays continuous.
 *
 * `rate` > 1 makes the audio shorter (faster). All channels share the same
 * frame positions so stereo stays aligned.
 */
export function timeStretch(channels: Float32Array[], rate: number, frame = 1024, search = 256): Float32Array[] {
  if (channels.length === 0) return [];
  const inLength = channels[0].length;
  const outLength = Math.round(inLength / rate);
  if (rate === 1) return channels.map((c) => c.slice());

  const hopOut = frame / 2;
  const hopIn = hopOut * rate;
  const overlap = frame - hopOut;
  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);

  // Mono mix used only to choose frame positions.
  const mono = new Float32Array(inLength);
  for (const c of channels) for (let i = 0; i < inLength; i++) mono[i] += c[i];

  const out = channels.map(() => new Float32Array(outLength + frame));
  const weight = new Float32Array(outLength + frame);
  let previous = 0; // where the last frame was actually taken from

  for (let k = 0; k * hopOut < outLength; k++) {
    const nominal = Math.round(k * hopIn);
    let start = Math.min(Math.max(0, nominal), Math.max(0, inLength - frame));
    if (k > 0) {
      // The ideal continuation of the previous frame starts hopOut samples after it.
      const natural = previous + hopOut;
      let best = -Infinity;
      for (let d = -search; d <= search; d += 4) {
        const candidate = start + d;
        if (candidate < 0 || candidate + overlap > inLength || natural + overlap > inLength) continue;
        let score = 0;
        for (let i = 0; i < overlap; i += 2) score += mono[candidate + i] * mono[natural + i];
        if (score > best) {
          best = score;
          start = candidate;
        }
      }
    }
    previous = start;
    const at = k * hopOut;
    for (let i = 0; i < frame && start + i < inLength; i++) {
      const w = window[i];
      for (let c = 0; c < channels.length; c++) out[c][at + i] += channels[c][start + i] * w;
      weight[at + i] += w;
    }
  }

  return out.map((data) => {
    const result = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) result[i] = weight[i] > 1e-3 ? data[i] / weight[i] : 0;
    return result;
  });
}
