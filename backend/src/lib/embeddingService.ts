import { db } from '../db/index.js';
import { characters, characterEmbeddings, settings, settingEmbeddings, type Character, type Setting } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { EmbeddingFactory, EmbeddingProvider } from './embedding/index.js';

// ============================================
// Embedding Service
// ============================================

/**
 * Generate embedding text from character profile
 * Combines all relevant character information into a single text for embedding
 */
export function generateCharacterEmbeddingText(character: Character): string {
  const parts: string[] = [];

  // Add name and aliases
  parts.push(`Name: ${character.name}`);
  if (character.aliases && character.aliases.length > 0) {
    parts.push(`Also known as: ${character.aliases.join(', ')}`);
  }

  // Add role if available
  if (character.role) {
    parts.push(`Role: ${character.role}`);
  }

  // Add appearance details from JSONB
  const appearance = character.initialAppearance as any;
  if (appearance) {
    if (appearance.physicalDescription) {
      parts.push(appearance.physicalDescription);
    }
    if (appearance.visualSummary) {
      parts.push(appearance.visualSummary);
    }

    // Add key appearance attributes
    const attributes = [
      appearance.height,
      appearance.build,
      appearance.age,
      appearance.hairColor,
      appearance.hairStyle,
      appearance.eyeColor,
      appearance.skinTone,
      appearance.ethnicity,
      appearance.typicalClothing,
    ].filter(Boolean);

    if (attributes.length > 0) {
      parts.push(attributes.join(', '));
    }

    // Add distinctive features
    if (appearance.distinctiveFeatures && appearance.distinctiveFeatures.length > 0) {
      parts.push(`Distinctive: ${appearance.distinctiveFeatures.join(', ')}`);
    }
  }

  return parts.join('. ');
}

/**
 * Generate embedding text from setting profile
 * Combines all relevant setting information into a single text for embedding
 */
export function generateSettingEmbeddingText(setting: Setting): string {
  const parts: string[] = [];

  // Add name
  parts.push(`Location: ${setting.name}`);

  // Add description
  if (setting.description) {
    parts.push(setting.description);
  }

  // Add visual keywords
  if (setting.visualKeywords && setting.visualKeywords.length > 0) {
    parts.push(`Visual elements: ${setting.visualKeywords.join(', ')}`);
  }

  return parts.join('. ');
}

/**
 * Generate and store embedding for a character
 * @param characterId Character ID
 * @param userId User ID for API key retrieval
 * @param provider Embedding provider to use (defaults to openai)
 * @returns The generated embedding vector
 */
export async function generateCharacterEmbedding(
  characterId: string,
  userId: string,
  provider: EmbeddingProvider | string = EmbeddingProvider.OPENAI
): Promise<number[]> {
  // Get character from database
  const character = await db.query.characters.findFirst({
    where: eq(characters.id, characterId),
  });

  if (!character) {
    throw new Error(`Character not found: ${characterId}`);
  }

  // Create embedding service
  const embeddingService = await EmbeddingFactory.create(userId, provider);

  // Generate embedding text
  const text = generateCharacterEmbeddingText(character);

  console.log(`📊 Generating embedding for character: ${character.name}`);
  console.log(`   Text length: ${text.length} characters`);
  console.log(`   Provider: ${provider}, Model: ${embeddingService.getModel()}`);

  // Generate embedding
  const embedding = await embeddingService.embed(text);

  console.log(`✅ Generated ${embedding.length}-dimensional embedding`);

  // Store in database (upsert)
  const existing = await db.query.characterEmbeddings.findFirst({
    where: eq(characterEmbeddings.characterId, characterId),
  });

  if (existing) {
    // Update existing embedding
    await db.update(characterEmbeddings)
      .set({
        embedding: embedding as any,
        model: embeddingService.getModel(),
        updatedAt: new Date(),
      })
      .where(eq(characterEmbeddings.characterId, characterId));

    console.log(`♻️  Updated existing embedding for character: ${character.name}`);
  } else {
    // Insert new embedding
    await db.insert(characterEmbeddings).values({
      characterId: characterId,
      embedding: embedding as any,
      model: embeddingService.getModel(),
    });

    console.log(`✅ Stored new embedding for character: ${character.name}`);
  }

  return embedding;
}

/**
 * Generate and store embeddings for multiple characters in batch
 * @param characterIds Array of character IDs
 * @param userId User ID for API key retrieval
 * @param provider Embedding provider to use
 * @returns Number of embeddings generated
 */
export async function generateCharacterEmbeddingsBatch(
  characterIds: string[],
  userId: string,
  provider: EmbeddingProvider | string = EmbeddingProvider.OPENAI
): Promise<number> {
  if (characterIds.length === 0) {
    return 0;
  }

  console.log(`📊 Generating embeddings for ${characterIds.length} characters...`);

  // Get all characters from database
  const characterList = await db.query.characters.findMany({
    where: sql`${characters.id} = ANY(${characterIds})`,
  });

  if (characterList.length === 0) {
    throw new Error('No characters found');
  }

  // Create embedding service
  const embeddingService = await EmbeddingFactory.create(userId, provider);

  // Generate embedding texts
  const texts = characterList.map(generateCharacterEmbeddingText);

  console.log(`   Provider: ${provider}, Model: ${embeddingService.getModel()}`);

  // Generate embeddings in batch
  const embeddings = await embeddingService.embedBatch(texts);

  console.log(`✅ Generated ${embeddings.length} embeddings (${embeddings[0].length} dimensions each)`);

  // Store embeddings in database
  let stored = 0;
  for (let i = 0; i < characterList.length; i++) {
    const character = characterList[i];
    const embedding = embeddings[i];

    // Check if embedding already exists
    const existing = await db.query.characterEmbeddings.findFirst({
      where: eq(characterEmbeddings.characterId, character.id),
    });

    if (existing) {
      // Update
      await db.update(characterEmbeddings)
        .set({
          embedding: embedding as any,
          model: embeddingService.getModel(),
          updatedAt: new Date(),
        })
        .where(eq(characterEmbeddings.characterId, character.id));
    } else {
      // Insert
      await db.insert(characterEmbeddings).values({
        characterId: character.id,
        embedding: embedding as any,
        model: embeddingService.getModel(),
      });
    }

    stored++;
  }

  console.log(`✅ Stored ${stored} character embeddings`);

  return stored;
}

/**
 * Generate and store embedding for a setting
 * @param settingId Setting ID
 * @param userId User ID for API key retrieval
 * @param provider Embedding provider to use
 * @returns The generated embedding vector
 */
export async function generateSettingEmbedding(
  settingId: string,
  userId: string,
  provider: EmbeddingProvider | string = EmbeddingProvider.OPENAI
): Promise<number[]> {
  // Get setting from database
  const setting = await db.query.settings.findFirst({
    where: eq(settings.id, settingId),
  });

  if (!setting) {
    throw new Error(`Setting not found: ${settingId}`);
  }

  // Create embedding service
  const embeddingService = await EmbeddingFactory.create(userId, provider);

  // Generate embedding text
  const text = generateSettingEmbeddingText(setting);

  console.log(`📊 Generating embedding for setting: ${setting.name}`);
  console.log(`   Text length: ${text.length} characters`);
  console.log(`   Provider: ${provider}, Model: ${embeddingService.getModel()}`);

  // Generate embedding
  const embedding = await embeddingService.embed(text);

  console.log(`✅ Generated ${embedding.length}-dimensional embedding`);

  // Store in database (upsert)
  const existing = await db.query.settingEmbeddings.findFirst({
    where: eq(settingEmbeddings.settingId, settingId),
  });

  if (existing) {
    // Update existing embedding
    await db.update(settingEmbeddings)
      .set({
        embedding: embedding as any,
        model: embeddingService.getModel(),
        updatedAt: new Date(),
      })
      .where(eq(settingEmbeddings.settingId, settingId));

    console.log(`♻️  Updated existing embedding for setting: ${setting.name}`);
  } else {
    // Insert new embedding
    await db.insert(settingEmbeddings).values({
      settingId: settingId,
      embedding: embedding as any,
      model: embeddingService.getModel(),
    });

    console.log(`✅ Stored new embedding for setting: ${setting.name}`);
  }

  return embedding;
}

/**
 * Generate and store embeddings for multiple settings in batch
 * @param settingIds Array of setting IDs
 * @param userId User ID for API key retrieval
 * @param provider Embedding provider to use
 * @returns Number of embeddings generated
 */
export async function generateSettingEmbeddingsBatch(
  settingIds: string[],
  userId: string,
  provider: EmbeddingProvider | string = EmbeddingProvider.OPENAI
): Promise<number> {
  if (settingIds.length === 0) {
    return 0;
  }

  console.log(`📊 Generating embeddings for ${settingIds.length} settings...`);

  // Get all settings from database
  const settingList = await db.query.settings.findMany({
    where: sql`${settings.id} = ANY(${settingIds})`,
  });

  if (settingList.length === 0) {
    throw new Error('No settings found');
  }

  // Create embedding service
  const embeddingService = await EmbeddingFactory.create(userId, provider);

  // Generate embedding texts
  const texts = settingList.map(generateSettingEmbeddingText);

  console.log(`   Provider: ${provider}, Model: ${embeddingService.getModel()}`);

  // Generate embeddings in batch
  const embeddings = await embeddingService.embedBatch(texts);

  console.log(`✅ Generated ${embeddings.length} embeddings (${embeddings[0].length} dimensions each)`);

  // Store embeddings in database
  let stored = 0;
  for (let i = 0; i < settingList.length; i++) {
    const setting = settingList[i];
    const embedding = embeddings[i];

    // Check if embedding already exists
    const existing = await db.query.settingEmbeddings.findFirst({
      where: eq(settingEmbeddings.settingId, setting.id),
    });

    if (existing) {
      // Update
      await db.update(settingEmbeddings)
        .set({
          embedding: embedding as any,
          model: embeddingService.getModel(),
          updatedAt: new Date(),
        })
        .where(eq(settingEmbeddings.settingId, setting.id));
    } else {
      // Insert
      await db.insert(settingEmbeddings).values({
        settingId: setting.id,
        embedding: embedding as any,
        model: embeddingService.getModel(),
      });
    }

    stored++;
  }

  console.log(`✅ Stored ${stored} setting embeddings`);

  return stored;
}

/**
 * Find similar characters using vector similarity search
 * @param characterId Character ID to find similar characters for
 * @param limit Maximum number of similar characters to return
 * @param threshold Minimum similarity score (0-1)
 * @returns Array of similar characters with similarity scores
 */
export async function findSimilarCharacters(
  characterId: string,
  limit: number = 10,
  threshold: number = 0.7
): Promise<Array<{ character: Character; similarity: number }>> {
  // Get the embedding for the query character
  const queryEmbedding = await db.query.characterEmbeddings.findFirst({
    where: eq(characterEmbeddings.characterId, characterId),
  });

  if (!queryEmbedding) {
    throw new Error(`No embedding found for character: ${characterId}`);
  }

  // Use pgvector's cosine similarity operator (<=>)
  // The operator returns distance, so we convert to similarity: 1 - distance
  const results = await db.execute(sql`
    SELECT
      c.*,
      1 - (ce.embedding <=> ${queryEmbedding.embedding}::vector) AS similarity
    FROM ${characters} c
    JOIN ${characterEmbeddings} ce ON ce.character_id = c.id
    WHERE c.id != ${characterId}
      AND 1 - (ce.embedding <=> ${queryEmbedding.embedding}::vector) >= ${threshold}
    ORDER BY ce.embedding <=> ${queryEmbedding.embedding}::vector
    LIMIT ${limit}
  `);

  return results.rows.map((row: any) => ({
    character: row as Character,
    similarity: parseFloat(row.similarity),
  }));
}

/**
 * Find similar settings using vector similarity search
 * @param settingId Setting ID to find similar settings for
 * @param limit Maximum number of similar settings to return
 * @param threshold Minimum similarity score (0-1)
 * @returns Array of similar settings with similarity scores
 */
export async function findSimilarSettings(
  settingId: string,
  limit: number = 10,
  threshold: number = 0.7
): Promise<Array<{ setting: Setting; similarity: number }>> {
  // Get the embedding for the query setting
  const queryEmbedding = await db.query.settingEmbeddings.findFirst({
    where: eq(settingEmbeddings.settingId, settingId),
  });

  if (!queryEmbedding) {
    throw new Error(`No embedding found for setting: ${settingId}`);
  }

  // Use pgvector's cosine similarity operator
  const results = await db.execute(sql`
    SELECT
      s.*,
      1 - (se.embedding <=> ${queryEmbedding.embedding}::vector) AS similarity
    FROM ${settings} s
    JOIN ${settingEmbeddings} se ON se.setting_id = s.id
    WHERE s.id != ${settingId}
      AND 1 - (se.embedding <=> ${queryEmbedding.embedding}::vector) >= ${threshold}
    ORDER BY se.embedding <=> ${queryEmbedding.embedding}::vector
    LIMIT ${limit}
  `);

  return results.rows.map((row: any) => ({
    setting: row as Setting,
    similarity: parseFloat(row.similarity),
  }));
}
