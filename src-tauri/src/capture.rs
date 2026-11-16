//! Audio for visuals only. Samples stay in a bounded memory buffer and are never
//! saved, transmitted over the network, or played back through the speakers.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

const FFT_SIZE: usize = 2048;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    id: String,
    name: String,
    kind: String,
    is_default: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioFrame {
    session: u64,
    frequency: Vec<u8>,
    waveform: Vec<f32>,
    sample_rate: u32,
}

#[derive(Clone, Serialize)]
struct CaptureError {
    session: u64,
    message: String,
}

struct Capture {
    session: u64,
    alive: Arc<AtomicBool>,
}
impl Drop for Capture {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Release);
    }
}
#[derive(Default)]
pub struct CaptureState {
    current: Mutex<Option<Capture>>,
    next: Arc<AtomicU64>,
}
impl CaptureState {
    pub fn stop(&self, session: Option<u64>) {
        // Cancel an in-flight permission request without blocking the window thread.
        if session.is_none() {
            self.next.fetch_add(1, Ordering::AcqRel);
        }
        if let Ok(mut guard) = self.current.try_lock() {
            if session.is_none() || guard.as_ref().is_some_and(|c| Some(c.session) == session) {
                guard.take();
            }
        }
    }
}

fn output_capture_available() -> bool {
    #[cfg(target_os = "windows")]
    {
        true
    }
    #[cfg(target_os = "macos")]
    {
        // CoreAudio process taps require macOS 14.2; CPAL's supported baseline is 14.6.
        std::process::Command::new("/usr/bin/sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .is_some_and(|version| {
                let parts: Vec<u32> = version
                    .trim()
                    .split('.')
                    .filter_map(|p| p.parse().ok())
                    .collect();
                parts.first().is_some_and(|major| {
                    *major > 14 || (*major == 14 && parts.get(1).copied().unwrap_or(0) >= 6)
                })
            })
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        false
    }
}

#[tauri::command]
pub async fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let host = cpal::default_host();
        let input = host.default_input_device().and_then(|d| d.id().ok());
        let output = host.default_output_device().and_then(|d| d.id().ok());
        let loopback = output_capture_available();
        let mut devices = Vec::new();
        for device in host.devices().map_err(|e| e.to_string())? {
            let Ok(id) = device.id() else { continue };
            let name = device
                .description()
                .map(|d| d.name().to_string())
                .unwrap_or_else(|_| "Audio device".into());
            if device.supports_input() {
                devices.push(AudioDevice {
                    id: id.to_string(),
                    name: name.clone(),
                    kind: "input".into(),
                    is_default: Some(&id) == input.as_ref(),
                });
            }
            // CPAL's macOS loopback path applies to output-only endpoints. Never
            // label a duplex microphone stream as system audio.
            let output_only = !cfg!(target_os = "macos") || !device.supports_input();
            if loopback && output_only && device.supports_output() {
                devices.push(AudioDevice {
                    id: id.to_string(),
                    name,
                    kind: "output".into(),
                    is_default: Some(&id) == output.as_ref(),
                });
            }
        }
        devices.sort_by_key(|d| (d.kind != "output", !d.is_default, d.name.clone()));
        Ok(devices)
    })
    .await
    .map_err(|e| e.to_string())?
}

struct SampleRing {
    samples: [f32; FFT_SIZE],
    cursor: usize,
    updated: Instant,
}
impl SampleRing {
    fn new() -> Self {
        Self {
            samples: [0.; FFT_SIZE],
            cursor: 0,
            updated: Instant::now(),
        }
    }
    fn push(&mut self, sample: f32) {
        self.samples[self.cursor] = if sample.is_finite() {
            sample.clamp(-1., 1.)
        } else {
            0.
        };
        self.cursor = (self.cursor + 1) % FFT_SIZE;
    }
    fn snapshot(&self) -> Vec<f32> {
        if self.updated.elapsed() > Duration::from_millis(200) {
            return vec![0.; FFT_SIZE];
        }
        (0..FFT_SIZE)
            .map(|i| self.samples[(self.cursor + i) % FFT_SIZE])
            .collect()
    }
}

fn build_stream<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    ring: Arc<Mutex<SampleRing>>,
    alive: Arc<AtomicBool>,
    app: tauri::AppHandle,
    session: u64,
) -> Result<cpal::Stream, String>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let channels = config.channels as usize;
    device.build_input_stream(config, move |data: &[T], _| {
        // No blocking, allocations, FFT work, or IPC on the real-time callback.
        if let Ok(mut buffer) = ring.try_lock() {
            // Use the loudest channel per callback to preserve out-of-phase stereo.
            let mut channel = 0; let mut peak = 0.;
            for c in 0..channels {
                let power: f32 = data.iter().skip(c).step_by(channels).map(|v| { let s: f32 = v.to_sample(); s*s }).sum();
                if power > peak { peak = power; channel = c; }
            }
            for frame in data.chunks_exact(channels) { buffer.push(frame[channel].to_sample()); }
            buffer.updated = Instant::now();
        }
    }, move |error| {
        alive.store(false,Ordering::Release);
        let _ = app.emit("visualizer-capture-error", CaptureError { session, message: format!("Audio device disconnected or capture stopped: {error}") });
    }, Some(Duration::from_secs(5))).map_err(|e| format!("Could not listen to this device: {e}. Check Elysium’s audio or microphone permission in system settings."))
}

pub(crate) fn spectrum(
    samples: &[f32],
    fft: &dyn rustfft::Fft<f32>,
    buffer: &mut [Complex<f32>],
    scratch: &mut [Complex<f32>],
) -> Vec<u8> {
    for (i, (value, sample)) in buffer.iter_mut().zip(samples).enumerate() {
        let hann = 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / (FFT_SIZE - 1) as f32).cos();
        *value = Complex::new(sample * hann, 0.);
    }
    fft.process_with_scratch(buffer, scratch);
    buffer[..FFT_SIZE / 2]
        .iter()
        .map(|v| {
            let amplitude = v.norm() * 4. / FFT_SIZE as f32;
            let db = 20. * amplitude.max(1e-7).log10();
            (((db + 90.) / 75.).clamp(0., 1.) * 255.) as u8
        })
        .collect()
}

#[tauri::command]
pub async fn start_audio_capture(
    app: tauri::AppHandle,
    device_id: String,
    kind: String,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !["input","output"].contains(&kind.as_str()) { return Err("Unknown audio source type".into()) }
        if kind == "output" && !output_capture_available() { return Err("System audio requires macOS 14.6+ or Windows. You can still select an input or loopback device.".into()) }
        let state = app.state::<CaptureState>();
        let session = state.next.fetch_add(1,Ordering::AcqRel)+1;
        let mut guard = state.current.lock().map_err(|_| "Audio capture is unavailable")?;
        if state.next.load(Ordering::Acquire) != session { return Err("Audio connection cancelled".into()); }
        guard.take();
        let host = cpal::default_host();
        let device = host.device_by_id(&device_id.parse().map_err(|_| "Invalid audio device")?).ok_or("This audio device is no longer connected. Refresh the list.")?;
        if cfg!(target_os="macos") && kind == "output" && device.supports_input() { return Err("This duplex device needs a dedicated loopback input for system audio.".into()) }
        let supported = if kind=="output" { device.default_output_config() } else { device.default_input_config() }.map_err(|e| e.to_string())?;
        let rate = supported.sample_rate();
        let config = supported.config();
        let alive = Arc::new(AtomicBool::new(true));
        let ring = Arc::new(Mutex::new(SampleRing::new()));
        macro_rules! build { ($t:ty) => { build_stream::<$t>(&device,config,ring.clone(),alive.clone(),app.clone(),session) }; }
        let stream = match supported.sample_format() {
            cpal::SampleFormat::F32 => build!(f32), cpal::SampleFormat::F64 => build!(f64),
            cpal::SampleFormat::I8 => build!(i8), cpal::SampleFormat::I16 => build!(i16),
            cpal::SampleFormat::I32 => build!(i32), cpal::SampleFormat::I64 => build!(i64),
            cpal::SampleFormat::U8 => build!(u8), cpal::SampleFormat::U16 => build!(u16),
            cpal::SampleFormat::U32 => build!(u32), cpal::SampleFormat::U64 => build!(u64),
            format => Err(format!("Unsupported device format: {format}")),
        }?;
        if state.next.load(Ordering::Acquire) != session { return Err("Audio connection cancelled".into()); }
        stream.play().map_err(|e| e.to_string())?;
        *guard = Some(Capture { session, alive: alive.clone() });
        let latest_request = state.next.clone();
        let emitter = app.clone();
        std::thread::spawn(move || {
            // The worker owns the stream so cancellation, errors, and window close
            // release the device even if the WebView has already disappeared.
            let _stream = stream;
            let fft = FftPlanner::<f32>::new().plan_fft_forward(FFT_SIZE);
            let mut buffer = vec![Complex::new(0.,0.); FFT_SIZE];
            let mut scratch = vec![Complex::new(0.,0.); fft.get_inplace_scratch_len()];
            while alive.load(Ordering::Acquire) && latest_request.load(Ordering::Acquire) == session {
                let samples = match ring.lock() { Ok(r) => r.snapshot(), Err(_) => break };
                let frequency = spectrum(&samples,fft.as_ref(),&mut buffer,&mut scratch);
                let waveform = samples;
                if !alive.load(Ordering::Acquire) { break }
                let _ = emitter.emit("visualizer-audio",AudioFrame { session,frequency,waveform,sample_rate:rate });
                std::thread::sleep(Duration::from_millis(33));
            }
        });
        Ok(session)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn stop_audio_capture(state: tauri::State<CaptureState>, session: Option<u64>) {
    state.stop(session);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_stop_cannot_cancel_a_new_session() {
        let state = CaptureState::default();
        let alive = Arc::new(AtomicBool::new(true));
        *state.current.lock().unwrap() = Some(Capture {
            session: 2,
            alive: alive.clone(),
        });
        state.stop(Some(1));
        assert!(alive.load(Ordering::Acquire));
        state.stop(Some(2));
        assert!(!alive.load(Ordering::Acquire));
    }
    #[test]
    fn closing_cancels_pending_capture_without_waiting_for_permission() {
        let state = CaptureState::default();
        state.next.store(1, Ordering::Release);
        let _pending = state.current.lock().unwrap();
        state.stop(None);
        assert_eq!(state.next.load(Ordering::Acquire), 2);
    }
    #[test]
    fn fft_finds_real_tone_and_silence_is_zero() {
        let fft = FftPlanner::<f32>::new().plan_fft_forward(FFT_SIZE);
        let mut buffer = vec![Complex::new(0., 0.); FFT_SIZE];
        let mut scratch = vec![Complex::new(0., 0.); fft.get_inplace_scratch_len()];
        let silence = spectrum(&vec![0.; FFT_SIZE], fft.as_ref(), &mut buffer, &mut scratch);
        assert!(silence.iter().all(|v| *v == 0));
        for rate in [44100, 48000, 96000] {
            let samples: Vec<f32> = (0..FFT_SIZE)
                .map(|i| (std::f32::consts::TAU * 1000. * i as f32 / rate as f32).sin() * 0.05)
                .collect();
            let bins = spectrum(&samples, fft.as_ref(), &mut buffer, &mut scratch);
            let peak = bins.iter().enumerate().max_by_key(|(_, v)| **v).unwrap().0;
            assert!((peak as f32 - 1000. * FFT_SIZE as f32 / rate as f32).abs() < 2.);
        }
    }
    #[test]
    fn sample_ring_is_bounded_and_chronological() {
        let mut ring = SampleRing::new();
        for i in 0..FFT_SIZE + 100 {
            ring.push(i as f32 / 10000.);
        }
        let snapshot = ring.snapshot();
        assert_eq!(snapshot.len(), FFT_SIZE);
        assert!((snapshot[0] - 0.01).abs() < 1e-6);
        ring.updated = Instant::now() - Duration::from_secs(1);
        assert!(ring.snapshot().iter().all(|s| *s == 0.));
    }
}
