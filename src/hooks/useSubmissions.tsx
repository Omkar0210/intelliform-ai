import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type Submission = Tables<'submissions'>;
export type SubmissionInsert = TablesInsert<'submissions'>;

export function useSubmissions(formId: string | undefined) {
  const queryClient = useQueryClient();

  const { data: submissions, isLoading, error } = useQuery({
    queryKey: ['submissions', formId],
    queryFn: async () => {
      if (!formId) return [];
      
      const { data, error } = await supabase
        .from('submissions')
        .select('*')
        .eq('form_id', formId)
        .order('submitted_at', { ascending: false });
      
      if (error) throw error;
      return data as Submission[];
    },
    enabled: !!formId
  });

  const createSubmission = useMutation({
    mutationFn: async (data: { formId: string; responses: Record<string, unknown>; imageUrls?: string[] }) => {
      const { data: submission, error } = await supabase
        .from('submissions')
        .insert({
          form_id: data.formId,
          responses: JSON.parse(JSON.stringify(data.responses)),
          image_urls: data.imageUrls || []
        })
        .select()
        .single();
      
      if (error) throw error;
      return submission;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submissions'] });
      toast({
        title: 'Form submitted',
        description: 'Your response has been recorded successfully.'
      });
    }
  });

  return {
    submissions,
    isLoading,
    error,
    createSubmission
  };
}

export function useAllSubmissions() {
  return useQuery({
    queryKey: ['all-submissions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('submissions')
        .select(`
          *,
          forms:form_id (
            id,
            title,
            user_id
          )
        `)
        .order('submitted_at', { ascending: false });
      
      if (error) throw error;
      return data;
    }
  });
}
