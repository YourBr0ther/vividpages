import ePub from 'epub';
import { load } from 'cheerio';

// ============================================
// Types
// ============================================

export interface EpubMetadata {
  title: string;
  author: string | null;
  language: string;
  isbn: string | null;
  publisher: string | null;
  pubdate: string | null;
  description: string | null;
  cover: Buffer | null;
}

export interface Chapter {
  id: string;
  title: string;
  number: number;
  content: string; // Plain text
  htmlContent: string; // Original HTML
  wordCount: number;
}

// ============================================
// EPUB Parser
// ============================================

/**
 * Parse EPUB file and extract all content
 */
export async function parseEpub(filePath: string): Promise<{
  metadata: EpubMetadata;
  chapters: Chapter[];
}> {
  const { metadata, epub } = await extractMetadata(filePath);
  const chapters = await extractChapters(epub);

  return {
    metadata,
    chapters,
  };
}

/**
 * Extract metadata from EPUB
 */
function extractMetadata(filePath: string): Promise<{ metadata: EpubMetadata; epub: any }> {
  return new Promise((resolve, reject) => {
    const epub = new ePub(filePath);

    epub.on('end', async () => {
      try {
        let coverBuffer: Buffer | null = null;

        // Try to extract cover image
        if (epub.metadata.cover) {
          try {
            const [coverData, mimeType] = await new Promise<[Buffer, string]>((res, rej) => {
              epub.getImage(epub.metadata.cover, (err: Error, data: Buffer, mimeType: string) => {
                if (err) {
                  rej(err);
                } else {
                  res([data, mimeType]);
                }
              });
            });
            coverBuffer = coverData;
          } catch (err) {
            console.warn('Could not extract cover image:', err);
          }
        }

        const metadata: EpubMetadata = {
          title: epub.metadata.title || 'Untitled',
          author: epub.metadata.creator || null,
          language: epub.metadata.language || 'en',
          isbn: epub.metadata.ISBN || null,
          publisher: epub.metadata.publisher || null,
          pubdate: epub.metadata.pubdate || null,
          description: epub.metadata.description || null,
          cover: coverBuffer,
        };

        resolve({ metadata, epub });
      } catch (error) {
        reject(error);
      }
    });

    epub.on('error', (err: Error) => {
      reject(err);
    });

    epub.parse();
  });
}

/**
 * Extract all chapters from EPUB
 */
async function extractChapters(epub: any): Promise<Chapter[]> {
  const chapters: Chapter[] = [];
  const flow = epub.flow; // Array of chapter IDs in reading order

  for (let i = 0; i < flow.length; i++) {
    const chapterInfo = flow[i];

    try {
      const [htmlContent, chapterId] = await new Promise<[string, string]>((resolve, reject) => {
        epub.getChapter(chapterInfo.id, (err: Error, text: string) => {
          if (err) {
            reject(err);
          } else {
            resolve([text, chapterInfo.id]);
          }
        });
      });

      // Extract title from chapter
      const title = chapterInfo.title || `Chapter ${i + 1}`;

      // Convert HTML to plain text
      const plainText = htmlToPlainText(htmlContent);

      // Skip if chapter is too short (likely navigation/copyright pages)
      if (plainText.trim().length < 100) {
        console.log(`Skipping short chapter: ${title} (${plainText.length} chars)`);
        continue;
      }

      chapters.push({
        id: chapterId,
        title,
        number: chapters.length + 1, // Use actual chapter number after filtering
        content: plainText,
        htmlContent,
        wordCount: countWords(plainText),
      });

    } catch (error) {
      console.error(`Error extracting chapter ${chapterInfo.id}:`, error);
      // Continue with next chapter
    }
  }

  return chapters;
}

/**
 * Convert HTML to plain text
 * Preserves paragraph breaks and removes HTML tags
 */
export function htmlToPlainText(html: string): string {
  const $ = load(html);

  // Remove script and style elements
  $('script, style').remove();

  // Get text content
  let text = $('body').text();

  // If no body, get all text
  if (!text || text.trim().length === 0) {
    text = $.text();
  }

  // Clean up whitespace
  text = text
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Multiple newlines to double newline
    .replace(/[ \t]+/g, ' ') // Multiple spaces to single space
    .replace(/^\s+/gm, '') // Remove leading whitespace from lines
    .trim();

  return text;
}

/**
 * Count words in text
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Get total word count for all chapters
 */
export function getTotalWordCount(chapters: Chapter[]): number {
  return chapters.reduce((total, chapter) => total + chapter.wordCount, 0);
}
