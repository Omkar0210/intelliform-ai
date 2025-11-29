import { useParams, useNavigate, Link } from 'react-router-dom';
import { useForm } from '@/hooks/useForms';
import { useSubmissions } from '@/hooks/useSubmissions';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ArrowLeft, Eye, Image as ImageIcon, FileText, Download } from 'lucide-react';
import type { FormSchema } from '@/hooks/useForms';

export default function Submissions() {
  const { formId } = useParams<{ formId: string }>();
  const navigate = useNavigate();
  const { data: form, isLoading: formLoading } = useForm(formId);
  const { submissions, isLoading: submissionsLoading } = useSubmissions(formId);

  const schema = form?.schema as unknown as FormSchema;
  const fields = schema?.fields || [];

  const exportToCSV = () => {
    if (!submissions || submissions.length === 0) return;

    const headers = ['Submitted At', ...fields.map(f => f.label)];
    const rows = submissions.map(sub => {
      const responses = sub.responses as Record<string, unknown>;
      return [
        new Date(sub.submitted_at).toLocaleString(),
        ...fields.map(f => {
          const value = responses[f.id];
          if (Array.isArray(value)) return value.join(', ');
          return String(value || '');
        })
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${form?.title || 'submissions'}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (formLoading || submissionsLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container mx-auto px-4 py-8">
          <Skeleton className="h-8 w-48 mb-6" />
          <Skeleton className="h-[400px] w-full" />
        </main>
      </div>
    );
  }

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

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{form?.title}</h1>
            <p className="text-muted-foreground mt-1">
              {submissions?.length || 0} submission{submissions?.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Link to={`/form/${formId}`}>
              <Button variant="outline">
                <Eye className="mr-2 h-4 w-4" />
                View Form
              </Button>
            </Link>
            <Button onClick={exportToCSV} disabled={!submissions?.length}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>

        {submissions && submissions.length > 0 ? (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Submitted</TableHead>
                      {fields.slice(0, 4).map((field) => (
                        <TableHead key={field.id}>{field.label}</TableHead>
                      ))}
                      <TableHead>Images</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {submissions.map((submission) => {
                      const responses = submission.responses as Record<string, unknown>;
                      const imageUrls = submission.image_urls || [];
                      
                      return (
                        <TableRow key={submission.id}>
                          <TableCell className="whitespace-nowrap">
                            {new Date(submission.submitted_at).toLocaleDateString()}
                          </TableCell>
                          {fields.slice(0, 4).map((field) => {
                            const value = responses[field.id];
                            let displayValue: string;
                            
                            if (Array.isArray(value)) {
                              displayValue = value.join(', ');
                            } else if (typeof value === 'string' && value.startsWith('http')) {
                              displayValue = 'File uploaded';
                            } else {
                              displayValue = String(value || '-');
                            }
                            
                            return (
                              <TableCell key={field.id} className="max-w-[200px] truncate">
                                {displayValue}
                              </TableCell>
                            );
                          })}
                          <TableCell>
                            {imageUrls.length > 0 ? (
                              <Badge variant="secondary">
                                <ImageIcon className="mr-1 h-3 w-3" />
                                {imageUrls.length}
                              </Badge>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                          <TableCell>
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                                <DialogHeader>
                                  <DialogTitle>Submission Details</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4 mt-4">
                                  <div className="text-sm text-muted-foreground">
                                    Submitted: {new Date(submission.submitted_at).toLocaleString()}
                                  </div>
                                  
                                  {fields.map((field) => {
                                    const value = responses[field.id];
                                    let content: React.ReactNode;
                                    
                                    if (typeof value === 'string' && value.startsWith('http')) {
                                      content = (
                                        <a
                                          href={value}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-primary hover:underline"
                                        >
                                          View file
                                        </a>
                                      );
                                    } else if (Array.isArray(value)) {
                                      content = value.join(', ');
                                    } else {
                                      content = String(value || '-');
                                    }
                                    
                                    return (
                                      <div key={field.id} className="border-b pb-3">
                                        <p className="font-medium text-sm">{field.label}</p>
                                        <p className="text-muted-foreground">{content}</p>
                                      </div>
                                    );
                                  })}
                                  
                                  {imageUrls.length > 0 && (
                                    <div>
                                      <p className="font-medium text-sm mb-2">Uploaded Images</p>
                                      <div className="grid grid-cols-2 gap-2">
                                        {imageUrls.map((url, i) => (
                                          <a
                                            key={i}
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            <img
                                              src={url}
                                              alt={`Upload ${i + 1}`}
                                              className="w-full h-32 object-cover rounded-lg border hover:opacity-80 transition-opacity"
                                            />
                                          </a>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </DialogContent>
                            </Dialog>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="text-center py-12">
            <CardContent>
              <FileText className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold mb-2">No submissions yet</h2>
              <p className="text-muted-foreground mb-6">
                Share your form to start collecting responses
              </p>
              <Link to={`/form/${formId}`}>
                <Button>
                  <Eye className="mr-2 h-4 w-4" />
                  View Form
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
