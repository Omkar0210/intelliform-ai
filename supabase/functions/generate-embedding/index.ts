import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { formId, text } = await req.json();
    
    if (!formId || !text) {
      return new Response(
        JSON.stringify({ error: 'formId and text are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Embedding service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating embedding for form:', formId);

    // Generate embedding using Gemini embedding model
    const embeddingResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: {
            parts: [{ text }]
          }
        })
      }
    );

    if (!embeddingResponse.ok) {
      const errorText = await embeddingResponse.text();
      console.error('Embedding API error:', embeddingResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Embedding service error', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const embeddingData = await embeddingResponse.json();
    const embedding = embeddingData.embedding?.values;

    if (!embedding || !Array.isArray(embedding)) {
      console.error('Invalid embedding response:', embeddingData);
      return new Response(
        JSON.stringify({ error: 'Invalid embedding response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generated embedding with', embedding.length, 'dimensions');

    // Pad or truncate to 1536 dimensions (matching existing vector column)
    let paddedEmbedding = embedding;
    if (embedding.length < 1536) {
      paddedEmbedding = [...embedding, ...new Array(1536 - embedding.length).fill(0)];
    } else if (embedding.length > 1536) {
      paddedEmbedding = embedding.slice(0, 1536);
    }

    // Update the form with the embedding
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error: updateError } = await supabase
      .from('forms')
      .update({ 
        embedding: `[${paddedEmbedding.join(',')}]`,
        summary: text.substring(0, 500)
      })
      .eq('id', formId);

    if (updateError) {
      console.error('Error updating form with embedding:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to save embedding', details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Successfully saved embedding for form:', formId);

    return new Response(
      JSON.stringify({ success: true, dimensions: paddedEmbedding.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in generate-embedding:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
