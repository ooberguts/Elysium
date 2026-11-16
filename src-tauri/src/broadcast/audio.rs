use super::{protocol::Chunk, timing::Timeline};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicI64, AtomicU32, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::Emitter;

pub struct Sink {
    timeline: Mutex<Timeline>,
    pub offset: AtomicI64,
    pub clock_ready: AtomicBool,
    pub alive: AtomicBool,
    pub paused: AtomicBool,
    pub volume: AtomicU32,
    pub delay_us: AtomicI64,
    pub error: Mutex<String>,
    origin: Instant,
    visual: Mutex<VisualRing>,
}
struct VisualRing {
    samples: [f32; 2048],
    cursor: usize,
}
impl Default for VisualRing {
    fn default() -> Self {
        Self {
            samples: [0.; 2048],
            cursor: 0,
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VisualFrame {
    frequency: Vec<u8>,
    waveform: Vec<f32>,
    sample_rate: u32,
}

impl Sink {
    pub fn new(origin: Instant, local: bool, volume: f32, delay_ms: i64) -> Arc<Self> {
        Arc::new(Self {
            timeline: Mutex::new(Timeline::default()),
            offset: AtomicI64::new(0),
            clock_ready: AtomicBool::new(local),
            alive: AtomicBool::new(true),
            paused: AtomicBool::new(false),
            volume: AtomicU32::new(volume.clamp(0., 1.).to_bits()),
            delay_us: AtomicI64::new(delay_ms.clamp(-500, 500) * 1000),
            error: Mutex::new(String::new()),
            origin,
            visual: Mutex::new(VisualRing::default()),
        })
    }
    pub fn now(&self) -> i64 {
        (self.origin.elapsed().as_micros() as i64)
            .saturating_add(self.offset.load(Ordering::Relaxed))
    }
    pub fn push(&self, chunk: Arc<Chunk>) {
        if !self.clock_ready.load(Ordering::Acquire) {
            return;
        }
        if let Ok(mut timeline) = self.timeline.lock() {
            timeline.push(chunk, self.now());
        }
    }
    pub fn reset(&self, epoch: u64) {
        if let Ok(mut t) = self.timeline.lock() {
            t.reset(epoch);
        }
    }
    pub fn stop(&self) {
        self.alive.store(false, Ordering::Release);
    }
    pub fn settings(&self, volume: f32, delay_ms: i64) {
        self.volume
            .store(volume.clamp(0., 1.).to_bits(), Ordering::Relaxed);
        self.delay_us
            .store(delay_ms.clamp(-500, 500) * 1000, Ordering::Relaxed);
    }
    /// The worker owns the native stream, so stop/close does not depend on a
    /// still-live WebView to release the audio device.
    pub fn start(
        self: &Arc<Self>,
        device_id: Option<&str>,
        app: Option<tauri::AppHandle>,
    ) -> Result<String, String> {
        let host = cpal::default_host();
        let device = if let Some(id) = device_id.filter(|id| !id.is_empty()) {
            host.device_by_id(&id.parse().map_err(|_| "Invalid output device")?)
        } else {
            host.default_output_device()
        }
        .ok_or("No output device is available")?;
        let name = device
            .description()
            .map(|d| d.name().to_owned())
            .unwrap_or_else(|_| "Audio output".into());
        let supported = device.default_output_config().map_err(|e| e.to_string())?;
        let rate = supported.sample_rate();
        let config = supported.config();
        macro_rules! build {
            ($t:ty) => {
                self.build::<$t>(&device, config)
            };
        }
        let stream = match supported.sample_format() {
            cpal::SampleFormat::F32 => build!(f32),
            cpal::SampleFormat::F64 => build!(f64),
            cpal::SampleFormat::I16 => build!(i16),
            cpal::SampleFormat::I32 => build!(i32),
            cpal::SampleFormat::I8 => build!(i8),
            cpal::SampleFormat::I64 => build!(i64),
            cpal::SampleFormat::U8 => build!(u8),
            cpal::SampleFormat::U16 => build!(u16),
            cpal::SampleFormat::U32 => build!(u32),
            cpal::SampleFormat::U64 => build!(u64),
            format => Err(format!("Unsupported output sample format: {format}")),
        }?;
        stream.play().map_err(|e| e.to_string())?;
        let sink = self.clone();
        std::thread::spawn(move || {
            let _stream = stream;
            let fft = FftPlanner::<f32>::new().plan_fft_forward(2048);
            let mut fft_buffer = vec![Complex::new(0., 0.); 2048];
            let mut scratch = vec![Complex::new(0., 0.); fft.get_inplace_scratch_len()];
            while sink.alive.load(Ordering::Acquire) {
                if let Some(app) = app.as_ref() {
                    let wave = if let Ok(ring) = sink.visual.lock() {
                        (0..2048)
                            .map(|i| ring.samples[(ring.cursor + i) % 2048])
                            .collect::<Vec<_>>()
                    } else {
                        vec![0.; 2048]
                    };
                    let frequency = crate::capture::spectrum(
                        &wave,
                        fft.as_ref(),
                        &mut fft_buffer,
                        &mut scratch,
                    );
                    let _ = app.emit(
                        "broadcast-audio",
                        VisualFrame {
                            frequency,
                            waveform: wave,
                            sample_rate: rate,
                        },
                    );
                }
                std::thread::sleep(Duration::from_millis(33));
            }
        });
        Ok(name)
    }
    fn build<T>(
        self: &Arc<Self>,
        device: &cpal::Device,
        config: cpal::StreamConfig,
    ) -> Result<cpal::Stream, String>
    where
        T: cpal::SizedSample + cpal::FromSample<f32>,
    {
        let sink = self.clone();
        let error_sink = self.clone();
        let rate = config.sample_rate as f64;
        let channels = config.channels as usize;
        let mut anchor: Option<(cpal::StreamInstant, f64)> = None;
        let mut applied_offset = 0f64;
        let mut gain = 0f32;
        let mut synchronized = false;
        device
            .build_output_stream(
                config,
                move |data: &mut [T], info: &cpal::OutputCallbackInfo| {
                    data.fill(T::from_sample(0.));
                    if !sink.alive.load(Ordering::Relaxed)
                        || !sink.clock_ready.load(Ordering::Acquire)
                    {
                        synchronized = false;
                        return;
                    }
                    let now = sink.origin.elapsed().as_micros() as f64;
                    let stamp = info.timestamp();
                    let (base_stamp, base_time) = *anchor.get_or_insert((stamp.callback, now));
                    let mapped = base_time
                        + stamp
                            .callback
                            .checked_duration_since(base_stamp)
                            .map(|d| d.as_micros() as f64)
                            .unwrap_or(0.);
                    let callback_time = if (mapped - now).abs() > 250_000. {
                        anchor = Some((stamp.callback, now));
                        now
                    } else {
                        mapped
                    };
                    let lead = stamp
                        .playback
                        .checked_duration_since(stamp.callback)
                        .map(|d| d.as_micros().min(2_000_000) as f64)
                        .unwrap_or(0.);
                    let desired = sink.offset.load(Ordering::Relaxed) as f64;
                    if !synchronized {
                        applied_offset = desired;
                        synchronized = true;
                    }
                    applied_offset += (desired - applied_offset).clamp(-100., 100.);
                    let start = callback_time + lead + applied_offset
                        - sink.delay_us.load(Ordering::Relaxed) as f64;
                    let Ok(mut timeline) = sink.timeline.try_lock() else {
                        return;
                    };
                    let mut visual = sink.visual.try_lock().ok();
                    let paused = sink.paused.load(Ordering::Acquire);
                    let target_gain = if paused {
                        0.
                    } else {
                        f32::from_bits(sink.volume.load(Ordering::Relaxed))
                    };
                    for (i, frame) in data.chunks_exact_mut(channels).enumerate() {
                        let stereo = timeline.sample(start + i as f64 * 1_000_000. / rate);
                        gain += (target_gain - gain) * 0.005;
                        for (c, sample) in frame.iter_mut().enumerate() {
                            let value = if channels == 1 {
                                (stereo[0] + stereo[1]) * 0.5
                            } else if c < 2 {
                                stereo[c]
                            } else {
                                0.
                            };
                            *sample = T::from_sample((value * gain).clamp(-1., 1.));
                        }
                        if let Some(ring) = visual.as_mut() {
                            let cursor = ring.cursor;
                            ring.samples[cursor] = if paused {
                                0.
                            } else if stereo[0].abs() >= stereo[1].abs() {
                                stereo[0]
                            } else {
                                stereo[1]
                            };
                            ring.cursor = (cursor + 1) % 2048;
                        }
                    }
                },
                move |error| {
                    if let Ok(mut message) = error_sink.error.lock() {
                        *message = format!("Audio output stopped: {error}");
                    }
                    error_sink.stop();
                },
                Some(Duration::from_secs(5)),
            )
            .map_err(|e| format!("Could not open audio output: {e}"))
    }
}
