import { type ContentBlock } from '../../storage/db';

interface ReaderTOCProps {
  paragraphs: ContentBlock[];
  onSelect: (index: number) => void;
  activeIndex: number | null;
  onClose?: () => void;
}

export function ReaderTOC({ paragraphs, onSelect, activeIndex, onClose }: ReaderTOCProps) {
  // Extract all headings (h1, h2, etc.)
  const headings = paragraphs
    .map((block, index) => ({ ...block, index }))
    .filter(block => block.tag.startsWith('h'));

  // Find which chapter is currently active
  let currentChapterIndex = -1;
  if (activeIndex !== null) {
    for (let i = headings.length - 1; i >= 0; i--) {
      if (headings[i].index <= activeIndex) {
        currentChapterIndex = headings[i].index;
        break;
      }
    }
  }

  return (
    <div style={{ width: '250px', borderRight: '1px solid var(--border-color)', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-secondary)', flexShrink: 0 }}>
      <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Contents</h3>
        {onClose && (
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--text-secondary)' }}>✕</button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 0' }}>
        {headings.length === 0 ? (
          <div style={{ padding: '1rem', color: 'var(--text-secondary)', textAlign: 'center', fontSize: '0.875rem' }}>
            No chapters found
          </div>
        ) : (
          headings.map((h, idx) => {
            const isCurrent = h.index === currentChapterIndex;
            return (
              <button
                key={h.id || idx}
                onClick={() => onSelect(h.index)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.75rem 1.5rem',
                  border: 'none',
                  background: isCurrent ? 'var(--bg-tertiary)' : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  color: isCurrent ? 'var(--accent-primary)' : 'var(--text-primary)',
                  transition: 'background 0.2s',
                  borderLeft: isCurrent ? '3px solid var(--accent-primary)' : '3px solid transparent',
                }}
                onMouseOver={(e) => !isCurrent && (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
                onMouseOut={(e) => !isCurrent && (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <span style={{ fontSize: '0.75rem', color: isCurrent ? 'var(--accent-primary)' : 'var(--text-secondary)', minWidth: '1.5rem' }}>
                  {String(idx).padStart(2, '0')}
                </span>
                <span style={{ fontSize: '0.9rem', fontWeight: isCurrent ? 600 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {h.text}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
