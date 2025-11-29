import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEmbeddingApiKey(): string | undefined {
  return Deno.env.get('EMBEDDING_API_KEY') || Deno.env.get('LLM_API_KEY') || Deno.env.get('GEMINI_API_KEY');
}

async function upsertToPinecone(
  formId: string, 
  embedding: number[], 
  metadata: { title: string; summary: string; user_id: string }
): Promise<boolean> {
  const pineconeApiKey = Deno.env.get('PINECONE_API_KEY');
  const pineconeEnv = Deno.env.get('PINECONE_ENV') || Deno.env.get('PINECONE_ENVIRONMENT');
  
  if (!pineconeApiKey || !pineconeEnv) return false;

  try {
    const indexName = 'form-embeddings';
    const pineconeHost = `${indexName}-${pineconeEnv}.svc.pinecone.io`;
    
    const response = await fetch(`https://${pineconeHost}/vectors/upsert`, {
      method: 'POST',
      headers: { 'Api-Key': pineconeApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vectors: [{ id: formId, values: embedding, metadata }]
      })
    });

    if (!response.ok) {
      console.error('Pinecone upsert failed:', response.status);
      return false;
    }
    console.log('Upserted to Pinecone');
    return true;
  } catch (error) {
    console.error('Pinecone error:', error);
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { formId, text, userId } = await req.json();
    
    if (!formId || !text) {
      return new Response(
        JSON.stringify({ error: 'formId and text are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const EMBEDDING_API_KEY = getEmbeddingApiKey();
    if (!EMBEDDING_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Embedding service not configured. Set EMBEDDING_API_KEY, LLM_API_KEY, or GEMINI_API_KEY.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating embedding for form:', formId);

    const embeddingResponse = await fetch(
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

    if (!embeddingResponse.ok) {
      const errorText = await embeddingResponse.text();
      console.error('Embedding error:', embeddingResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to generate embedding', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const embeddingData = await embeddingResponse.json();
    const embedding = embeddingData.embedding?.values;

    if (!embedding || !Array.isArray(embedding)) {
      return new Response(
        JSON.stringify({ error: 'Invalid embedding response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const finalEmbedding = embedding.slice(0, 768);
    console.log('Embedding:', finalEmbedding.length, 'dimensions');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const summary = text.substring(0, 500);

    const { error: updateError } = await supabase
      .from('forms')
      .update({ embedding: `[${finalEmbedding.join(',')}]`, summary })
      .eq('id', formId);

    if (updateError) {
      console.error('Save error:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to save embedding', details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Saved to Supabase');

    if (userId) {
      await upsertToPinecone(formId, finalEmbedding, {
        title: text.split(' ').slice(0, 10).join(' '),
        summary,
        user_id: userId
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        dimensions: finalEmbedding.length,
        pineconeEnabled: !!Deno.env.get('PINECONE_API_KEY')
      }),
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
