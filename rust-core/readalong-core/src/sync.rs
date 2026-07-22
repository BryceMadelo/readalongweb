use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SyncPoint {
    pub paragraph_id: String,
    pub timestamp_ms: u64,
    pub confidence: Option<f32>,
}

pub struct SyncEngine {
    /// Sorted ascending by timestamp_ms. Used for Audio → Text sync.
    by_timestamp: Vec<SyncPoint>,
    /// HashMap for O(1) lookups. Used for Text → Audio seek.
    by_paragraph: HashMap<String, u64>,
}

impl SyncEngine {
    /// Constructs a new SyncEngine, guaranteeing chronological order.
    pub fn new(mut points: Vec<SyncPoint>) -> Self {
        points.sort_by_key(|p| p.timestamp_ms);

        let mut by_paragraph = HashMap::with_capacity(points.len());
        for point in &points {
            by_paragraph
                .entry(point.paragraph_id.clone())
                .or_insert(point.timestamp_ms);
        }

        Self {
            by_timestamp: points,
            by_paragraph,
        }
    }

    /// Audio → Text direction: Returns the paragraph ID currently being narrated.
    pub fn active_paragraph(&self, timestamp_ms: u64) -> Option<&str> {
        if self.by_timestamp.is_empty() {
            return None;
        }

        let idx = self
            .by_timestamp
            .partition_point(|p| p.timestamp_ms <= timestamp_ms);

        if idx == 0 {
            return None;
        }

        Some(&self.by_timestamp[idx - 1].paragraph_id)
    }

    /// Text → Audio direction: Returns the exact millisecond a paragraph begins.
    pub fn timestamp_for_paragraph(&self, paragraph_id: &str) -> Option<u64> {
        self.by_paragraph.get(paragraph_id).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_engine() -> SyncEngine {
        SyncEngine::new(vec![
            SyncPoint {
                paragraph_id: "p2".to_string(),
                timestamp_ms: 4500,
                confidence: None,
            },
            SyncPoint {
                paragraph_id: "p3".to_string(),
                timestamp_ms: 8000,
                confidence: None,
            },
            SyncPoint {
                paragraph_id: "p1".to_string(),
                timestamp_ms: 1000,
                confidence: None,
            },
        ])
    }

    #[test]
    fn test_before_first_point() {
        let engine = setup_engine();
        assert_eq!(engine.active_paragraph(500), None);
    }

    #[test]
    fn test_exact_match() {
        let engine = setup_engine();
        assert_eq!(engine.active_paragraph(1000), Some("p1"));
        assert_eq!(engine.active_paragraph(4500), Some("p2"));
    }

    #[test]
    fn test_between_anchors() {
        let engine = setup_engine();
        assert_eq!(engine.active_paragraph(2000), Some("p1"));
        assert_eq!(engine.active_paragraph(7999), Some("p2"));
    }

    #[test]
    fn test_after_last_point() {
        let engine = setup_engine();
        assert_eq!(engine.active_paragraph(15000), Some("p3"));
    }

    #[test]
    fn test_tap_to_seek() {
        let engine = setup_engine();
        assert_eq!(engine.timestamp_for_paragraph("p2"), Some(4500));
        assert_eq!(engine.timestamp_for_paragraph("p_missing"), None);
    }

    #[test]
    fn test_empty_engine() {
        let engine = SyncEngine::new(vec![]);
        assert_eq!(engine.active_paragraph(1000), None);
        assert_eq!(engine.timestamp_for_paragraph("p1"), None);
    }
}
