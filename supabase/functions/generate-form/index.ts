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
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
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

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================================
    // CONTEXT-AWARE MEMORY RETRIEVAL
    // ============================================================
    // Step 1: Generate embedding for the user's prompt
    // Step 2: Find similar past forms using semantic search (top-K)
    // Step 3: Include only relevant context in AI prompt
    // This handles thousands of forms efficiently by NOT loading all history
    // ============================================================

    let relevantFormsContext = '';
    
    if (userId) {
      console.log('Generating embedding for prompt to find relevant past forms...');
      
      // Generate embedding for the user's current prompt
      const embeddingResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'models/text-embedding-004',
            content: {
              parts: [{ text: prompt }]
            }
          })
        }
      );

      if (embeddingResponse.ok) {
        const embeddingData = await embeddingResponse.json();
        const promptEmbedding = embeddingData.embedding?.values;

        if (promptEmbedding && Array.isArray(promptEmbedding)) {
          // Ensure 768 dimensions to match DB
          const finalEmbedding = promptEmbedding.slice(0, 768);
          
          // Query similar forms using pgvector semantic search
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const supabase = createClient(supabaseUrl, supabaseKey);

          console.log('Searching for similar past forms (top-5)...');
          
          // Call the find_similar_forms function - retrieves only top-K relevant forms
          // This is the key to handling thousands of forms efficiently
          const { data: similarForms, error: searchError } = await supabase
            .rpc('find_similar_forms', {
              query_embedding: `[${finalEmbedding.join(',')}]`,
              match_threshold: 0.3, // Only forms with >30% similarity
              match_count: 5,       // Top 5 most relevant forms
              p_user_id: userId
            });

          if (searchError) {
            console.error('Similar forms search error:', searchError);
          } else if (similarForms && similarForms.length > 0) {
            console.log(`Found ${similarForms.length} relevant past forms`);
            
            // Fetch full schema for the most relevant forms (limit context size)
            const formIds = similarForms.map((f: SimilarForm) => f.id);
            const { data: formDetails } = await supabase
              .from('forms')
              .select('title, description, schema')
              .in('id', formIds);

            if (formDetails && formDetails.length > 0) {
              // Build context from relevant forms only
              const formsForContext = formDetails.map((form: any) => ({
                purpose: form.title,
                description: form.description,
                fields: form.schema?.fields?.map((f: any) => f.label) || []
              }));

              relevantFormsContext = `
Here is relevant user form history for reference (retrieved via semantic search from ${similarForms.length} most similar past forms):
${JSON.stringify(formsForContext, null, 2)}

Use these patterns as inspiration for field ordering, naming conventions, and structure where applicable.
`;
              console.log('Context-aware memory applied:', formsForContext.length, 'forms');
            }
          } else {
            console.log('No similar past forms found - generating without context');
          }
        }
      } else {
        console.error('Failed to generate prompt embedding for context retrieval');
      }
    }

    // ============================================================
    // AI FORM GENERATION WITH CONTEXT
    // ============================================================

    const systemPrompt = `You are an intelligent form schema generator.
${relevantFormsContext}
Given a user's description of a form they need, generate a JSON schema for that form.

The schema must follow this exact structure:
{
  "title": "Form Title",
  "description": "Brief description of the form",
  "fields": [
    {
      "id": "unique_field_id",
      "type": "text|email|number|textarea|select|checkbox|radio|date|file",
      "label": "Field Label",
      "placeholder": "Optional placeholder text",
      "required": true|false,
      "options": ["Option 1", "Option 2"] // Only for select, checkbox, radio types
    }
  ]
}

Field types available:
- text: Single line text input
- email: Email input with validation
- number: Numeric input
- textarea: Multi-line text input
- select: Dropdown selection
- checkbox: Multiple choice checkboxes
- radio: Single choice radio buttons
- date: Date picker
- file: File upload (for images, documents, resumes)

Generate appropriate fields based on the user's description. Be thorough but practical.
Return ONLY valid JSON, no markdown or explanation.`;

    console.log('Calling Gemini API with prompt:', prompt);
    console.log('Context included:', relevantFormsContext ? 'Yes' : 'No');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: systemPrompt },
                { text: `Generate a form schema for: ${prompt}` }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: 'AI service error', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('Gemini response received');

    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!textContent) {
      return new Response(
        JSON.stringify({ error: 'No response from AI' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract JSON from the response (handle markdown code blocks)
    let jsonString = textContent;
    const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1].trim();
    }

    let schema: FormSchema;
    try {
      schema = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Failed to parse schema:', jsonString);
      return new Response(
        JSON.stringify({ error: 'Failed to parse AI response', raw: textContent }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate schema structure
    if (!schema.title || !schema.fields || !Array.isArray(schema.fields)) {
      return new Response(
        JSON.stringify({ error: 'Invalid schema structure', schema }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generated schema:', schema.title, 'with', schema.fields.length, 'fields');

    return new Response(
      JSON.stringify({ 
        schema,
        contextUsed: relevantFormsContext ? true : false 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in generate-form:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
