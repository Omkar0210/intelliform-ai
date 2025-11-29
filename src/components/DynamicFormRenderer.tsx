import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CloudinaryUploader } from './CloudinaryUploader';
import { Loader2 } from 'lucide-react';
import type { FormSchema, FormField } from '@/hooks/useForms';

interface DynamicFormRendererProps {
  schema: FormSchema;
  onSubmit: (data: Record<string, unknown>, imageUrls: string[]) => Promise<void>;
  isSubmitting?: boolean;
}

export function DynamicFormRenderer({ schema, onSubmit, isSubmitting }: DynamicFormRendererProps) {
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  
  // Build dynamic zod schema
  const buildZodSchema = (fields: FormField[]) => {
    const schemaObj: Record<string, z.ZodTypeAny> = {};
    
    fields.forEach(field => {
      let fieldSchema: z.ZodTypeAny;
      
      switch (field.type) {
        case 'email':
          fieldSchema = z.string().email('Invalid email address');
          break;
        case 'number':
          fieldSchema = z.coerce.number();
          break;
        case 'checkbox':
          fieldSchema = z.array(z.string()).optional();
          break;
        case 'file':
          fieldSchema = z.string().optional();
          break;
        default:
          fieldSchema = z.string();
      }
      
      if (field.required && field.type !== 'checkbox' && field.type !== 'file') {
        fieldSchema = fieldSchema.refine(val => val !== undefined && val !== '', {
          message: `${field.label} is required`
        });
      }
      
      schemaObj[field.id] = fieldSchema;
    });
    
    return z.object(schemaObj);
  };

  const zodSchema = buildZodSchema(schema.fields);
  
  const form = useForm({
    resolver: zodResolver(zodSchema),
    defaultValues: schema.fields.reduce((acc, field) => {
      acc[field.id] = field.type === 'checkbox' ? [] : '';
      return acc;
    }, {} as Record<string, unknown>)
  });

  const handleSubmit = async (data: Record<string, unknown>) => {
    // Merge image URLs into the data
    const finalData = { ...data };
    Object.entries(imageUrls).forEach(([fieldId, url]) => {
      finalData[fieldId] = url;
    });
    
    await onSubmit(finalData, Object.values(imageUrls));
  };

  const handleImageUpload = (fieldId: string, url: string) => {
    setImageUrls(prev => ({ ...prev, [fieldId]: url }));
    form.setValue(fieldId, url);
  };

  const renderField = (field: FormField) => {
    switch (field.type) {
      case 'text':
      case 'email':
      case 'number':
      case 'date':
        return (
          <Input
            type={field.type}
            placeholder={field.placeholder}
            {...form.register(field.id)}
          />
        );
      
      case 'textarea':
        return (
          <Textarea
            placeholder={field.placeholder}
            rows={4}
            {...form.register(field.id)}
          />
        );
      
      case 'select':
        return (
          <Select onValueChange={(value) => form.setValue(field.id, value)}>
            <SelectTrigger>
              <SelectValue placeholder={field.placeholder || 'Select an option'} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      
      case 'radio':
        return (
          <RadioGroup onValueChange={(value) => form.setValue(field.id, value)}>
            {field.options?.map((option) => (
              <div key={option} className="flex items-center space-x-2">
                <RadioGroupItem value={option} id={`${field.id}-${option}`} />
                <Label htmlFor={`${field.id}-${option}`}>{option}</Label>
              </div>
            ))}
          </RadioGroup>
        );
      
      case 'checkbox':
        return (
          <div className="space-y-2">
            {field.options?.map((option) => (
              <div key={option} className="flex items-center space-x-2">
                <Checkbox
                  id={`${field.id}-${option}`}
                  onCheckedChange={(checked) => {
                    const current = form.getValues(field.id) as string[] || [];
                    if (checked) {
                      form.setValue(field.id, [...current, option]);
                    } else {
                      form.setValue(field.id, current.filter(v => v !== option));
                    }
                  }}
                />
                <Label htmlFor={`${field.id}-${option}`}>{option}</Label>
              </div>
            ))}
          </div>
        );
      
      case 'file':
        return (
          <CloudinaryUploader
            onUpload={(url) => handleImageUpload(field.id, url)}
            onRemove={() => {
              setImageUrls(prev => {
                const newUrls = { ...prev };
                delete newUrls[field.id];
                return newUrls;
              });
              form.setValue(field.id, '');
            }}
            currentImage={imageUrls[field.id]}
          />
        );
      
      default:
        return (
          <Input
            type="text"
            placeholder={field.placeholder}
            {...form.register(field.id)}
          />
        );
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>{schema.title}</CardTitle>
        {schema.description && (
          <CardDescription>{schema.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          {schema.fields.map((field) => (
            <div key={field.id} className="space-y-2">
              <Label htmlFor={field.id}>
                {field.label}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </Label>
              {renderField(field)}
              {form.formState.errors[field.id] && (
                <p className="text-sm text-destructive">
                  {form.formState.errors[field.id]?.message as string}
                </p>
              )}
            </div>
          ))}
          
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              'Submit'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
