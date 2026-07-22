use scraper::{Html, Selector};

#[derive(Debug, PartialEq, Clone, serde::Serialize)]
pub struct ContentBlock {
    pub id: String,
    pub tag: String,
    pub text: String,
    pub src: Option<String>,
}

/// Parses messy chapter HTML and extracts readable blocks with their IDs.
pub fn parse_chapter_html(html_content: &str) -> Vec<ContentBlock> {
    // scraper's Html::parse_document is highly forgiving of malformed HTML
    let document = Html::parse_document(html_content);

    // Target paragraphs, headings, and images
    let selector = Selector::parse("p, h1, h2, h3, h4, h5, h6, img").unwrap();

    let mut blocks = Vec::new();

    for (index, element) in document.select(&selector).enumerate() {
        let tag = element.value().name().to_string();
        
        if tag == "img" {
            let src = element.value().attr("src").map(|s| s.to_string());
            let id = element.value().attr("id").map(|s| s.to_string())
                .unwrap_or_else(|| format!("auto_img_{}", index));
                
            blocks.push(ContentBlock {
                id,
                tag,
                text: String::new(),
                src,
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

        // Grab the existing ID, or generate a deterministic fallback ID for alignment
        let id = element
            .value()
            .attr("id")
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("auto_{}_{}", tag, index));

        blocks.push(ContentBlock {
            id,
            tag,
            text,
            src: None,
        });
    }

    blocks
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

        let result = parse_chapter_html(html);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].id, "h1");
        assert_eq!(result[0].tag, "h1");
        assert_eq!(result[0].text, "Chapter Title");
        
        assert_eq!(result[1].id, "p1");
        assert_eq!(result[1].tag, "p");
        assert_eq!(result[1].text, "First paragraph.");
        
        assert_eq!(result[2].id, "img1");
        assert_eq!(result[2].tag, "img");
        assert_eq!(result[2].src, Some("test.jpg".to_string()));
    }
}
