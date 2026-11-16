//! Personal star ratings, independent of explicit-content/advisory ratings.
use lofty::{
    id3::v2::{Frame, Id3v2Tag, PopularimeterFrame},
    tag::{ItemKey, Tag, TagType},
};

pub const OWNER: &str = "ratings@elysium.local";
const POPM_STARS: [u8; 6] = [0, 1, 64, 128, 196, 255];

fn from_popm(value: u8) -> u8 {
    match value {
        0 => 0,
        1..=31 => 1,
        32..=95 => 2,
        96..=159 => 3,
        160..=223 => 4,
        _ => 5,
    }
}
pub fn read(tag: &Tag) -> Option<u8> {
    match tag.tag_type() {
        TagType::Id3v2 => {
            let id3 = Id3v2Tag::from(tag.clone());
            let values: Vec<_> = (&id3)
                .into_iter()
                .filter_map(|f| match f {
                    Frame::Popularimeter(p) => Some((p.email.as_str(), p.rating)),
                    _ => None,
                })
                .collect();
            values
                .iter()
                .find(|(owner, _)| *owner == OWNER)
                .or_else(|| {
                    values
                        .iter()
                        .find(|(owner, _)| *owner == "Windows Media Player 9 Series")
                })
                .or_else(|| values.first())
                .map(|(_, value)| from_popm(*value))
        }
        // RATING is conventionally 0–100. Do not guess 1–5: a value of 5 means 5/100.
        TagType::VorbisComments => tag
            .get_string(&ItemKey::Popularimeter)
            .and_then(|s| s.trim().parse::<f64>().ok())
            .filter(|v| v.is_finite() && (0.0..=100.0).contains(v))
            .map(|v| {
                if v == 0.0 {
                    0
                } else {
                    (v / 20.0).round().clamp(1.0, 5.0) as u8
                }
            }),
        _ => None,
    }
}
pub fn set(tag: &mut Tag, stars: u8) -> Result<(), String> {
    if stars > 5 {
        return Err("Choose a rating from 1 to 5, or 0 to clear it.".into());
    }
    match tag.tag_type() {
        TagType::Id3v2 => {
            let mut id3 = Id3v2Tag::from(tag.clone());
            let mut personal = (&id3)
                .into_iter()
                .find_map(|f| match f {
                    Frame::Popularimeter(p) if p.email == OWNER => Some(p.clone()),
                    _ => None,
                })
                .unwrap_or_else(|| PopularimeterFrame::new(OWNER.into(), 0, 0));
            personal.rating = POPM_STARS[stars as usize];
            id3.insert(Frame::Popularimeter(personal));
            *tag = id3.into();
        }
        TagType::VorbisComments => {
            tag.insert_text(ItemKey::Popularimeter, (stars * 20).to_string());
        }
        _ => return Err("This file's rating stays in the Elysium library.".into()),
    }
    Ok(())
}
