import { Link } from 'react-router-dom';
import { useForms } from '@/hooks/useForms';
import { useAuth } from '@/hooks/useAuth';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, FileText, Eye, Trash2, BarChart3, ExternalLink, Copy } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function Dashboard() {
  const { user } = useAuth();
  const { forms, isLoading, deleteForm } = useForms();

  const copyFormLink = (formId: string) => {
    const url = `${window.location.origin}/form/${formId}`;
    navigator.clipboard.writeText(url);
    toast({
      title: 'Link copied!',
      description: 'Form link has been copied to clipboard.'
    });
  };

  const handleDelete = (id: string) => {
    deleteForm.mutate(id);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Welcome back, {user?.email}
            </p>
          </div>
          <Link to="/create">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Form
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-full mt-2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-1/2" />
                </CardContent>
                <CardFooter>
                  <Skeleton className="h-10 w-full" />
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : forms && forms.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {forms.map((form) => (
              <Card key={form.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="line-clamp-1">{form.title}</CardTitle>
                      <CardDescription className="line-clamp-2 mt-1">
                        {form.description || 'No description'}
                      </CardDescription>
                    </div>
                    <Badge variant={form.is_published ? 'default' : 'secondary'}>
                      {form.is_published ? 'Published' : 'Draft'}
                    </Badge>
                  </div>
                </CardHeader>
                
                <CardContent className="flex-1">
                  <p className="text-sm text-muted-foreground">
                    Created {new Date(form.created_at).toLocaleDateString()}
                  </p>
                </CardContent>
                
                <CardFooter className="flex gap-2 flex-wrap">
                  <Link to={`/form/${form.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">
                      <Eye className="mr-2 h-4 w-4" />
                      Preview
                    </Button>
                  </Link>
                  
                  <Link to={`/submissions/${form.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">
                      <BarChart3 className="mr-2 h-4 w-4" />
                      Submissions
                    </Button>
                  </Link>
                  
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyFormLink(form.id)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete form?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete "{form.title}" and all its submissions.
                          This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(form.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="text-center py-12">
            <CardContent>
              <FileText className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold mb-2">No forms yet</h2>
              <p className="text-muted-foreground mb-6">
                Create your first AI-powered form to get started
              </p>
              <Link to="/create">
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Your First Form
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
