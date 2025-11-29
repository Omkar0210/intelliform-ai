# Migration Guide: Next.js 15 + Express.js + MongoDB

This guide helps you rebuild CentralignAI with the original tech stack requirements.

## Target Architecture

```
centralign-ai/
├── client/                    # Next.js 15 Frontend
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── auth/page.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── create/page.tsx
│   │   └── form/[id]/page.tsx
│   ├── components/
│   │   ├── DynamicFormRenderer.tsx
│   │   ├── CloudinaryUploader.tsx
│   │   └── Navbar.tsx
│   └── lib/
│       └── api.ts
│
├── server/                    # Express.js Backend
│   ├── index.ts
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── forms.ts
│   │   └── submissions.ts
│   ├── models/
│   │   ├── User.ts
│   │   ├── Form.ts
│   │   └── Submission.ts
│   └── services/
│       ├── ai.ts              # Gemini API integration
│       └── embeddings.ts      # Vector search
│
└── docker-compose.yml
```

## Environment Variables

```env
# MongoDB
MONGODB_URI=mongodb+srv://ogunjal1:<db_password>@cluster0.nq4tfhy.mongodb.net/centralign?appName=Cluster0

# Gemini AI
GEMINI_API_KEY=your_gemini_api_key

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_UPLOAD_PRESET=your_preset
CLOUDINARY_API_KEY=your_api_key

# Auth
JWT_SECRET=your_jwt_secret

# Optional: Pinecone for vector search
PINECONE_API_KEY=your_pinecone_key
PINECONE_ENV=your_pinecone_environment
```

## MongoDB Schemas

### User Model (server/models/User.ts)
```typescript
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  fullName: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  next();
});

userSchema.methods.comparePassword = function(password: string) {
  return bcrypt.compare(password, this.password);
};

export default mongoose.model('User', userSchema);
```

### Form Model (server/models/Form.ts)
```typescript
import mongoose from 'mongoose';

const formFieldSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['text', 'email', 'number', 'textarea', 'select', 'checkbox', 'radio', 'date', 'file'],
    required: true 
  },
  label: { type: String, required: true },
  placeholder: String,
  required: { type: Boolean, default: false },
  options: [String]
}, { _id: false });

const formSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  description: String,
  schema: {
    title: String,
    description: String,
    fields: [formFieldSchema]
  },
  isPublished: { type: Boolean, default: true },
  embedding: [Number],  // 768-dimensional vector for semantic search
  summary: String,      // Compressed form summary for context
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Index for vector similarity search (requires MongoDB Atlas Vector Search)
formSchema.index({ embedding: 'vectorSearch' });

export default mongoose.model('Form', formSchema);
```

### Submission Model (server/models/Submission.ts)
```typescript
import mongoose from 'mongoose';

const submissionSchema = new mongoose.Schema({
  formId: { type: mongoose.Schema.Types.ObjectId, ref: 'Form', required: true },
  responses: { type: mongoose.Schema.Types.Mixed, required: true },
  imageUrls: [String],
  submittedAt: { type: Date, default: Date.now }
});

export default mongoose.model('Submission', submissionSchema);
```

## Express.js Server Setup

### Main Server (server/index.ts)
```typescript
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth';
import formRoutes from './routes/forms';
import submissionRoutes from './routes/submissions';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI!)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/submissions', submissionRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

## AI Service with Memory Retrieval

### AI Service (server/services/ai.ts)
```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import Form from '../models/Form';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

interface FormSchema {
  title: string;
  description: string;
  fields: Array<{
    id: string;
    type: string;
    label: string;
    placeholder?: string;
    required: boolean;
    options?: string[];
  }>;
}

// Get embedding for semantic search
export async function getEmbedding(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text);
  return result.embedding.values.slice(0, 768);
}

// Find similar forms using MongoDB Atlas Vector Search
export async function findSimilarForms(
  userId: string, 
  promptEmbedding: number[], 
  topK: number = 5
) {
  // MongoDB Atlas Vector Search aggregation
  const results = await Form.aggregate([
    {
      $vectorSearch: {
        index: 'form_embeddings_index',
        path: 'embedding',
        queryVector: promptEmbedding,
        numCandidates: 100,
        limit: topK,
        filter: { userId: new mongoose.Types.ObjectId(userId) }
      }
    },
    {
      $project: {
        title: 1,
        summary: 1,
        schema: 1,
        score: { $meta: 'vectorSearchScore' }
      }
    }
  ]);
  
  return results.filter(r => r.score > 0.3);
}

// Summarize form for context
function summarizeForm(form: any): string {
  const fields = form.schema?.fields?.map((f: any) => f.label).slice(0, 10) || [];
  return JSON.stringify({
    purpose: form.title?.substring(0, 100),
    description: form.description?.substring(0, 200),
    fields: fields.slice(0, 8)
  }).substring(0, 800);
}

// Generate form with context-aware memory
export async function generateForm(
  prompt: string, 
  userId: string
): Promise<{ schema: FormSchema; contextUsed: boolean }> {
  let relevantContext = '';
  let contextUsed = false;

  // Memory retrieval
  const promptEmbedding = await getEmbedding(prompt);
  const similarForms = await findSimilarForms(userId, promptEmbedding, 5);

  if (similarForms.length > 0) {
    const summaries = similarForms.map(summarizeForm);
    let totalContext = '';
    for (const summary of summaries) {
      if (totalContext.length + summary.length > 4000) break;
      totalContext += summary + '\n';
    }
    
    relevantContext = `
Here is relevant user form history (top-${similarForms.length} semantic matches):
${totalContext}
Use these patterns for field ordering, naming, and structure.
`;
    contextUsed = true;
  }

  const systemPrompt = `You are an intelligent form schema generator.
${relevantContext}
Generate a JSON schema for the requested form.

Schema structure:
{
  "title": "Form Title",
  "description": "Brief description",
  "fields": [
    {
      "id": "unique_id",
      "type": "text|email|number|textarea|select|checkbox|radio|date|file",
      "label": "Field Label",
      "placeholder": "Optional placeholder",
      "required": true|false,
      "options": ["Option 1", "Option 2"]
    }
  ]
}

Return ONLY valid JSON, no markdown or explanation.`;

  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent([
    { text: systemPrompt },
    { text: `Generate form schema for: ${prompt.substring(0, 1000)}` }
  ]);

  const text = result.response.text();
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
  const schema = JSON.parse(jsonMatch ? jsonMatch[1] || jsonMatch[0] : text);

  return { schema, contextUsed };
}
```

## Next.js 15 Frontend Setup

### Install Dependencies
```bash
npx create-next-app@latest client --typescript --tailwind --app
cd client
npm install @hookform/resolvers react-hook-form zod @tanstack/react-query axios
npm install @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-checkbox
```

### API Client (client/lib/api.ts)
```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authApi = {
  signUp: (data: { email: string; password: string; fullName: string }) =>
    api.post('/auth/signup', data),
  signIn: (data: { email: string; password: string }) =>
    api.post('/auth/signin', data),
  me: () => api.get('/auth/me')
};

export const formsApi = {
  list: () => api.get('/forms'),
  get: (id: string) => api.get(`/forms/${id}`),
  create: (data: any) => api.post('/forms', data),
  delete: (id: string) => api.delete(`/forms/${id}`),
  generate: (prompt: string) => api.post('/forms/generate', { prompt })
};

export const submissionsApi = {
  list: (formId: string) => api.get(`/submissions/${formId}`),
  create: (data: { formId: string; responses: any; imageUrls?: string[] }) =>
    api.post('/submissions', data)
};

export default api;
```

## MongoDB Atlas Vector Search Setup

1. Go to MongoDB Atlas → Your Cluster → Search Indexes
2. Create a new Vector Search index:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "userId"
    }
  ]
}
```

## Key Differences from Current Implementation

| Current (Supabase) | Target (MongoDB) |
|--------------------|------------------|
| Supabase Auth | JWT + bcrypt |
| PostgreSQL + pgvector | MongoDB Atlas Vector Search |
| Supabase Edge Functions | Express.js routes |
| Supabase RLS policies | Express middleware auth |
| `supabase.from().select()` | Mongoose queries |

## Running the Project

```bash
# Terminal 1: Backend
cd server
npm install
npm run dev

# Terminal 2: Frontend
cd client
npm install
npm run dev
```

## Migration Checklist

- [ ] Set up MongoDB Atlas cluster
- [ ] Configure Vector Search index
- [ ] Create Express.js server with routes
- [ ] Implement JWT authentication
- [ ] Port Gemini AI integration
- [ ] Set up Next.js 15 with App Router
- [ ] Port React components (mostly copy-paste)
- [ ] Configure Cloudinary
- [ ] Test form generation with memory retrieval
- [ ] Deploy (Vercel for Next.js, Railway/Render for Express)

## Estimated Rebuild Time

- Backend setup: 2-3 hours
- MongoDB schemas & vector search: 1-2 hours
- Auth system: 1-2 hours
- Frontend migration: 1-2 hours
- Testing & debugging: 2-3 hours

**Total: ~8-12 hours**
