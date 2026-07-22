use roxmltree::Document;

#[derive(Debug, Clone, PartialEq)]
pub struct SmilClip {
    pub paragraph_id: String, // fragment from the <text src="chapter1.xhtml#p0">
    pub audio_src: String,    // e.g. "audio/ch1.mp3"
    pub clip_begin_ms: u64,
    pub clip_end_ms: u64,
}

#[derive(Debug)]
pub enum SmilError {
    Xml(roxmltree::Error),
    BadClockValue(String),
    MissingAttr {
        element: &'static str,
        attr: &'static str,
    },
}

impl From<roxmltree::Error> for SmilError {
    fn from(e: roxmltree::Error) -> Self {
        SmilError::Xml(e)
    }
}

/// Parses an EPUB3 Media Overlay SMIL document into a flat list of clips.
/// One <par> = one text-audio pairing = one eventual SyncPoint.
pub fn parse_smil(xml: &str) -> Result<Vec<SmilClip>, SmilError> {
    let doc = Document::parse(xml)?;
    let mut clips = Vec::new();

    for par in doc.descendants().filter(|n| n.has_tag_name("par")) {
        let text_node =
            par.children()
                .find(|n| n.has_tag_name("text"))
                .ok_or(SmilError::MissingAttr {
                    element: "par",
                    attr: "text child",
                })?;

        let audio_node =
            par.children()
                .find(|n| n.has_tag_name("audio"))
                .ok_or(SmilError::MissingAttr {
                    element: "par",
                    attr: "audio child",
                })?;

        let text_src = text_node.attribute("src").ok_or(SmilError::MissingAttr {
            element: "text",
            attr: "src",
        })?;

        // "chapter1.xhtml#p0" -> "p0". Some files omit the fragment on
        // malformed pars; skip those rather than panic.
        let paragraph_id = match text_src.split_once('#') {
            Some((_, frag)) => frag.to_string(),
            None => continue,
        };

        let audio_src = audio_node
            .attribute("src")
            .ok_or(SmilError::MissingAttr {
                element: "audio",
                attr: "src",
            })?
            .to_string();

        let clip_begin_ms = parse_clock_value(audio_node.attribute("clipBegin").unwrap_or("0s"))?;
        let clip_end_ms = parse_clock_value(audio_node.attribute("clipEnd").ok_or(
            SmilError::MissingAttr {
                element: "audio",
                attr: "clipEnd",
            },
        )?)?;

        clips.push(SmilClip {
            paragraph_id,
            audio_src,
            clip_begin_ms,
            clip_end_ms,
        });
    }

    Ok(clips)
}

/// SMIL clock values show up in the wild in three shapes:
///   "8.5s"          - seconds with unit suffix
///   "00:00:08.500"  - full clock value (hh:mm:ss.mmm)
///   "8.5"           - bare number, treated as seconds
/// Real-world EPUBs are inconsistent about this, so handle all three.
fn parse_clock_value(raw: &str) -> Result<u64, SmilError> {
    let s = raw.trim();

    if let Some(secs_str) = s.strip_suffix("ms") {
        return secs_str
            .trim()
            .parse::<f64>()
            .map(|ms| ms.round() as u64)
            .map_err(|_| SmilError::BadClockValue(raw.to_string()));
    }
    if let Some(secs_str) = s.strip_suffix('s') {
        return secs_str
            .trim()
            .parse::<f64>()
            .map(|secs| (secs * 1000.0).round() as u64)
            .map_err(|_| SmilError::BadClockValue(raw.to_string()));
    }
    if s.contains(':') {
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() != 3 {
            return Err(SmilError::BadClockValue(raw.to_string()));
        }
        let hours: f64 = parts[0]
            .parse()
            .map_err(|_| SmilError::BadClockValue(raw.to_string()))?;
        let mins: f64 = parts[1]
            .parse()
            .map_err(|_| SmilError::BadClockValue(raw.to_string()))?;
        let secs: f64 = parts[2]
            .parse()
            .map_err(|_| SmilError::BadClockValue(raw.to_string()))?;
        let total_ms = (hours * 3_600_000.0) + (mins * 60_000.0) + (secs * 1000.0);
        return Ok(total_ms.round() as u64);
    }
    // bare number -> seconds
    s.parse::<f64>()
        .map(|secs| (secs * 1000.0).round() as u64)
        .map_err(|_| SmilError::BadClockValue(raw.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clock_value_seconds_suffix() {
        assert_eq!(parse_clock_value("8.5s").unwrap(), 8500);
    }

    #[test]
    fn clock_value_full_clock() {
        assert_eq!(parse_clock_value("00:00:08.500").unwrap(), 8500);
    }

    #[test]
    fn clock_value_bare_number() {
        assert_eq!(parse_clock_value("8.5").unwrap(), 8500);
    }

    #[test]
    fn clock_value_hours() {
        assert_eq!(parse_clock_value("01:00:00.000").unwrap(), 3_600_000);
    }

    #[test]
    fn parses_basic_par() {
        let xml = r#"<smil xmlns="http://www.w3.org/ns/SMIL">
            <body>
                <seq>
                    <par>
                        <text src="chapter1.xhtml#p0"/>
                        <audio src="audio.mp3" clipBegin="0.000s" clipEnd="8.500s"/>
                    </par>
                </seq>
            </body>
        </smil>"#;
        let clips = parse_smil(xml).unwrap();
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].paragraph_id, "p0");
        assert_eq!(clips[0].clip_begin_ms, 0);
        assert_eq!(clips[0].clip_end_ms, 8500);
    }

    #[test]
    fn skips_par_missing_fragment() {
        let xml = r#"<smil xmlns="http://www.w3.org/ns/SMIL">
            <body><seq><par>
                <text src="chapter1.xhtml"/>
                <audio src="audio.mp3" clipBegin="0s" clipEnd="1s"/>
            </par></seq></body>
        </smil>"#;
        assert_eq!(parse_smil(xml).unwrap().len(), 0);
    }
}
