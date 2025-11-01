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
 * Check if a chapter should be filtered out (front/back matter)
 */
function shouldFilterChapter(title: string, content: string, wordCount: number): boolean {
  const lowerTitle = title.toLowerCase();
  const lowerContent = content.toLowerCase();

  // Filter by title - common front/back matter keywords
  const filterTitles = [
    'table of contents',
    'contents',
    'toc',
    'copyright',
    'title page',
    'half title',
    'also by',
    'books by',
    'dedication',
    'acknowledgment',
    'acknowledgement',
    'about the author',
    'about the publisher',
    'about this book',
    'cover',
    'frontmatter',
    'front matter',
    'backmatter',
    'back matter',
    'praise for',
    'copyright page',
    'epigraph',
    'foreword',
    'preface',
    'introduction to',
    'reader\'s guide',
    'discussion questions',
    'credits',
    'permissions',
    'colophon',
    'index',
    'glossary',
    'notes',
    'endnotes',
    'bibliography',
    'about the edition',
    'newsletter',
    'subscribe',
  ];

  for (const filterTitle of filterTitles) {
    if (lowerTitle.includes(filterTitle)) {
      console.log(`📋 Filtering out front/back matter: "${title}"`);
      return true;
    }
  }

  // Filter by content patterns

  // Skip if too short (less than 200 words is likely not story content)
  if (wordCount < 200) {
    console.log(`📋 Filtering out short chapter: "${title}" (${wordCount} words)`);
    return true;
  }

  // Check for copyright indicators in content
  const copyrightIndicators = [
    'all rights reserved',
    'copyright ©',
    '© copyright',
    'published by',
    'isbn',
    'library of congress',
  ];

  for (const indicator of copyrightIndicators) {
    if (lowerContent.includes(indicator) && wordCount < 500) {
      console.log(`📋 Filtering out copyright/metadata chapter: "${title}"`);
      return true;
    }
  }

  // Check for TOC indicators - lots of "Chapter" references
  const chapterMentions = (content.match(/chapter \d+/gi) || []).length;
  if (chapterMentions > 5 && wordCount < 1000) {
    console.log(`📋 Filtering out likely TOC: "${title}" (${chapterMentions} chapter references)`);
    return true;
  }

  return false;
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
      const wordCount = countWords(plainText);

      // Filter out front/back matter
      if (shouldFilterChapter(title, plainText, wordCount)) {
        continue;
      }

      chapters.push({
        id: chapterId,
        title,
        number: chapters.length + 1, // Use actual chapter number after filtering
        content: plainText,
        htmlContent,
        wordCount,
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
