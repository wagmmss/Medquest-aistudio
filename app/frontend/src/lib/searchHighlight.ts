export interface HighlightSegment {
  text: string;
  highlight: boolean;
}

/**
 * Safely parses search snippets containing `<mark>...</mark>` or `<b>...</b>`
 * highlight tags returned by FTS into plain-text segments without using
 * `dangerouslySetInnerHTML`. Any unexpected HTML tags are stripped/ignored as text.
 */
export function parseSearchHighlight(snippet: string | null | undefined): HighlightSegment[] {
  if (!snippet) return [];

  const segments: HighlightSegment[] = [];
  const tagRegex = /<(b|mark)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(snippet)) !== null) {
    if (match.index > lastIndex) {
      const plain = snippet.slice(lastIndex, match.index);
      if (plain) segments.push({ text: plain, highlight: false });
    }
    const inner = match[2];
    if (inner) {
      segments.push({ text: inner, highlight: true });
    }
    lastIndex = tagRegex.lastIndex;
  }

  if (lastIndex < snippet.length) {
    const tail = snippet.slice(lastIndex);
    if (tail) segments.push({ text: tail, highlight: false });
  }

  return segments;
}
