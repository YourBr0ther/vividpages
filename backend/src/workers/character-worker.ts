import { Worker, Job } from 'bullmq';
import { connection } from '../queue/connection.js';
import { db } from '../db/index.js';
import { vividPages } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { LLMFactory, LLMProvider, type BaseLLMService } from '../lib/llm/index.js';
import {
  extractCharactersFromScenes,
  deduplicateCharacters,
  buildDetailedCharacterProfile,
  determineCharacterRole,
  createCharacter,
} from '../lib/characterService.js';
import { generateCharacterEmbeddingsBatch } from '../lib/embeddingService.js';
import { EmbeddingProvider } from '../lib/embedding/index.js';
import { emitProgress, emitStatusUpdate, emitErrorUpdate, emitCompletion } from '../lib/progressEmitter.js';

// ============================================
// Job Data Interface
// ============================================

interface CharacterDiscoveryJobData {
  vividPageId: string;
  userId: string;
  provider?: LLMProvider | string;
  model?: string;
  timestamp: number;
}

// ============================================
// Character Discovery Worker
// ============================================

export const characterWorker = new Worker<CharacterDiscoveryJobData>(
  'character-discovery',
  async (job: Job<CharacterDiscoveryJobData>) => {
    const { vividPageId, userId, provider, model } = job.data;

    const selectedProvider = provider || LLMProvider.OLLAMA;
    console.log(`\n🔍 Discovering characters for VividPage: ${vividPageId}`);
    console.log(`📡 Using provider: ${selectedProvider}${model ? ` (model: ${model})` : ''}`);

    let llmService: BaseLLMService;

    try {
      // ============================================
      // Step 1: Create LLM service and check health
      // ============================================
      job.updateProgress(5);
      await updateVividPageProgress(vividPageId, 5, 'Connecting to LLM...');

      llmService = await LLMFactory.create(userId, selectedProvider, { model });

      const isHealthy = await llmService.checkHealth();
      if (!isHealthy) {
        throw new Error(`${selectedProvider} service is not available`);
      }

      console.log(`✅ ${selectedProvider} is healthy (model: ${llmService.getModel()})`);

      // ============================================
      // Step 2: Get VividPage info
      // ============================================
      job.updateProgress(10);
      await updateVividPageProgress(vividPageId, 10, 'Loading scenes...');

      const vividPage = await db.query.vividPages.findFirst({
        where: eq(vividPages.id, vividPageId),
      });

      if (!vividPage) {
        throw new Error(`VividPage not found: ${vividPageId}`);
      }

      const totalScenes = vividPage.totalScenes || 0;

      // ============================================
      // Step 3: Extract character mentions from scenes
      // ============================================
      job.updateProgress(20);
      await updateVividPageProgress(vividPageId, 20, 'Extracting characters from scenes...');

      const characterMentions = await extractCharactersFromScenes(vividPageId);

      if (characterMentions.length === 0) {
        console.log(`⚠️  No character mentions found in scenes`);
        return {
          success: true,
          vividPageId,
          charactersDiscovered: 0,
          message: 'No characters found in analyzed scenes',
        };
      }

      console.log(`📊 Extracted ${characterMentions.length} character mentions`);

      // ============================================
      // Step 4: Deduplicate characters
      // ============================================
      job.updateProgress(40);
      await updateVividPageProgress(vividPageId, 40, 'Identifying unique characters...');

      const characterGroups = await deduplicateCharacters(characterMentions, llmService);

      console.log(`✅ Identified ${characterGroups.length} unique characters`);

      // ============================================
      // Step 5: Update status
      // ============================================
      await db.update(vividPages)
        .set({
          status: 'building_character_profiles',
          updatedAt: new Date(),
        })
        .where(eq(vividPages.id, vividPageId));

      emitStatusUpdate(vividPageId, 'building_character_profiles', {
        totalCharacters: characterGroups.length,
      });

      // ============================================
      // Step 6: Build detailed profiles and save
      // ============================================
      let createdCount = 0;
      const characterIds: string[] = [];
      const errors: Array<{ characterName: string; error: string }> = [];

      for (let i = 0; i < characterGroups.length; i++) {
        const group = characterGroups[i];

        // Calculate progress (40% to 80%)
        const progress = 40 + Math.floor((i / characterGroups.length) * 40);
        job.updateProgress(progress);
        await updateVividPageProgress(
          vividPageId,
          progress,
          `Building profile ${i + 1}/${characterGroups.length}: ${group.primaryName}...`
        );

        console.log(`🎨 Building profile ${i + 1}/${characterGroups.length}: ${group.primaryName}`);

        try {
          // Build detailed appearance profile
          const appearance = await buildDetailedCharacterProfile(group, llmService);

          // Determine character role
          const role = determineCharacterRole(group.totalAppearances, totalScenes);

          // Get first appearance scene ID
          const firstAppearanceScene = group.mentions[0].sceneId;

          // Create character in database
          const character = await createCharacter({
            vividPageId,
            name: group.primaryName,
            aliases: group.aliases,
            initialAppearance: appearance,
            role,
            firstAppearanceScene,
          });

          characterIds.push(character.id);
          createdCount++;
          console.log(`✅ Created character: ${group.primaryName}`);

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ Failed to create character ${group.primaryName}:`, errorMessage);

          errors.push({
            characterName: group.primaryName,
            error: errorMessage,
          });
        }

        // Add small delay between LLM calls
        if (i < characterGroups.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // ============================================
      // Step 7: Generate embeddings for characters
      // ============================================
      if (characterIds.length > 0) {
        job.updateProgress(85);
        await updateVividPageProgress(vividPageId, 85, 'Generating embeddings...');

        console.log(`\n📊 Generating embeddings for ${characterIds.length} characters...`);

        try {
          // Use OpenAI embeddings by default, fall back to Ollama if not available
          let embeddingProvider = EmbeddingProvider.OPENAI;

          // Try to use the same provider as LLM for consistency
          if (selectedProvider === LLMProvider.OLLAMA) {
            embeddingProvider = EmbeddingProvider.OLLAMA;
          }

          const embeddingsGenerated = await generateCharacterEmbeddingsBatch(
            characterIds,
            userId,
            embeddingProvider
          );

          console.log(`✅ Generated ${embeddingsGenerated} character embeddings`);

        } catch (error) {
          // Don't fail the whole job if embeddings fail - they can be generated later
          console.error(`⚠️  Failed to generate embeddings:`, error);
          console.log(`   Characters can still be used, embeddings can be generated later`);
        }
      }

      // ============================================
      // Step 8: Update VividPage with final status
      // ============================================
      job.updateProgress(95);
      await updateVividPageProgress(vividPageId, 95, 'Finalizing...');

      const hasErrors = errors.length > 0;
      const finalStatus = hasErrors ? 'analyzed' : 'characters_discovered';

      await db.update(vividPages)
        .set({
          status: finalStatus,
          totalCharacters: createdCount,
          progressPercent: 100,
          currentStep: hasErrors
            ? `Character discovery complete with ${errors.length} error(s)`
            : 'Character discovery complete',
          updatedAt: new Date(),
        })
        .where(eq(vividPages.id, vividPageId));

      console.log(`✅ Character discovery complete: ${createdCount}/${characterGroups.length} characters created`);

      if (hasErrors) {
        console.log(`⚠️  ${errors.length} character(s) failed to create`);
      }

      // Emit completion event
      emitCompletion(vividPageId, {
        charactersDiscovered: createdCount,
        totalCharacters: characterGroups.length,
        errors: errors.length,
      });

      emitStatusUpdate(vividPageId, finalStatus, {
        charactersDiscovered: createdCount,
        totalCharacters: characterGroups.length,
      });

      job.updateProgress(100);

      console.log(`\n✅ Successfully completed character discovery for VividPage: ${vividPageId}\n`);

      return {
        success: true,
        vividPageId,
        charactersDiscovered: createdCount,
        totalCharacters: characterGroups.length,
        errors: errors.length,
      };

    } catch (error) {
      console.error(`\n❌ Error discovering characters for VividPage ${vividPageId}:`, error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Update VividPage with error status
      await db.update(vividPages)
        .set({
          status: 'analyzed', // Keep at analyzed so user can retry
          errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(vividPages.id, vividPageId));

      // Emit error event
      emitErrorUpdate(vividPageId, errorMessage);
      emitStatusUpdate(vividPageId, 'analyzed', { errorMessage });

      throw error;
    }
  },
  {
    connection,
    concurrency: parseInt(process.env.CHARACTER_WORKERS || '1'), // Process 1 discovery at a time
  }
);

// ============================================
// Helper Functions
// ============================================

async function updateVividPageProgress(
  vividPageId: string,
  progressPercent: number,
  currentStep: string
): Promise<void> {
  // Update database
  await db.update(vividPages)
    .set({
      progressPercent,
      currentStep,
      updatedAt: new Date(),
    })
    .where(eq(vividPages.id, vividPageId));

  // Emit real-time progress via Redis pub/sub -> Socket.IO
  emitProgress(vividPageId, progressPercent, currentStep);
}

// ============================================
// Worker Event Listeners
// ============================================

characterWorker.on('completed', (job) => {
  console.log(`✅ Character Worker completed job: ${job.id}`);
});

characterWorker.on('failed', (job, err) => {
  console.error(`❌ Character Worker failed job ${job?.id}:`, err.message);
});

characterWorker.on('error', (err) => {
  console.error('❌ Character Worker error:', err);
});

// ============================================
// Graceful Shutdown
// ============================================

async function shutdown() {
  console.log('\n🛑 Shutting down Character worker...');
  await characterWorker.close();
  await connection.quit();
  console.log('✅ Character worker shut down');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('🚀 Character Worker started and ready to process jobs');
