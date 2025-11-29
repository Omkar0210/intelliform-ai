import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForms, FormSchema } from '@/hooks/useForms';
import { Navbar } from '@/components/Navbar';
import { DynamicFormRenderer } from '@/components/DynamicFormRenderer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { Loader2, Sparkles, Save, Eye, ArrowLeft } from 'lucide-react';

export default function CreateForm() {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedSchema, setGeneratedSchema] = useState<FormSchema | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  
  const navigate = useNavigate();
  const { generateFormWithAI, createForm } = useForms();

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast({
        variant: 'destructive',
        title: 'Prompt required',
        description: 'Please describe the form you want to create.'
      });
      return;
    }

    setIsGenerating(true);
    try {
      const schema = await generateFormWithAI(prompt);
      setGeneratedSchema(schema);
      toast({
        title: 'Form generated!',
        description: 'Review your form and save it when ready.'
      });
    } catch (error) {
      console.error('Generation error:', error);
      toast({
        variant: 'destructive',
        title: 'Generation failed',
        description: error instanceof Error ? error.message : 'Failed to generate form'
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!generatedSchema) return;

    setIsSaving(true);
    try {
      await createForm.mutateAsync({
        title: generatedSchema.title,
        description: generatedSchema.description,
        schema: generatedSchema
      });
      toast({
        title: 'Form saved!',
        description: 'Your form has been created successfully.'
      });
      navigate('/dashboard');
    } catch (error) {
      console.error('Save error:', error);
      toast({
        variant: 'destructive',
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed to save form'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreviewSubmit = async () => {
    toast({
      title: 'Preview mode',
      description: 'This is just a preview. Save the form to enable submissions.'
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8">
        <Button
          variant="ghost"
          className="mb-6"
          onClick={() => navigate('/dashboard')}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Generator Panel */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  AI Form Generator
                </CardTitle>
                <CardDescription>
                  Describe the form you want to create and AI will generate it for you
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="prompt">Form Description</Label>
                  <Textarea
                    id="prompt"
                    placeholder="e.g., Create a job application form with fields for name, email, resume upload, years of experience, and preferred start date..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={5}
                    className="resize-none"
                  />
                </div>
                
                <Button 
                  onClick={handleGenerate} 
                  disabled={isGenerating || !prompt.trim()}
                  className="w-full"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Form
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Example Prompts */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Example Prompts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  "Create a customer feedback form with rating, comments, and optional contact info",
                  "Build an event registration form with name, email, number of guests, and dietary preferences",
                  "Make a bug report form with title, description, severity level, and screenshot upload"
                ].map((example, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="w-full justify-start text-left h-auto py-2 text-xs"
                    onClick={() => setPrompt(example)}
                  >
                    {example}
                  </Button>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Preview Panel */}
          <div className="space-y-6">
            {generatedSchema ? (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Generated Form</h2>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setShowPreview(!showPreview)}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      {showPreview ? 'Edit Schema' : 'Preview Form'}
                    </Button>
                    <Button onClick={handleSave} disabled={isSaving}>
                      {isSaving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          Save Form
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {showPreview ? (
                  <DynamicFormRenderer
                    schema={generatedSchema}
                    onSubmit={handlePreviewSubmit}
                  />
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle>{generatedSchema.title}</CardTitle>
                      <CardDescription>{generatedSchema.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <h3 className="font-medium">Fields ({generatedSchema.fields.length})</h3>
                        <div className="space-y-2">
                          {generatedSchema.fields.map((field, index) => (
                            <div
                              key={field.id}
                              className="flex items-center justify-between p-3 bg-muted rounded-lg"
                            >
                              <div>
                                <p className="font-medium">{field.label}</p>
                                <p className="text-sm text-muted-foreground">
                                  Type: {field.type} {field.required && '• Required'}
                                </p>
                              </div>
                              <span className="text-sm text-muted-foreground">#{index + 1}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card className="h-[400px] flex items-center justify-center">
                <CardContent className="text-center">
                  <Sparkles className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No form generated yet</h3>
                  <p className="text-muted-foreground">
                    Describe your form and click "Generate Form" to get started
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
