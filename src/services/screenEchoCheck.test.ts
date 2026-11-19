import { expect, it } from 'vitest'
import { matchesEchoProbe } from './screenEchoCheck'

it('requires both frequencies above background and rejects broadband or preexisting noise', () => {
  const baseline = [{ peak: -70, nearby: -72 }, { peak: -80, nearby: -84 }] as const
  const tone = [{ peak: -38, nearby: -70 }, { peak: -53, nearby: -84 }] as const
  expect(matchesEchoProbe(baseline, tone)).toBe(true)
  expect(matchesEchoProbe(baseline, [tone[0], baseline[1]])).toBe(false)
  expect(matchesEchoProbe(tone, tone)).toBe(false)
  expect(matchesEchoProbe(baseline, [{ peak: -38, nearby: -40 }, tone[1]])).toBe(false)
})
