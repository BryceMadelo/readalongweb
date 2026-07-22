use readalong_core::content::{parse_chapter_html, ContentBlock};
use readalong_core::epub::{
    find_opf_path, parse_opf_spine, read_zip_entry_as_string, resolve_opf_relative,
    validate_epub_bytes,
};
use readalong_core::sync::{SyncEngine, SyncPoint as CoreSyncPoint};
use std::collections::HashMap;
use std::io::{Cursor, Read};
use wasm_bindgen::prelude::*;
use zip::ZipArchive;

#[wasm_bindgen]
#[derive(Clone, serde::Serialize)]
pub struct SyncPoint {
    #[wasm_bindgen(skip)]
    pub paragraph_id: String,
    #[wasm_bindgen(skip)]
    pub timestamp_ms: u64,
    #[wasm_bindgen(skip)]
    pub confidence: Option<f32>,
}

#[wasm_bindgen]
impl SyncPoint {
    #[wasm_bindgen(constructor)]
    pub fn new(paragraph_id: String, timestamp_ms: u64, confidence: Option<f32>) -> SyncPoint {
        SyncPoint {
            paragraph_id,
            timestamp_ms,
            confidence,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn paragraph_id(&self) -> String {
        self.paragraph_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn timestamp_ms(&self) -> f64 {
        self.timestamp_ms as f64
    }

    #[wasm_bindgen(getter)]
    pub fn confidence(&self) -> Option<f32> {
        self.confidence
    }
}

impl SyncPoint {
    fn to_core(&self) -> CoreSyncPoint {
        CoreSyncPoint {
            paragraph_id: self.paragraph_id.clone(),
            timestamp_ms: self.timestamp_ms,
            confidence: self.confidence,
        }
        // If `CoreSyncPoint`'s fields aren't public, use whatever
        // constructor readalong_core exposes instead, e.g.:
        // CoreSyncPoint::new(self.paragraph_id.clone(), self.timestamp_ms)
    }
}

// --- SYNC PLAYER BRIDGE ---

#[wasm_bindgen]
pub struct PlaybackSync {
    points: Vec<SyncPoint>,
    engine: Option<SyncEngine>,
}

#[wasm_bindgen]
impl PlaybackSync {
    #[wasm_bindgen(constructor)]
    pub fn new() -> PlaybackSync {
        PlaybackSync {
            points: Vec::new(),
            engine: None,
        }
    }

    pub fn add_sync_point(&mut self, paragraph_id: String, timestamp_ms: f64, confidence: Option<f32>) {
        self.points.push(SyncPoint {
            paragraph_id,
            timestamp_ms: timestamp_ms as u64,
            confidence,
        });
    }

    pub fn build_engine(&mut self) {
        let core_points: Vec<CoreSyncPoint> = self.points.iter().map(SyncPoint::to_core).collect();
        self.engine = Some(SyncEngine::new(core_points));
    }

    pub fn get_active_paragraph(&self, current_time_ms: f64) -> Option<String> {
        self.engine
            .as_ref()
            .and_then(|engine| engine.active_paragraph(current_time_ms as u64))
            .map(|id| id.to_string())
    }
}

#[derive(serde::Serialize)]
pub struct EpubData {
    pub blocks: Vec<ContentBlock>,
    pub images: HashMap<String, Vec<u8>>,
    pub error: Option<String>,
}

#[wasm_bindgen]
pub fn load_epub_paragraphs(bytes: &[u8]) -> JsValue {
    let cursor = Cursor::new(bytes);

    let mut archive = match ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(_) => {
            return serde_wasm_bindgen::to_value(&EpubData {
                blocks: vec![],
                images: HashMap::new(),
                error: Some("Error: Invalid ZIP archive".to_string()),
            })
            .unwrap()
        }
    };

    let opf_path = match find_opf_path(&mut archive) {
        Ok(p) => p,
        Err(e) => {
            return serde_wasm_bindgen::to_value(&EpubData {
                blocks: vec![],
                images: HashMap::new(),
                error: Some(format!("Error: {}", e)),
            })
            .unwrap()
        }
    };

    let opf_xml = match read_zip_entry_as_string(&mut archive, &opf_path) {
        Ok(xml) => xml,
        Err(e) => {
            return serde_wasm_bindgen::to_value(&EpubData {
                blocks: vec![],
                images: HashMap::new(),
                error: Some(format!("Error: {}", e)),
            })
            .unwrap()
        }
    };

    let spine = match parse_opf_spine(&opf_xml) {
        Ok(s) => s,
        Err(e) => {
            return serde_wasm_bindgen::to_value(&EpubData {
                blocks: vec![],
                images: HashMap::new(),
                error: Some(format!("Error: {}", e)),
            })
            .unwrap()
        }
    };

    // Extract title and author from OPF metadata for junk filtering
    let mut title = None;
    let mut author = None;
    if let Ok(doc) = roxmltree::Document::parse(&opf_xml) {
        if let Some(metadata) = doc.descendants().find(|n| n.tag_name().name() == "metadata") {
            for child in metadata.children() {
                if child.tag_name().name() == "title" {
                    title = child.text().map(|s| s.to_string());
                } else if child.tag_name().name() == "creator" {
                    author = child.text().map(|s| s.to_string());
                }
            }
        }
    }

    let opf_dir = opf_path.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");
    let mut all_blocks = Vec::new();
    let mut images = HashMap::new();

    for item in spine {
        let full_path = resolve_opf_relative(opf_dir, &item.href);
        let chapter_dir = full_path.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");

        if let Ok(content) = read_zip_entry_as_string(&mut archive, &full_path) {
            let mut blocks = parse_chapter_html(&content, title.as_deref(), author.as_deref());
            for block in &mut blocks {
                // Make the block ID globally unique by prefixing with the chapter ID
                block.id = format!("{}_{}", item.id, block.id);

                if block.tag == "img" {
                    if let Some(src) = &block.src {
                        let img_path = resolve_opf_relative(chapter_dir, src);
                        if !images.contains_key(&img_path) {
                            if let Some(idx) =
                                readalong_core::epub::find_zip_index(&mut archive, &img_path)
                            {
                                if let Ok(mut file) = archive.by_index(idx) {
                                    let mut img_bytes = Vec::new();
                                    if file.read_to_end(&mut img_bytes).is_ok() {
                                        images.insert(img_path.clone(), img_bytes);
                                    }
                                }
                            }
                        }
                        // Update src to the resolved full path so frontend can map it
                        block.src = Some(img_path);
                    }
                }
            }
            all_blocks.extend(blocks);
        }
    }

    if all_blocks.is_empty() {
        serde_wasm_bindgen::to_value(&EpubData {
            blocks: vec![],
            images: HashMap::new(),
            error: Some("Error: No readable chapters found.".to_string()),
        })
        .unwrap()
    } else {
        serde_wasm_bindgen::to_value(&EpubData {
            blocks: all_blocks,
            images,
            error: None,
        })
        .unwrap()
    }
}

// --- EPUB 3 MEDIA OVERLAY (SMIL) PARSER ---

#[wasm_bindgen]
pub fn load_epub_smil_sync(bytes: &[u8]) -> JsValue {
    let cursor = Cursor::new(bytes);
    let mut archive = match ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(_) => return serde_wasm_bindgen::to_value(&Vec::<SyncPoint>::new()).unwrap(),
    };

    let mut points = Vec::new();

    // 1. Search the EPUB contents for a SMIL file (.smil)
    for i in 0..archive.len() {
        let mut file = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };

        let name = file.name().to_lowercase();
        if name.ends_with(".smil") {
            let mut content = String::new();
            if file.read_to_string(&mut content).is_ok() {
                // 2. Parse the XML content using roxmltree
                if let Ok(doc) = roxmltree::Document::parse(&content) {
                    // 3. Find all parallel elements (<par>)
                    for node in doc.descendants().filter(|n| n.has_tag_name("par")) {
                        let text_id = node
                            .children()
                            .find(|n| n.has_tag_name("text"))
                            .and_then(|n| n.attribute("src"))
                            .and_then(|src| src.split('#').nth(1));

                        let clip_begin = node
                            .children()
                            .find(|n| n.has_tag_name("audio"))
                            .and_then(|n| n.attribute("clipBegin"))
                            .and_then(|val| parse_smil_time(val));

                        if let Some(id) = text_id {
                            if let Some(time_ms) = clip_begin {
                                points.push(SyncPoint {
                                    paragraph_id: id.to_string(),
                                    timestamp_ms: time_ms,
                                    confidence: None,
                                });
                            }
                        }
                    }
                }
            }
            break;
        }
    }

    serde_wasm_bindgen::to_value(&points).unwrap()
}

/// Helper to convert SMIL time strings (e.g., "12.5s") into milliseconds
fn parse_smil_time(time_str: &str) -> Option<u64> {
    let clean = time_str.trim();
    if clean.ends_with('s') {
        let num_str = &clean[..clean.len() - 1];
        let seconds: f64 = num_str.parse().ok()?;
        return Some((seconds * 1000.0) as u64);
    }
    None
}

// Add `Read` to your existing std::io imports if not already there
// use std::io::{Cursor, Read};

#[wasm_bindgen]
pub fn load_epub_images(bytes: &[u8]) -> js_sys::Array {
    let result_array = js_sys::Array::new();
    let cursor = Cursor::new(bytes);

    let mut archive = match ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(_) => return result_array,
    };

    for i in 0..archive.len() {
        let mut file = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };

        let name = file.name().to_string();
        let lower_name = name.to_lowercase();

        // Check if the file is a standard image type
        if lower_name.ends_with(".jpg")
            || lower_name.ends_with(".jpeg")
            || lower_name.ends_with(".png")
            || lower_name.ends_with(".gif")
        {
            let mut buffer = Vec::new();
            if file.read_to_end(&mut buffer).is_ok() {
                // Create a JS Array [String, Uint8Array]
                let pair = js_sys::Array::new();
                pair.push(&JsValue::from_str(&name));

                // Convert Rust Vec<u8> to JS Uint8Array
                let uint8_arr = js_sys::Uint8Array::from(buffer.as_slice());
                pair.push(&uint8_arr);

                result_array.push(&pair);
            }
        }
    }

    result_array
}
