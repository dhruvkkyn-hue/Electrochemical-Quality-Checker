export type SensorSampleState = 'Good' | 'Medium' | 'Bad';
export type SensorPoint = { potential: number; current: number };

export type SensorReadingOptions = {
  state: SensorSampleState;
  noise: number;
  run: number;
};

const profiles = {
  Good: { amplitude: 1.0, center: 0.4, width: 0.055, drift: 0.012 },
  Medium: { amplitude: 0.6, center: 0.42, width: 0.078, drift: 0.036 },
  Bad: { amplitude: 0.16, center: 0.45, width: 0.12, drift: 0.079 },
} as const;

function seededNoise(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

/**
 * Hardware boundary for a future potentiostat connection.
 *
 * A serial/Web Bluetooth implementation can replace the synthetic branch
 * below while keeping the UI contract stable: return 101 voltage/current
 * samples in the SensorPoint shape. The future adapter can live here and
 * translate device packets into the same normalized reading.
 */
export function generateSyntheticReading({ state, noise, run }: SensorReadingOptions): SensorPoint[] {
  const profile = profiles[state];
  const points: SensorPoint[] = [];

  for (let index = 0; index <= 100; index += 1) {
    const potential = index * 0.008;
    const peak = profile.amplitude * Math.exp(-Math.pow(potential - profile.center, 2) / (2 * Math.pow(profile.width, 2)));
    const shoulder = profile.amplitude * 0.12 * Math.exp(-Math.pow(potential - 0.58, 2) / (2 * Math.pow(profile.width * 1.7, 2)));
    const baseline = 0.08 + profile.drift * potential * 1.8;
    const noiseSample = noise * (0.7 + Math.abs(Math.sin(index * 0.31))) * seededNoise(index + run * 17);
    points.push({ potential, current: Math.max(0.03, baseline + peak + shoulder + noiseSample) });
  }

  return points;
}

/**
 * Async sensor facade used by acquisition flows.
 * Replace the body with serial/Bluetooth device I/O when hardware is available.
 */
export async function fetch_reading(options: SensorReadingOptions): Promise<SensorPoint[]> {
  return generateSyntheticReading(options);
}