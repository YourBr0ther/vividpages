# Testing the Embedding Generation System

This guide walks you through testing the vector embedding system for character similarity search.

## Prerequisites

1. **Running Services:**
   ```bash
   docker-compose up -d postgres redis api character-worker
   ```

2. **Dependencies Installed:**
   ```bash
   cd backend
   npm install  # or pnpm install
   ```

3. **Database with pgvector enabled:**
   ```sql
   docker exec vividpages-postgres psql -U vividpages -d vividpages -c "CREATE EXTENSION IF NOT EXISTS vector;"
   ```

4. **VividPage with analyzed scenes:**
   - Upload an EPUB file
   - Wait for scene analysis to complete (status: 'analyzed')
   - You should have characters discovered

---

## Test 1: Automatic Embedding Generation

Embeddings are automatically generated during character discovery.

### Step 1.1: Trigger Character Discovery

```bash
# Replace VIVID_PAGE_ID and TOKEN with your values
VIVID_PAGE_ID="your-vivid-page-id"
TOKEN="your-auth-token"

curl -X POST "http://localhost:4000/api/vividpages/$VIVID_PAGE_ID/discover-characters" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Character discovery job queued",
  "jobId": "characters-xxx"
}
```

### Step 1.2: Monitor Character Worker Logs

```bash
docker logs vividpages-character-worker --follow
```

**Look for these log messages:**
```
🔍 Discovering characters for VividPage: xxx
✅ Identified N unique characters
📊 Generating embeddings for N characters...
   Provider: openai, Model: text-embedding-3-small
✅ Generated N embeddings (1536 dimensions each)
✅ Stored N character embeddings
```

### Step 1.3: Verify Embeddings in Database

```sql
docker exec vividpages-postgres psql -U vividpages -d vividpages -c "
SELECT
  c.name,
  ce.model,
  array_length(ce.embedding::float[], 1) as dimensions,
  ce.created_at
FROM characters c
JOIN character_embeddings ce ON ce.character_id = c.id
WHERE c.vivid_page_id = 'your-vivid-page-id'
ORDER BY c.created_at DESC;
"
```

**Expected Output:**
```
     name      |          model           | dimensions |       created_at
---------------+--------------------------+------------+---------------------
 Character A   | text-embedding-3-small   |       1536 | 2025-11-11 12:00:00
 Character B   | text-embedding-3-small   |       1536 | 2025-11-11 12:00:01
```

---

## Test 2: Manual Embedding Regeneration

Test regenerating embeddings with different providers.

### Step 2.1: Get a Character ID

```bash
curl "http://localhost:4000/api/vividpages/$VIVID_PAGE_ID/characters" \
  -H "Authorization: Bearer $TOKEN" | jq '.characters[0].id'
```

Save the character ID for next steps.

### Step 2.2: Regenerate with OpenAI

```bash
CHARACTER_ID="your-character-id"

curl -X POST "http://localhost:4000/api/vividpages/$VIVID_PAGE_ID/characters/$CHARACTER_ID/regenerate-embedding" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider": "openai"}'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Embedding regenerated successfully",
  "dimensions": 1536,
  "provider": "openai"
}
```

### Step 2.3: Regenerate with Ollama (if available)

First, ensure Ollama has an embedding model:
```bash
docker exec vividpages-ollama ollama pull nomic-embed-text
```

Then regenerate:
```bash
curl -X POST "http://localhost:4000/api/vividpages/$VIVID_PAGE_ID/characters/$CHARACTER_ID/regenerate-embedding" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider": "ollama"}'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Embedding regenerated successfully",
  "dimensions": 768,
  "provider": "ollama"
}
```

**Note:** Ollama embeddings have different dimensions (768 vs 1536 for OpenAI).

---

## Test 3: Vector Similarity Search

Find characters similar to a given character.

### Step 3.1: Find Similar Characters

```bash
curl "http://localhost:4000/api/vividpages/$VIVID_PAGE_ID/characters/$CHARACTER_ID/similar?limit=5&threshold=0.7" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response:**
```json
{
  "success": true,
  "character": {
    "id": "xxx",
    "name": "Main Character"
  },
  "similar": [
    {
      "id": "yyy",
      "name": "Similar Character 1",
      "aliases": ["Alt Name"],
      "role": "supporting",
      "similarity": 0.89
    },
    {
      "id": "zzz",
      "name": "Similar Character 2",
      "aliases": [],
      "role": "minor",
      "similarity": 0.76
    }
  ],
  "totalResults": 2
}
```

### Step 3.2: Adjust Similarity Threshold

Lower threshold to find more matches:
```bash
curl "http://localhost:4000/api/vividpages/$VIVID_PAGE_ID/characters/$CHARACTER_ID/similar?limit=10&threshold=0.5" \
  -H "Authorization: Bearer $TOKEN"
```

Higher threshold for stricter matches:
```bash
curl "http://localhost:4000/api/vividpages/$VIVID_PAGE_ID/characters/$CHARACTER_ID/similar?limit=5&threshold=0.9" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Test 4: Direct Database Queries

### Test 4.1: View Raw Embeddings

```sql
docker exec vividpages-postgres psql -U vividpages -d vividpages -c "
SELECT
  c.name,
  (ce.embedding::float[])[1:10] as first_10_dimensions
FROM characters c
JOIN character_embeddings ce ON ce.character_id = c.id
LIMIT 3;
"
```

### Test 4.2: Manual Similarity Search

```sql
docker exec vividpages-postgres psql -U vividpages -d vividpages << 'EOF'
-- Find similar characters using pgvector
WITH query_char AS (
  SELECT embedding
  FROM character_embeddings
  WHERE character_id = 'your-character-id'
)
SELECT
  c.name,
  c.role,
  1 - (ce.embedding <=> qc.embedding) AS similarity
FROM characters c
JOIN character_embeddings ce ON ce.character_id = c.id
CROSS JOIN query_char qc
WHERE c.id != 'your-character-id'
  AND 1 - (ce.embedding <=> qc.embedding) >= 0.7
ORDER BY ce.embedding <=> qc.embedding
LIMIT 5;
EOF
```

### Test 4.3: Check HNSW Index

```sql
docker exec vividpages-postgres psql -U vividpages -d vividpages -c "
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'character_embeddings';
"
```

**Expected Output:**
```
              indexname               |                                   indexdef
--------------------------------------+-------------------------------------------------------------------------------
 idx_character_embeddings_vector     | CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)
```

---

## Test 5: Performance Testing

### Test 5.1: Batch Embedding Generation Speed

Time how long it takes to generate embeddings for multiple characters:

```bash
time curl -X POST "http://localhost:4000/api/vividpages/$VIVID_PAGE_ID/discover-characters" \
  -H "Authorization: Bearer $TOKEN"
```

Check logs for timing:
```
📊 Generating embeddings for 20 characters...
✅ Generated 20 embeddings (1536 dimensions each)
⏱️ Time: ~5 seconds for OpenAI, ~30 seconds for Ollama
```

### Test 5.2: Similarity Search Speed

```bash
time curl "http://localhost:4000/api/vividpages/$VIVID_PAGE_ID/characters/$CHARACTER_ID/similar?limit=100" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:** < 100ms for HNSW index search

---

## Troubleshooting

### Problem: "No OpenAI API key found"

**Solution:** Add your OpenAI API key via the settings page or API:
```bash
curl -X POST "http://localhost:4000/api/api-keys" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "chatgpt",
    "apiKey": "sk-your-openai-key",
    "nickname": "My OpenAI Key"
  }'
```

### Problem: "No embedding found for character"

**Solution:** Regenerate the embedding:
```bash
curl -X POST "http://localhost:4000/api/vividpages/$VIVID_PAGE_ID/characters/$CHARACTER_ID/regenerate-embedding" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider": "openai"}'
```

### Problem: Ollama embedding fails

**Solution:** Pull the embedding model first:
```bash
docker exec vividpages-ollama ollama pull nomic-embed-text
```

### Problem: Similarity search returns no results

**Possible causes:**
1. **Threshold too high:** Try lowering to 0.5 or 0.6
2. **Different embedding models:** Characters embedded with different models can't be compared
3. **No similar characters:** Try with limit=20 and threshold=0.3

---

## Expected Behavior

### Automatic Workflow
1. ✅ User uploads EPUB
2. ✅ Scenes analyzed by LLM
3. ✅ Characters discovered and deduplicated
4. ✅ **Embeddings automatically generated** (Step 7 in character worker)
5. ✅ User can query similar characters

### Embedding Dimensions
- **OpenAI (text-embedding-3-small):** 1536 dimensions
- **OpenAI (text-embedding-3-large):** 3072 dimensions
- **Ollama (nomic-embed-text):** 768 dimensions
- **Ollama (mxbai-embed-large):** 1024 dimensions

### Similarity Scores
- **1.0** = Identical embeddings (same character)
- **0.9-0.99** = Very similar (likely duplicates or twins)
- **0.7-0.89** = Similar appearance/description
- **0.5-0.69** = Some similarities
- **< 0.5** = Different characters

---

## Useful Database Queries

### Count embeddings by model
```sql
SELECT model, COUNT(*)
FROM character_embeddings
GROUP BY model;
```

### Find characters without embeddings
```sql
SELECT c.id, c.name, c.vivid_page_id
FROM characters c
LEFT JOIN character_embeddings ce ON ce.character_id = c.id
WHERE ce.id IS NULL;
```

### Average similarity between all characters
```sql
WITH pairs AS (
  SELECT
    c1.name as char1,
    c2.name as char2,
    1 - (ce1.embedding <=> ce2.embedding) as similarity
  FROM characters c1
  JOIN character_embeddings ce1 ON ce1.character_id = c1.id
  CROSS JOIN characters c2
  JOIN character_embeddings ce2 ON ce2.character_id = c2.id
  WHERE c1.id < c2.id AND c1.vivid_page_id = c2.vivid_page_id
)
SELECT
  AVG(similarity) as avg_similarity,
  MIN(similarity) as min_similarity,
  MAX(similarity) as max_similarity
FROM pairs;
```

---

## Next Steps After Testing

Once embeddings are working:
1. Use similarity search to improve character deduplication
2. Detect potential duplicate characters that LLM missed
3. Build character relationship visualizations
4. Enhance image generation with consistent character references
5. Implement setting/location embeddings (Task 6)
