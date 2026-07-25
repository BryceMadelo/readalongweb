use scraper::{Html, Selector};

#[derive(Debug, PartialEq, Clone, serde::Serialize)]
pub struct ContentBlock {
    pub id: String,
    pub tag: String,
    pub text: String,
    pub src: Option<String>,
    pub needs_review: bool,
}

/// Parses messy chapter HTML and extracts readable blocks with their IDs.
/// Filters out clear non-narrative junk paragraphs.
pub fn parse_chapter_html(html_content: &str, title: Option<&str>, author: Option<&str>) -> Vec<ContentBlock> {
    // scraper's Html::parse_document is highly forgiving of malformed HTML
    let document = Html::parse_document(html_content);

    // Target paragraphs, headings, and images
    let selector = Selector::parse("p, h1, h2, h3, h4, h5, h6, img").unwrap();

    let mut blocks = Vec::new();

    for (index, element) in document.select(&selector).enumerate() {
        let tag = element.value().name().to_string();
        
        if tag == "img" {
            let src = element.value().attr("src").map(|s| s.to_string());
            let id = format!("auto_img_{}", index);
                
            blocks.push(ContentBlock {
                id,
                tag,
                text: String::new(),
                src,
                needs_review: false,
            });
            continue;
        }

        // Collect all text nodes inside the element, ignoring nested tags like <b> or <span>
        let raw_text = element.text().collect::<String>();
        let text = raw_text.split_whitespace().collect::<Vec<_>>().join(" ");

        // Skip purely empty structural paragraphs
        if text.is_empty() {
            continue;
        }

        let lower_text = text.to_lowercase();

        // Obvious junk that will never match narration
        if lower_text.contains("oceanofpdf.com") ||
           lower_text.contains("epub r1.0") ||
           lower_text == "oceanofpdf.com" {
            continue;
        }

        let mut needs_review = false;

        // Check if text is just the author or title (ambiguous metadata)
        if let Some(t) = title {
            if lower_text == t.to_lowercase() {
                needs_review = true;
            }
        }

        if let Some(a) = author {
            if lower_text == a.to_lowercase() {
                needs_review = true;
            }
        }

        // Also flag very short standalone lines that look like version tags or random uploader tags
        if lower_text.starts_with("epub r") && lower_text.len() < 15 {
            continue;
        }

        // Always generate a deterministic ID for alignment, ignoring native HTML IDs to ensure consistency
        let id = format!("auto_{}_{}", tag, index);

        blocks.push(ContentBlock {
            id,
            tag,
            text,
            src: None,
            needs_review,
        });
    }

    let mut merged_blocks: Vec<ContentBlock> = Vec::new();

    for block in blocks {
        if let Some(last_block) = merged_blocks.last_mut() {
            if last_block.tag != "img" && last_block.tag == block.tag {
                let last_text = last_block.text.trim();
                let ends_with_punc = last_text.ends_with(|c: char| {
                    matches!(c, '.' | '!' | '?' | '"' | '\'' | '”' | '’' | ':' | ';' | '-' | '…' | ']' | ')')
                });

                let last_word_count = last_text.split_whitespace().count();
                let current_word_count = block.text.split_whitespace().count();

                let first_char_is_lowercase = block
                    .text
                    .trim()
                    .chars()
                    .find(|c| c.is_alphabetic())
                    .map_or(false, |c| c.is_lowercase());

                let is_short_fragment = last_word_count < 5 && current_word_count < 5;

                if !ends_with_punc && (is_short_fragment || first_char_is_lowercase) {
                    last_block.text.push(' ');
                    last_block.text.push_str(block.text.trim());
                    last_block.needs_review = last_block.needs_review || block.needs_review;
                    continue;
                }
            }
        }
        merged_blocks.push(block);
    }

    merged_blocks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extracts_blocks_with_ids() {
        let html = r#"
            <html>
                <body>
                    <h1 id="h1">Chapter Title</h1>
                    <p id="p1">First paragraph.</p>
                    <img src="test.jpg" id="img1"/>
                </body>
            </html>
        "#;

        let result = parse_chapter_html(html, None, None);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].id, "auto_h1_0");
        assert_eq!(result[0].tag, "h1");
        assert_eq!(result[0].text, "Chapter Title");
        
        assert_eq!(result[1].id, "auto_p_1");
        assert_eq!(result[1].tag, "p");
        assert_eq!(result[1].text, "First paragraph.");
        
        assert_eq!(result[2].id, "auto_img_2");
        assert_eq!(result[2].tag, "img");
        assert_eq!(result[2].src, Some("test.jpg".to_string()));
    }

    #[test]
    fn test_filters_out_junk() {
        let html = r#"
            <html>
                <body>
                    <p>OceanofPDF.com</p>
                    <h1 id="h1">My Awesome Book</h1>
                    <p id="p1">First paragraph of real content.</p>
                    <p>ePub r1.0</p>
                    <p>John Doe</p>
                    <p>oceanofpdf.com</p>
                </body>
            </html>
        "#;

        let result = parse_chapter_html(html, Some("My Awesome Book"), Some("John Doe"));

        // Should only have 3 items (Title, Paragraph, Author)
        // OceanofPDF and ePub r1.0 should be dropped
        assert_eq!(result.len(), 3);

        assert_eq!(result[0].text, "My Awesome Book");
        assert_eq!(result[0].needs_review, true);

        assert_eq!(result[1].text, "First paragraph of real content.");
        assert_eq!(result[1].needs_review, false);

        assert_eq!(result[2].text, "John Doe");
        assert_eq!(result[2].needs_review, true);
    }

    #[test]
    fn test_merges_short_paragraphs() {
        let html = r#"
            <html>
                <body>
                    <p>The</p>
                    <p>Assassin</p>
                    <p>and the</p>
                    <p>Pirate Lord</p>
                    <h2>Chapter 1</h2>
                </body>
            </html>
        "#;

        let result = parse_chapter_html(html, None, None);

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].text, "The Assassin and the Pirate Lord");
        assert_eq!(result[0].tag, "p");
        assert_eq!(result[1].text, "Chapter 1");
        assert_eq!(result[1].tag, "h2");
    }
}
