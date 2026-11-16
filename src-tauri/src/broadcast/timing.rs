use super::protocol::{Chunk, CHANNELS, RATE};
use std::collections::VecDeque;
use std::sync::Arc;

/// NTP-style four-timestamp estimate. Prefer recent low-round-trip samples so
/// Wi-Fi stalls do not shift the playback clock. Clock values are monotonic.
#[derive(Default)]
pub struct ClockEstimate {
    samples: VecDeque<(i64, i64)>,
}
impl ClockEstimate {
    pub fn update(&mut self, sent: i64, received: i64, replied: i64, now: i64) -> Option<i64> {
        let rtt = now
            .checked_sub(sent)?
            .checked_sub(replied.checked_sub(received)?)?;
        if !(0..=2_000_000).contains(&rtt) || replied < received || now < sent {
            return None;
        }
        let offset = received
            .checked_sub(sent)?
            .checked_add(replied.checked_sub(now)?)?
            / 2;
        self.samples.push_back((rtt, offset));
        if self.samples.len() > 24 {
            self.samples.pop_front();
        }
        let mut best: Vec<_> = self.samples.iter().copied().collect();
        best.sort_unstable_by_key(|s| s.0);
        let count = best.len().min(3);
        Some((best.iter().take(count).map(|s| s.1 as i128).sum::<i128>() / count as i128) as i64)
    }
}

#[derive(Default)]
pub struct Timeline {
    chunks: VecDeque<Arc<Chunk>>,
    epoch: u64,
    pub late_frames: u64,
}
impl Timeline {
    pub fn reset(&mut self, epoch: u64) {
        self.chunks.clear();
        self.epoch = epoch;
    }
    pub fn push(&mut self, chunk: Arc<Chunk>, server_now: i64) {
        if chunk.at < server_now.saturating_sub(2_000_000)
            || chunk.at > server_now.saturating_add(10_000_000)
        {
            return;
        }
        if chunk.epoch < self.epoch {
            return;
        }
        if chunk.epoch != self.epoch {
            self.reset(chunk.epoch);
        }
        if self.chunks.back().is_some_and(|c| c.at >= chunk.at) {
            return;
        }
        self.chunks.push_back(chunk);
        while self.chunks.len() > 500 {
            self.chunks.pop_front();
        }
    }
    /// Read at the predicted DAC time, interpolating 48 kHz into the output
    /// device's clock. This continuously compensates drift instead of letting
    /// separate rooms accumulate independent playback positions.
    pub fn sample(&mut self, at: f64) -> [f32; 2] {
        while self.chunks.front().is_some_and(|c| c.end() as f64 <= at) {
            self.chunks.pop_front();
        }
        let Some(chunk) = self.chunks.front() else {
            self.late_frames += 1;
            return [0.; 2];
        };
        if at < chunk.at as f64 {
            return [0.; 2];
        }
        let position = (at - chunk.at as f64) * RATE as f64 / 1_000_000.;
        let index = position.floor() as usize;
        let fraction = (position - index as f64) as f32;
        let mut result = [0.; 2];
        for channel in 0..CHANNELS {
            let a = *chunk.samples.get(index * 2 + channel).unwrap_or(&0) as f32;
            let b = chunk
                .samples
                .get((index + 1) * 2 + channel)
                .copied()
                .or_else(|| {
                    self.chunks
                        .get(1)
                        .and_then(|c| c.samples.get(channel).copied())
                })
                .unwrap_or(a as i16) as f32;
            result[channel] = (a + (b - a) * fraction) / 32768.;
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clock_estimate_rejects_wifi_stalls_and_server_processing_delay() {
        let mut clock = ClockEstimate::default();
        for t in 0..10 {
            let sent = t * 1_000_000;
            assert_eq!(
                clock.update(sent, sent + 51_000, sent + 52_000, sent + 3_000),
                Some(50_000)
            );
        }
        assert_eq!(
            clock.update(11_000_000, 11_251_000, 11_252_000, 11_403_000),
            Some(50_000)
        );
        assert_eq!(clock.update(20, 10, 9, 30), None);
        assert_eq!(clock.update(i64::MIN, 0, 0, i64::MAX), None);
        assert_eq!(clock.update(0, i64::MAX, i64::MAX, 1), None);
    }
    #[test]
    fn rooms_use_the_same_sample_time_and_late_joins_skip_the_past() {
        let chunk = Arc::new(Chunk {
            epoch: 1,
            at: 1_000_000,
            samples: Arc::new(vec![0, 0, 16000, -16000, 32000, -32000]),
        });
        let mut a = Timeline::default();
        let mut b = Timeline::default();
        a.push(chunk.clone(), 0);
        b.push(chunk, 0);
        assert_eq!(a.sample(999_999.), [0., 0.]);
        let at = 1_000_000. + 1_000_000. / 48000. * 1.5;
        assert_eq!(a.sample(at), b.sample(at));
        assert!((a.sample(at)[0] - 24000. / 32768.).abs() < 0.001);
        assert_eq!(b.sample(2_000_000.), [0., 0.]);
    }
    #[test]
    fn old_epochs_and_absurd_timestamps_cannot_replace_new_audio() {
        let mut t = Timeline::default();
        t.reset(4);
        for (epoch, at) in [(3, 0), (4, 19_000_000), (4, -9_000_000)] {
            t.push(
                Arc::new(Chunk {
                    epoch,
                    at,
                    samples: Arc::new(vec![32767, 32767]),
                }),
                0,
            );
        }
        assert_eq!(t.sample(0.), [0., 0.]);
    }
}
