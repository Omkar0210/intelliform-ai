import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from '@/hooks/use-toast';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type Form = Tables<'forms'>;
export type FormInsert = TablesInsert<'forms'>;

export interface FormSchema {
  title: string;
  description: string;
  fields: FormField[];
}

export interface FormField {
  id: string;
  type: 'text' | 'email' | 'number' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'date' | 'file';
  label: string;
  placeholder?: string;
  required: boolean;
  options?: string[];
}

export function useForms() {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();

  const { data: forms, isLoading, error } = useQuery({
    queryKey: ['forms', user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      const { data, error } = await supabase
        .from('forms')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as Form[];
    },
    enabled: !!user
  });

  const createForm = useMutation({
    mutationFn: async (formData: { title: string; description: string; schema: FormSchema }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('forms')
        .insert({
          user_id: user.id,
          title: formData.title,
          description: formData.description,
          schema: JSON.parse(JSON.stringify(formData.schema))
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['forms'] });
      
      // Generate embedding in background
      if (session?.access_token) {
        generateEmbedding(data.id, `${data.title} ${data.description}`);
      }
    }
  });

  const generateEmbedding = async (formId: string, text: string) => {
    try {
      const { error } = await supabase.functions.invoke('generate-embedding', {
        body: { formId, text }
      });
      
      if (error) {
        console.error('Failed to generate embedding:', error);
      }
    } catch (err) {
      console.error('Embedding generation error:', err);
    }
  };

  const updateForm = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Form> & { id: string }) => {
      const { data, error } = await supabase
        .from('forms')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forms'] });
    }
  });

  const deleteForm = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('forms')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forms'] });
      toast({
        title: 'Form deleted',
        description: 'The form has been permanently deleted.'
      });
    }
  });

  const generateFormWithAI = async (prompt: string): Promise<FormSchema> => {
    // Pass userId to enable context-aware memory retrieval
    const { data, error } = await supabase.functions.invoke('generate-form', {
      body: { prompt, userId: user?.id }
    });
    
    if (error) throw error;
    if (data.error) throw new Error(data.error);
    
    console.log('Form generated with context:', data.contextUsed ? 'Yes' : 'No');
    return data.schema;
  };

  return {
    forms,
    isLoading,
    error,
    createForm,
    updateForm,
    deleteForm,
    generateFormWithAI
  };
}

export function useForm(formId: string | undefined) {
  return useQuery({
    queryKey: ['form', formId],
    queryFn: async () => {
      if (!formId) return null;
      
      const { data, error } = await supabase
        .from('forms')
        .select('*')
        .eq('id', formId)
        .single();
      
      if (error) throw error;
      return data as Form;
    },
    enabled: !!formId
  });
}
