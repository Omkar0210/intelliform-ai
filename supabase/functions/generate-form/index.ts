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

async function getEmbedding(text: string): Promise<number[] | null> {
  const EMBEDDING_API_KEY = Deno.env.get('EMBEDDING_API_KEY') || Deno.env.get('LLM_API_KEY');
  if (!EMBEDDING_API_KEY) return null;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${EMBEDDING_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text }] }
        })
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.embedding?.values?.slice(0, 768) || null;
    }
    return null;
  } catch (error) {
    console.error('Embedding error:', error);
    return null;
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

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'AI service not configured. LOVABLE_API_KEY is missing.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let relevantFormsContext = '';
    let contextUsed = false;
    
    // Memory retrieval using embeddings
    if (userId) {
      console.log('Generating embedding for context retrieval...');
      const promptEmbedding = await getEmbedding(prompt);

      if (promptEmbedding && Array.isArray(promptEmbedding)) {
        let similarForms: SimilarForm[] = [];
        
        // Try Pinecone first if configured
        if (Deno.env.get('PINECONE_API_KEY')) {
          console.log('Querying Pinecone...');
          similarForms = await queryPinecone(promptEmbedding, userId, 5);
        }
        
        // Fallback to pgvector
        if (similarForms.length === 0) {
          console.log('Querying pgvector...');
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const supabase = createClient(supabaseUrl, supabaseKey);

          const { data: pgForms, error: searchError } = await supabase
            .rpc('find_similar_forms', {
              query_embedding: `[${promptEmbedding.join(',')}]`,
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

          if (formDetails && formDetails.length > 0) {
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
      const userMessage = isRetry 
        ? `RETURN ONLY JSON, no markdown.\n\nGenerate form schema for: ${truncatedPrompt}`
        : `Generate form schema for: ${truncatedPrompt}`;

      console.log('Calling Lovable AI Gateway...');
      
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          max_tokens: 2048
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Lovable AI error:', response.status, errorText);
        
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        }
        if (response.status === 402) {
          throw new Error('AI credits exhausted. Please add funds to continue.');
        }
        throw new Error(`AI service error: ${response.status}`);
      }

      const data = await response.json();
      const textContent = data.choices?.[0]?.message?.content;
      
      if (!textContent) throw new Error('No response from AI');

      console.log('AI response received, parsing JSON...');
      const schema = parseJSONSafe(textContent);
      
      if (!schema) {
        if (!isRetry) {
          console.log('JSON parsing failed, retrying with stricter prompt...');
          return generateWithRetry(true);
        }
        throw new Error('Failed to parse AI response as valid JSON');
      }

      if (!schema.title || !schema.fields || !Array.isArray(schema.fields)) {
        if (!isRetry) {
          console.log('Invalid schema structure, retrying...');
          return generateWithRetry(true);
        }
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
