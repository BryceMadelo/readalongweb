use crate::smil;
use crate::sync::SyncPoint; // ← adjust to `crate::models::SyncPoint` if that's where it actually lives
use roxmltree::Document;
use std::io::{Cursor, Read};
use zip::ZipArchive;

#[derive(Debug, PartialEq, Clone)]
pub struct SpineItem {
    pub id: String,
    pub href: String,
    /// Present only for EPUB3 chapters marked properties="media-overlay" —
    /// holds the href of the companion .smil file, resolved from the manifest.
    pub smil_href: Option<String>,
}

/// Parses an OPF XML string and returns the ordered list of chapters (the spine).
/// Each chapter also carries its SMIL companion href, if the EPUB has one —
/// that's what makes a chapter "natively synced" vs. needing manual/AI alignment.
pub fn parse_opf_spine(opf_xml: &str) -> Result<Vec<SpineItem>, String> {
    let doc = Document::parse(opf_xml).map_err(|e| e.to_string())?;

    let manifest = doc
        .descendants()
        .find(|n| n.tag_name().name() == "manifest")
        .ok_or("Invalid EPUB: No <manifest> found in OPF")?;

    let spine = doc
        .descendants()
        .find(|n| n.tag_name().name() == "spine")
        .ok_or("Invalid EPUB: No <spine> found in OPF")?;

    let mut items = Vec::new();

    for itemref in spine
        .children()
        .filter(|n| n.tag_name().name() == "itemref")
    {
        let idref = match itemref.attribute("idref") {
            Some(v) => v,
            None => continue,
        };

        let matched_item = manifest
            .children()
            .find(|n| n.attribute("id") == Some(idref));

        let item = match matched_item {
            Some(i) => i,
            None => continue,
        };

        let href = match item.attribute("href") {
            Some(h) => h.to_string(),
            None => continue,
        };

        // EPUB3 marks a synced chapter with properties="media-overlay" and
        // points at the SMIL's own manifest id via the media-overlay attribute.
        // We resolve that id to an actual href right here, so downstream code
        // never has to re-walk the manifest to find it.
        let smil_href = if item.attribute("properties") == Some("media-overlay") {
            item.attribute("media-overlay").and_then(|smil_id| {
                manifest
                    .children()
                    .find(|n| n.attribute("id") == Some(smil_id))
                    .and_then(|smil_item| smil_item.attribute("href"))
                    .map(|h| h.to_string())
            })
        } else {
            None
        };

        items.push(SpineItem {
            id: idref.to_string(),
            href,
            smil_href,
        });
    }

    Ok(items)
}

/// Takes raw file bytes, unzips them in memory, and validates the EPUB format.
pub fn validate_epub_bytes(bytes: &[u8]) -> Result<String, String> {
    // 1. Create a virtual file reader from the raw bytes
    let cursor = Cursor::new(bytes);

    // 2. Open it as a Zip Archive
    let mut archive = ZipArchive::new(cursor).map_err(|e| e.to_string())?;

    // 3. Prepare our string
    let mut mimetype_content = String::new();

    // 4. Find the mandatory mimetype file (borrows `archive` mutably)
    let mut mimetype_file = archive
        .by_name("mimetype")
        .map_err(|_| "Invalid EPUB: No mimetype file found in root".to_string())?;

    // 5. Read the file contents into a string
    mimetype_file
        .read_to_string(&mut mimetype_content)
        .map_err(|e| e.to_string())?;

    // 6. EXPLICITLY DESTROY the file variable to release the lock on `archive`!
    drop(mimetype_file);

    // 7. Verify it's actually an EPUB and not a renamed ZIP
    if mimetype_content.trim() != "application/epub+zip" {
        return Err("Invalid EPUB: Incorrect mimetype".to_string());
    }

    // 8. Safely borrow `archive` immutably to check its length (the lock is gone)
    Ok(format!(
        "Success! Valid EPUB containing {} internal files.",
        archive.len()
    ))
}

/// Reads a single zip entry into a String. Generic over any Read + Seek source
/// (an in-memory Cursor<Vec<u8>> today; could be a File later on mobile).
pub fn read_zip_entry_as_string<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    path: &str,
) -> Result<String, String> {
    let mut file = archive
        .by_name(path)
        .map_err(|e| format!("Missing zip entry '{}': {}", path, e))?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    Ok(contents)
}

/// EPUB hrefs inside the manifest are relative to the .opf file's own
/// directory, not the zip root — e.g. if content.opf lives at "OEBPS/content.opf"
/// and the manifest says href="text/chap1.xhtml", the real zip path is
/// "OEBPS/text/chap1.xhtml". This applies to every manifest href, not just
/// SMIL files, so if chapter hrefs aren't already being resolved this way
/// elsewhere, that's a latent bug worth fixing in one shared place.
pub fn resolve_opf_relative(opf_dir: &str, href: &str) -> String {
    let mut parts = Vec::new();

    if !opf_dir.is_empty() {
        for part in opf_dir.split('/') {
            if !part.is_empty() {
                parts.push(part);
            }
        }
    }

    for part in href.split('/') {
        if part == "." || part.is_empty() {
            continue;
        } else if part == ".." {
            parts.pop();
        } else {
            parts.push(part);
        }
    }

    parts.join("/")
}

/// Reads META-INF/container.xml to find the root OPF file path.
pub fn find_opf_path<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<String, String> {
    let container_xml = read_zip_entry_as_string(archive, "META-INF/container.xml")?;
    let doc = Document::parse(&container_xml).map_err(|e| e.to_string())?;

    for node in doc.descendants() {
        if node.tag_name().name() == "rootfile" {
            if let Some(path) = node.attribute("full-path") {
                return Ok(path.to_string());
            }
        }
    }

    Err("Invalid EPUB: No OPF path found in container.xml".to_string())
}

/// Given a spine item that has a SMIL companion, reads and parses that SMIL
/// file out of the archive and converts its clips into SyncPoints.
/// Returns an empty Vec (not an error) for chapters with no overlay — this
/// is the normal case for a plain, unsynced EPUB, not a failure.
pub fn sync_points_from_overlay<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    spine_item: &SpineItem,
    opf_dir: &str,
) -> Result<Vec<SyncPoint>, String> {
    let smil_href = match &spine_item.smil_href {
        Some(h) => h,
        None => return Ok(Vec::new()),
    };

    let full_path = resolve_opf_relative(opf_dir, smil_href);
    let smil_xml = read_zip_entry_as_string(archive, &full_path)?;
    let clips = smil::parse_smil(&smil_xml).map_err(|e| format!("{:?}", e))?;

    Ok(clips
        .into_iter()
        .map(|clip| SyncPoint {
            paragraph_id: clip.paragraph_id,
            timestamp_ms: clip.clip_begin_ms,
            confidence: None,
        })
        .collect())
}

/// Finds a file in the zip archive by trying exact match, URL-decoded match, and case-insensitive match
pub fn find_zip_index(
    archive: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>,
    path: &str,
) -> Option<usize> {
    let decoded = path.replace("%20", " ");
    for i in 0..archive.len() {
        if let Ok(file) = archive.by_index(i) {
            let name = file.name();
            if name == path
                || name == decoded
                || name.eq_ignore_ascii_case(path)
                || name.eq_ignore_ascii_case(&decoded)
            {
                return Some(i);
            }
        }
    }

    // Fallback: search by basename (filename only)
    let basename = path.rsplit('/').next().unwrap_or(path);
    let decoded_basename = basename.replace("%20", " ");

    for i in 0..archive.len() {
        if let Ok(file) = archive.by_index(i) {
            let file_basename = file.name().rsplit('/').next().unwrap_or(file.name());
            if file_basename.eq_ignore_ascii_case(basename)
                || file_basename.eq_ignore_ascii_case(&decoded_basename)
            {
                return Some(i);
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_opf() {
        let valid_opf = r#"<?xml version="1.0" encoding="UTF-8"?>
            <package version="3.0" unique-identifier="pub-id">
                <manifest>
                    <item id="chapter1" href="text/chap1.xhtml" media-type="application/xhtml+xml"/>
                    <item id="chapter2" href="text/chap2.xhtml" media-type="application/xhtml+xml"/>
                    <item id="cover" href="images/cover.jpg" media-type="image/jpeg"/>
                </manifest>
                <spine>
                    <itemref idref="chapter1"/>
                    <itemref idref="chapter2"/>
                </spine>
            </package>"#;

        let result = parse_opf_spine(valid_opf).unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].id, "chapter1");
        assert_eq!(result[0].href, "text/chap1.xhtml");
        assert_eq!(result[0].smil_href, None);
        assert_eq!(result[1].id, "chapter2");
        assert_eq!(result[1].href, "text/chap2.xhtml");
    }

    #[test]
    fn test_missing_manifest_fails_gracefully() {
        let invalid_opf = r#"<package><spine></spine></package>"#;
        let result = parse_opf_spine(invalid_opf);
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "Invalid EPUB: No <manifest> found in OPF"
        );
    }

    #[test]
    fn test_parse_opf_with_media_overlay() {
        let synced_opf = r#"<?xml version="1.0" encoding="UTF-8"?>
            <package version="3.0" unique-identifier="pub-id">
                <manifest>
                    <item id="chapter1" href="text/chap1.xhtml"
                          media-type="application/xhtml+xml"
                          properties="media-overlay"
                          media-overlay="chapter1_smil"/>
                    <item id="chapter1_smil" href="smil/chap1.smil"
                          media-type="application/smil+xml"/>
                </manifest>
                <spine>
                    <itemref idref="chapter1"/>
                </spine>
            </package>"#;

        let result = parse_opf_spine(synced_opf).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].smil_href, Some("smil/chap1.smil".to_string()));
    }

    #[test]
    fn test_resolve_opf_relative() {
        assert_eq!(
            resolve_opf_relative("OEBPS", "smil/chap1.smil"),
            "OEBPS/smil/chap1.smil"
        );
        assert_eq!(
            resolve_opf_relative("", "smil/chap1.smil"),
            "smil/chap1.smil"
        );
    }
}
