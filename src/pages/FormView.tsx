import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from '@/hooks/useForms';
import { useSubmissions } from '@/hooks/useSubmissions';
import { DynamicFormRenderer } from '@/components/DynamicFormRenderer';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { FormSchema } from '@/hooks/useForms';

export default function FormView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: form, isLoading, error } = useForm(id);
  const { createSubmission } = useSubmissions(id);

  const handleSubmit = async (data: Record<string, unknown>, imageUrls: string[]) => {
    if (!id) return;
    
    try {
      await createSubmission.mutateAsync({
        formId: id,
        responses: data,
        imageUrls
      });
    } catch (error) {
      console.error('Submission error:', error);
      toast({
        variant: 'destructive',
        title: 'Submission failed',
        description: error instanceof Error ? error.message : 'Failed to submit form'
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-2xl mx-auto space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      </div>
    );
  }

  if (error || !form) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
          <h1 className="text-xl font-semibold mb-2">Form not found</h1>
          <p className="text-muted-foreground mb-6">
            This form may have been deleted or doesn't exist.
          </p>
          <Button onClick={() => navigate('/')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  if (!form.is_published) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-xl font-semibold mb-2">Form not available</h1>
          <p className="text-muted-foreground mb-6">
            This form is not currently accepting submissions.
          </p>
          <Button onClick={() => navigate('/')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  const schema = form.schema as unknown as FormSchema;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Button
          variant="ghost"
          className="mb-6"
          onClick={() => navigate('/')}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <DynamicFormRenderer
          schema={schema}
          onSubmit={handleSubmit}
          isSubmitting={createSubmission.isPending}
        />

        <p className="text-center text-sm text-muted-foreground mt-6">
          Powered by FormBuilder AI
        </p>
      </div>
    </div>
  );
}
