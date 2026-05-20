# Implementation Guide - Missing AI Features

## Overview
This guide provides all SQL migrations, Edge Functions, and React components needed to implement the missing features.

---

## 1. DATABASE SETUP (Execute These SQL Queries)

### Location
Copy and paste the entire content of this file into Supabase SQL Editor:
`supabase/migrations/20260516_ai_token_usage_tracking.sql`

**What it creates:**
- `ai_usage_logs` - Track every AI API call with token counts and costs
- `ai_model_costs` - Store pricing per model
- `ai_usage_daily_summary` - Daily aggregated analytics
- `ai_response_feedback` - User feedback on AI responses
- `ai_content_approval_queue` - Content review workflow
- `ai_improvement_feedback` - Learning from corrections
- `image_compression_log` - Track image uploads and compression

**After executing, verify:**
```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'ai_%';

-- Check initial model costs
SELECT * FROM ai_model_costs;
```

---

## 2. BACKEND FUNCTIONS (Supabase Edge Functions)

### Function 1: AI Router Enhanced (with Token Tracking)
**File:** `supabase/functions/ai-router-enhanced/index.ts`
**Purpose:** Routes AI requests and tracks token usage + calculates confidence scores
**Deploy with:**
```bash
supabase functions deploy ai-router-enhanced
```

### Function 2: AI Analytics Aggregator
**File:** `supabase/functions/ai-analytics-aggregator/index.ts`
**Purpose:** Aggregates daily AI usage logs into summaries
**Deploy with:**
```bash
supabase functions deploy ai-analytics-aggregator
```

### Function 3: Image Compression Service
**File:** `supabase/functions/image-compression-service/index.ts`
**Purpose:** Handles image compression and storage
**Deploy with:**
```bash
supabase functions deploy image-compression-service
```

### Function 4: AI Approval Workflow
**File:** `supabase/functions/ai-approval-workflow/index.ts`
**Purpose:** Manages content review and approval queue
**Deploy with:**
```bash
supabase functions deploy ai-approval-workflow
```

### Function 5: AI Feedback Learning Loop
**File:** `supabase/functions/ai-feedback-learning-loop/index.ts`
**Purpose:** Captures feedback and learns from corrections
**Deploy with:**
```bash
supabase functions deploy ai-feedback-learning-loop
```

---

## 3. FRONTEND COMPONENTS (React)

### Component 1: AITokenAnalyticsDashboard
**File:** `src/components/AITokenAnalyticsDashboard.tsx`
**Usage:**
```tsx
import { AITokenAnalyticsDashboard } from "@/components/AITokenAnalyticsDashboard";

// In your dashboard or admin panel:
<AITokenAnalyticsDashboard />
```

**Features:**
- Cost tracking chart
- Token usage statistics
- Error rate monitoring
- Model comparison
- Daily breakdown table

### Component 2: AIContentApprovalPanel
**File:** `src/components/AIContentApprovalPanel.tsx`
**Usage:**
```tsx
import { AIContentApprovalPanel } from "@/components/AIContentApprovalPanel";

// In admin panel:
<AIContentApprovalPanel />
```

**Features:**
- Pending content queue
- Approval/rejection workflow
- Confidence scoring display
- Quality issues tracking

### Component 3: AIResponseFeedback
**File:** `src/components/AIResponseFeedback.tsx`
**Usage:**
```tsx
import { AIResponseFeedback } from "@/components/AIResponseFeedback";
import { useState } from "react";

function MyComponent() {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  
  return (
    <>
      <Button onClick={() => setFeedbackOpen(true)}>Rate Response</Button>
      <AIResponseFeedback
        aiResponseId="response-uuid"
        taskType="tutor"
        confidenceScore={0.85}
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
      />
    </>
  );
}
```

**Features:**
- Accuracy rating
- Value rating (1-5)
- Correction submission
- Feedback notes

### Component 4: ImageCompressionUploader
**File:** `src/components/ImageCompressionUploader.tsx`
**Usage:**
```tsx
import { ImageCompressionUploader } from "@/components/ImageCompressionUploader";

// In file upload sections:
<ImageCompressionUploader />
```

**Features:**
- Quality slider (40-100%)
- Automatic compression
- Upload history
- Compression statistics

---

## 4. INTEGRATION STEPS

### Step 1: Add to Admin Panel
**File:** `src/pages/AdminPanel.tsx`

Add these imports:
```tsx
import { AITokenAnalyticsDashboard } from "@/components/AITokenAnalyticsDashboard";
import { AIContentApprovalPanel } from "@/components/AIContentApprovalPanel";
import { ImageCompressionUploader } from "@/components/ImageCompressionUploader";
```

Add tabs (example):
```tsx
<Tabs defaultValue="dashboard" className="w-full">
  <TabsList>
    <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
    <TabsTrigger value="analytics">AI Analytics</TabsTrigger>
    <TabsTrigger value="approvals">Content Approval</TabsTrigger>
    <TabsTrigger value="images">Image Uploads</TabsTrigger>
  </TabsList>

  <TabsContent value="analytics">
    <AITokenAnalyticsDashboard />
  </TabsContent>

  <TabsContent value="approvals">
    <AIContentApprovalPanel />
  </TabsContent>

  <TabsContent value="images">
    <ImageCompressionUploader />
  </TabsContent>
</Tabs>
```

### Step 2: Add Feedback to AI Tutor
**File:** `src/pages/AITutor.tsx`

Add feedback button after each AI response:
```tsx
import { AIResponseFeedback } from "@/components/AIResponseFeedback";
import { useState } from "react";

// In component:
const [feedbackOpen, setFeedbackOpen] = useState(false);
const [selectedResponseId, setSelectedResponseId] = useState("");

// After displaying AI response:
<Button 
  size="sm" 
  variant="ghost"
  onClick={() => {
    setSelectedResponseId(responseId); // from ai_usage_logs
    setFeedbackOpen(true);
  }}
>
  <MessageSquare className="h-4 w-4" /> Feedback
</Button>

<AIResponseFeedback
  aiResponseId={selectedResponseId}
  taskType="tutor"
  confidenceScore={confidence} // from AI response
  open={feedbackOpen}
  onOpenChange={setFeedbackOpen}
/>
```

### Step 3: Update AI Router Calls
Update all places calling AI functions to use the new router:

```tsx
// Old way (still works):
const resp = await fetch(`${VITE_SUPABASE_URL}/functions/v1/student-tutor-chat`, {
  headers: { Authorization: `Bearer ${token}` },
});

// New way (with token tracking):
const resp = await fetch(`${VITE_SUPABASE_URL}/functions/v1/ai-router-enhanced`, {
  headers: {
    Authorization: `Bearer ${token}`,
    "user_id": user.id, // Pass user ID for tracking
  },
  body: JSON.stringify({
    task: "tutor",
    messages: [...],
  }),
});

const data = await resp.json();
console.log("Confidence:", data._router.confidence_score);
console.log("Tokens:", data._router.tokens);
```

---

## 5. RUNNING THE APPLICATION

### Step 1: Install Dependencies (if needed)
```bash
cd peda-flex-core
bun install
# or
npm install
```

### Step 2: Start Development Server
```bash
bun run dev
# or
npm run dev
```

### Step 3: Deploy Edge Functions
```bash
# Navigate to supabase folder
cd supabase

# Deploy all new functions
supabase functions deploy ai-router-enhanced
supabase functions deploy ai-analytics-aggregator
supabase functions deploy image-compression-service
supabase functions deploy ai-approval-workflow
supabase functions deploy ai-feedback-learning-loop
```

### Step 4: Execute SQL Migration
1. Open Supabase Console
2. Go to SQL Editor
3. Paste entire content of `supabase/migrations/20260516_ai_token_usage_tracking.sql`
4. Execute

---

## 6. API USAGE EXAMPLES

### Get Analytics
```bash
curl -X POST https://[PROJECT].supabase.co/functions/v1/ai-analytics-aggregator \
  -H "Authorization: Bearer [TOKEN]" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_analytics", "days": 30}'
```

### Submit Feedback
```bash
curl -X POST https://[PROJECT].supabase.co/functions/v1/ai-feedback-learning-loop \
  -H "Authorization: Bearer [TOKEN]" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "submit_feedback",
    "ai_usage_log_id": "uuid",
    "task_type": "tutor",
    "confidence_score": 0.85,
    "is_accurate": true,
    "teacher_feedback": "Good response",
    "value_rating": 5
  }'
```

### Get Approval Queue
```bash
curl -X POST https://[PROJECT].supabase.co/functions/v1/ai-approval-workflow \
  -H "Authorization: Bearer [TOKEN]" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_pending_approvals", "limit": 20}'
```

---

## 7. KEY FEATURES IMPLEMENTED

### ✅ AI Token Usage Analytics
- Track every AI API call
- Calculate costs per model
- Daily aggregated reports
- Dashboard visualization
- Error rate monitoring

### ✅ AI Response Confidence Scoring
- Automatic confidence calculation
- Based on finish_reason and token usage
- Range: 0.3-1.0 (30%-100%)
- Passed in API responses

### ✅ AI Content Approval Workflow
- Submit content for review
- Admin approval/rejection interface
- Quality issue tracking
- Approval statistics
- Limited to: lesson_plan, mcq, suggestion, feedback

### ✅ AI Feedback Learning Loop
- Capture accuracy ratings
- Value scoring (1-5)
- Correction submission
- Feedback analytics
- Identifies improvement opportunities

### ✅ Image Compression Pipeline
- Quality slider (40-100%)
- Automatic compression on upload
- File size tracking
- Compression statistics
- Storage path management

---

## 8. TROUBLESHOOTING

### Issue: Edge Functions not deploying
```bash
# Check status
supabase status

# Verify environment variables
supabase secrets list

# Redeploy
supabase functions deploy [function-name] --force
```

### Issue: Token tracking not working
- Verify `user_id` is passed in request headers
- Check `ai_usage_logs` table has entries
- Verify model costs are in `ai_model_costs`

### Issue: Images not compressing
- Check file mime type is valid
- Verify quality parameter (40-100)
- Check Supabase storage bucket permissions

---

## 9. NEXT STEPS

1. ✅ Execute SQL migration
2. ✅ Deploy all Edge Functions
3. ✅ Add components to UI
4. ✅ Test token tracking with AI calls
5. ✅ Train on feedback loop
6. ✅ Monitor analytics dashboard
7. Consider: Real image compression library (sharp, compressorjs)
8. Consider: Cloudflare integration for CDN

---

## 10. FILE LOCATIONS SUMMARY

| Component | Location |
|-----------|----------|
| Database Migration | `supabase/migrations/20260516_ai_token_usage_tracking.sql` |
| AI Router Enhanced | `supabase/functions/ai-router-enhanced/index.ts` |
| Analytics Aggregator | `supabase/functions/ai-analytics-aggregator/index.ts` |
| Image Compression | `supabase/functions/image-compression-service/index.ts` |
| Approval Workflow | `supabase/functions/ai-approval-workflow/index.ts` |
| Feedback Loop | `supabase/functions/ai-feedback-learning-loop/index.ts` |
| Analytics UI | `src/components/AITokenAnalyticsDashboard.tsx` |
| Approval UI | `src/components/AIContentApprovalPanel.tsx` |
| Feedback UI | `src/components/AIResponseFeedback.tsx` |
| Image Upload UI | `src/components/ImageCompressionUploader.tsx` |

---

**Last Updated:** May 16, 2026
**Status:** Ready for Implementation
