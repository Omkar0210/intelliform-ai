import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FormField {
  id: string;
  type: 'text' | 'email' | 'number' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'date' | 'file';
  label: string;
  placeholder?: string;
  required: boolean;
  options?: string[];
}

interface FormSchema {
  title: string;
  description: string;
  fields: FormField[];
}

interface SimilarForm {
  id: string;
  title: string;
  summary: string;
  similarity: number;
}

// Get API key with fallback support
function getLLMApiKey(): string | undefined {
  return Deno.env.get('LLM_API_KEY') || Deno.env.get('GEMINI_API_KEY');
}

function getEmbeddingApiKey(): string | undefined {
  return Deno.env.get('EMBEDDING_API_KEY') || Deno.env.get('LLM_API_KEY') || Deno.env.get('GEMINI_API_KEY');
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars) + '...';
}

function summarizeForm(form: any): string {
  const fields = form.schema?.fields?.map((f: any) => f.label).slice(0, 10) || [];
  const summary = {
    purpose: truncateText(form.title || '', 100),
    description: truncateText(form.description || '', 200),
    fields: fields.slice(0, 8)
  };
  return truncateText(JSON.stringify(summary), 800);
}

function extractJSON(text: string): string {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) return jsonMatch[1].trim();
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];
  return text.trim();
}

function parseJSONSafe(text: string): FormSchema | null {
  const jsonString = extractJSON(text);
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    try {
      const cleaned = jsonString
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/[\x00-\x1F\x7F]/g, '');
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

async function queryPinecone(embedding: number[], userId: string, topK: number = 5): Promise<SimilarForm[]> {
  const pineconeApiKey = Deno.env.get('PINECONE_API_KEY');
  const pineconeEnv = Deno.env.get('PINECONE_ENV') || Deno.env.get('PINECONE_ENVIRONMENT');
  
  if (!pineconeApiKey || !pineconeEnv) return [];

  try {
    const indexName = 'form-embeddings';
    const pineconeHost = `${indexName}-${pineconeEnv}.svc.pinecone.io`;
    
    const response = await fetch(`https://${pineconeHost}/query`, {
      method: 'POST',
      headers: { 'Api-Key': pineconeApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector: embedding,
        topK,
        includeMetadata: true,
        filter: { user_id: userId }
      })
    });

    if (!response.ok) return [];
    const data = await response.json();
    return (data.matches || []).map((match: any) => ({
      id: match.id,
      title: match.metadata?.title || '',
      summary: match.metadata?.summary || '',
      similarity: match.score || 0
    }));
  } catch {
    return [];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, userId } = await req.json();
    
    if (!prompt) {
      return new Response(
        JSON.stringify({ error: 'Prompt is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LLM_API_KEY = getLLMApiKey();
    if (!LLM_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'AI service not configured. Set LLM_API_KEY or GEMINI_API_KEY.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const EMBEDDING_API_KEY = getEmbeddingApiKey();
    let relevantFormsContext = '';
    let contextUsed = false;
    
    if (userId && EMBEDDING_API_KEY) {
      console.log('Generating embedding for context retrieval...');
      
      const embeddingResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${EMBEDDING_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'models/text-embedding-004',
            content: { parts: [{ text: prompt }] }
          })
        }
      );

      if (embeddingResponse.ok) {
        const embeddingData = await embeddingResponse.json();
        const promptEmbedding = embeddingData.embedding?.values;

        if (promptEmbedding && Array.isArray(promptEmbedding)) {
          const finalEmbedding = promptEmbedding.slice(0, 768);
          let similarForms: SimilarForm[] = [];
          
          if (Deno.env.get('PINECONE_API_KEY')) {
            console.log('Querying Pinecone...');
            similarForms = await queryPinecone(finalEmbedding, userId, 5);
          }
          
          if (similarForms.length === 0) {
            console.log('Querying pgvector...');
            const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
            const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
            const supabase = createClient(supabaseUrl, supabaseKey);

            const { data: pgForms, error: searchError } = await supabase
              .rpc('find_similar_forms', {
                query_embedding: `[${finalEmbedding.join(',')}]`,
                match_threshold: 0.3,
                match_count: 5,
                p_user_id: userId
              });

            if (!searchError && pgForms?.length > 0) {
              similarForms = pgForms;
            }
          }

          if (similarForms.length > 0) {
            console.log(`Found ${similarForms.length} relevant forms`);
            
            const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
            const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
            const supabase = createClient(supabaseUrl, supabaseKey);
            
            const formIds = similarForms.map((f) => f.id);
            const { data: formDetails } = await supabase
              .from('forms')
              .select('title, description, schema')
              .in('id', formIds);

            if (formDetails?.length > 0) {
              const summarizedForms = formDetails.map(summarizeForm);
              let totalContext = '';
              for (const summary of summarizedForms) {
                if (totalContext.length + summary.length > 4000) break;
                totalContext += summary + '\n';
              }
              
              relevantFormsContext = `
Here is relevant user form history (top-${similarForms.length} semantic matches):
${totalContext}
Use these patterns for field ordering, naming, and structure.
`;
              contextUsed = true;
            }
          }
        }
      }
    }

    const systemPrompt = `You are an intelligent form schema generator.
${relevantFormsContext}
Generate a JSON schema for the requested form.

Schema structure:
{
  "title": "Form Title",
  "description": "Brief description",
  "fields": [
    {
      "id": "unique_id",
      "type": "text|email|number|textarea|select|checkbox|radio|date|file",
      "label": "Field Label",
      "placeholder": "Optional placeholder",
      "required": true|false,
      "options": ["Option 1", "Option 2"]
    }
  ]
}

Field types: text, email, number, textarea, select, checkbox, radio, date, file
Return ONLY valid JSON, no markdown or explanation.`;

    const truncatedPrompt = truncateText(prompt, 1000);

    const generateWithRetry = async (isRetry: boolean = false): Promise<FormSchema> => {
      const retryPrompt = isRetry 
        ? `RETURN ONLY JSON, no markdown.\n\nGenerate form schema for: ${truncatedPrompt}`
        : `Generate form schema for: ${truncatedPrompt}`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${LLM_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt }, { text: retryPrompt }] }],
            generationConfig: { temperature: isRetry ? 0.3 : 0.7, maxOutputTokens: 2048 }
          })
        }
      );

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status}`);
      }

      const data = await response.json();
      const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!textContent) throw new Error('No response from AI');

      const schema = parseJSONSafe(textContent);
      
      if (!schema) {
        if (!isRetry) return generateWithRetry(true);
        throw new Error('Failed to parse AI response');
      }

      if (!schema.title || !schema.fields || !Array.isArray(schema.fields)) {
        if (!isRetry) return generateWithRetry(true);
        throw new Error('Invalid schema structure');
      }

      return schema;
    };

    const schema = await generateWithRetry();
    console.log('Generated:', schema.title, 'with', schema.fields.length, 'fields');

    return new Response(
      JSON.stringify({ schema, contextUsed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});