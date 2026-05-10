import Str from 'normalize-vietnamese';
import { TranscriptResponse } from 'youtube-transcript';

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    );
}

function stripCaptionMarkup(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, ' ')
    .replace(/<\/?c(?:\.[^>]*)?>/gi, ' ')
    .replace(/<\/?v(?:\s+[^>]*)?>/gi, ' ')
    .replace(/<\/?lang(?:\s+[^>]*)?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeVietnameseTranscript(value: string) {
  return Str.normalizeVietnameseAccent(value.normalize('NFC'))
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+([)\]}])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function getOverlapSuffix(previousWords: string[], currentWords: string[]) {
  const maxOverlap = Math.min(previousWords.length, currentWords.length);

  for (let size = maxOverlap; size > 0; size -= 1) {
    const previousTail = previousWords.slice(-size).join(' ');
    const currentHead = currentWords.slice(0, size).join(' ');

    if (previousTail === currentHead) {
      return currentWords.slice(size).join(' ');
    }
  }

  return currentWords.join(' ');
}

function getNewCaptionSegment(previous: string, current: string) {
  if (!current) {
    return '';
  }

  if (!previous) {
    return current;
  }

  if (current === previous) {
    return '';
  }

  if (current.startsWith(previous)) {
    return current.slice(previous.length).trim();
  }

  const previousWords = previous.split(/\s+/).filter(Boolean);
  const currentWords = current.split(/\s+/).filter(Boolean);

  return getOverlapSuffix(previousWords, currentWords);
}

function ensureTerminalPunctuation(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (/[.!?…]$/.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed}.`;
}

export function cleanTranscriptText(transcripts: TranscriptResponse[]) {
  return transcripts.map((transcript) => transcript.text).join(' ');
}

// export function parseYoutubeVtt(vtt: string) {
//   const blocks = vtt
//     .split(/\r?\n\r?\n+/)
//     .map((block) => block.trim())
//     .filter(Boolean);

//   const segments: string[] = [];
//   let previousCaption = '';

//   for (const block of blocks) {
//     const lines = block
//       .split(/\r?\n/)
//       .map((line) => line.trim())
//       .filter(Boolean);

//     if (
//       lines.length === 0 ||
//       lines[0].startsWith('WEBVTT') ||
//       lines[0].startsWith('NOTE') ||
//       lines[0].startsWith('STYLE')
//     ) {
//       continue;
//     }

//     const contentLines = lines.filter(
//       (line) =>
//         !/^\d+$/.test(line) &&
//         !line.includes('-->') &&
//         !line.startsWith('Kind:') &&
//         !line.startsWith('Language:'),
//     );

//     const caption = cleanTranscriptText(contentLines.join(' '));
//     if (!caption) {
//       continue;
//     }

//     const newSegment = getNewCaptionSegment(previousCaption, caption);
//     if (newSegment) {
//       segments.push(ensureTerminalPunctuation(newSegment));
//     }

//     previousCaption = caption;
//   }

//   return cleanTranscriptText(segments.join(' '));
// }
