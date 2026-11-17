//! Elysium LAN v1: bounded length-prefixed control messages and stereo PCM.
//! The LAN protocol can request listening, but cannot control a library or open files.
use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use std::sync::Arc;

pub const RATE: u32 = 48_000;
pub const CHANNELS: usize = 2;
pub const FRAMES: usize = 960;
pub const BUFFER_US: i64 = 1_200_000;
const MAX_PACKET: usize = 16_384;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    #[serde(default)]
    pub start_position: f64,
    pub index: usize,
    pub total: usize,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub video_key: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Control {
    VideoRequest {
        station: String,
        key: String,
        file: String,
    },
    VideoResponse {
        length: u32,
    },
    Hello {
        version: u32,
        id: String,
        name: String,
        station: String,
    },
    Welcome {
        station: String,
        name: String,
        epoch: u64,
        buffer_ms: u32,
    },
    Ping {
        sent: i64,
    },
    Pong {
        sent: i64,
        received: i64,
        replied: i64,
    },
    NowPlaying {
        track: Track,
        at: i64,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        paused: bool,
        #[serde(default)]
        position: f64,
    },
    Reset {
        epoch: u64,
    },
    End {
        reason: String,
    },
    Error {
        message: String,
    },
    Invite {
        station: String,
        name: String,
        port: u16,
    },
    InviteReply {
        status: String,
    },
}

#[derive(Clone, Debug)]
pub struct Chunk {
    pub epoch: u64,
    pub at: i64,
    pub samples: Arc<Vec<i16>>,
}
impl Chunk {
    pub fn end(&self) -> i64 {
        self.at
            .saturating_add(self.samples.len() as i64 * 1_000_000 / (RATE as i64 * CHANNELS as i64))
    }
}

#[derive(Clone, Debug)]
pub enum Packet {
    Control(Control),
    Audio(Arc<Chunk>),
}
pub fn write_packet(writer: &mut impl Write, packet: &Packet) -> io::Result<()> {
    let mut bytes = Vec::with_capacity(4096);
    match packet {
        Packet::Control(control) => {
            bytes.push(1);
            serde_json::to_writer(&mut bytes, control).map_err(io::Error::other)?;
        }
        Packet::Audio(chunk) => {
            bytes.push(2);
            bytes.extend_from_slice(&chunk.epoch.to_le_bytes());
            bytes.extend_from_slice(&chunk.at.to_le_bytes());
            for sample in chunk.samples.iter() {
                bytes.extend_from_slice(&sample.to_le_bytes());
            }
        }
    }
    if bytes.len() > MAX_PACKET {
        return Err(invalid("Message exceeds protocol limit"));
    }
    writer.write_all(&(bytes.len() as u32).to_be_bytes())?;
    writer.write_all(&bytes)
}
pub fn read_packet(reader: &mut impl Read) -> io::Result<Packet> {
    let mut size = [0; 4];
    reader.read_exact(&mut size)?;
    let size = u32::from_be_bytes(size) as usize;
    if !(2..=MAX_PACKET).contains(&size) {
        return Err(invalid("Invalid message size"));
    }
    let mut bytes = vec![0; size];
    reader.read_exact(&mut bytes)?;
    match bytes[0] {
        1 => serde_json::from_slice(&bytes[1..])
            .map(Packet::Control)
            .map_err(io::Error::other),
        2 if size >= 21 && (size - 17) % 4 == 0 && size <= 17 + FRAMES * 4 => {
            let epoch = u64::from_le_bytes(bytes[1..9].try_into().unwrap());
            let at = i64::from_le_bytes(bytes[9..17].try_into().unwrap());
            let samples = bytes[17..]
                .chunks_exact(2)
                .map(|b| i16::from_le_bytes([b[0], b[1]]))
                .collect();
            Ok(Packet::Audio(Arc::new(Chunk {
                epoch,
                at,
                samples: Arc::new(samples),
            })))
        }
        _ => Err(invalid("Unsupported or malformed message")),
    }
}
fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pcm_round_trip_preserves_stereo_and_timestamps() {
        let packet = Packet::Audio(Arc::new(Chunk {
            epoch: 3,
            at: 1234567,
            samples: Arc::new(vec![i16::MIN, i16::MAX, -42, 105]),
        }));
        let mut bytes = Vec::new();
        write_packet(&mut bytes, &packet).unwrap();
        let Packet::Audio(read) = read_packet(&mut bytes.as_slice()).unwrap() else {
            panic!()
        };
        assert_eq!((read.epoch, read.at), (3, 1234567));
        assert_eq!(*read.samples, vec![i16::MIN, i16::MAX, -42, 105]);
    }
    #[test]
    fn untrusted_packet_lengths_and_partial_frames_are_rejected() {
        assert!(read_packet(&mut u32::MAX.to_be_bytes().as_slice()).is_err());
        assert!(read_packet(&mut [0, 0, 0, 4, 2, 0, 0, 0].as_slice()).is_err());
        assert!(read_packet(&mut [0, 0, 0, 20, 2, 0].as_slice()).is_err());
    }
}
