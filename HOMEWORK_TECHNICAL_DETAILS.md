# Technical Implementation - Homework UI Component

## File Location
`src/components/StudentHomework.tsx`

## Architecture Overview

```
StudentHomework Component
├── List View State (currentView === "list")
│   ├── Homework Cards
│   │   ├── Header (Title, Subject, Topic, Status)
│   │   ├── Preview (First 2 questions truncated)
│   │   └── Action Button ("Start Homework")
│   │
│   └── Submitted View
│       ├── Status Badge (Green, Submitted ✓)
│       ├── Submission % Display
│       └── Read-Only Answers
│
└── Start View (currentView === "start")
    ├── Timer Banner (Always Visible)
    │   ├── Countdown (MM:SS, color-coded)
    │   ├── Progress Counter (X/Y)
    │   └── Progress Bar
    │
    ├── Homework Header
    ├── View Mode Toggle (One at a Time | All Questions)
    │
    ├── Questions Display
    │   ├── One at a Time Mode
    │   │   ├── Question Header
    │   │   ├── Textarea Input
    │   │   └── Navigation (Prev/Next)
    │   │
    │   └── All Questions Mode
    │       ├── Numbered List
    │       ├── All Textareas
    │       └── Scrollable Container
    │
    ├── Sticky Submit Section
    │   ├── Cancel Button
    │   └── Submit Button (State-dependent)
    │
    └── Time Warning Alert (< 60 seconds)
```

## State Management

### Primary States
```typescript
type HomeworkView = "list" | "start"

const [currentView, setCurrentView] = useState<HomeworkView>("list")
const [activeHomeworkId, setActiveHomeworkId] = useState<string | null>(null)
const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
const [timerSeconds, setTimerSeconds] = useState(5 * 60)
const [timerActive, setTimerActive] = useState(false)
const [showAllQuestions, setShowAllQuestions] = useState(false)
const [answers, setAnswers] = useState<Record<string, Record<number, string>>>({})
const [submitting, setSubmitting] = useState<string | null>(null)
```

### State Relationships
```
START HOMEWORK (Button Click)
  ↓
activeHomeworkId = assignmentId
currentView = "start"
currentQuestionIndex = 0
timerSeconds = 300 (5 min)
timerActive = true
  ↓
TIMER COUNTDOWN (useEffect)
  ↓
timerSeconds -= 1 every 1000ms
  ↓
timerSeconds === 0 ?
  → timerActive = false
  → handleAutoSubmit()
  → currentView = "list"
```

## Timer Implementation

### Core Timer Hook
```typescript
useEffect(() => {
  if (!timerActive || timerSeconds <= 0) {
    if (timerSeconds === 0 && timerActive) {
      handleAutoSubmit();
    }
    return;
  }

  const interval = setInterval(() => {
    setTimerSeconds((prev) => {
      if (prev <= 1) {
        setTimerActive(false);
        return 0;
      }
      return prev - 1;
    });
  }, 1000);

  return () => clearInterval(interval);
}, [timerActive, timerSeconds]);
```

### Format Time Function
```typescript
const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
}
// Example: 245 seconds → "04:05"
// Example: 59 seconds → "00:59"
```

### Color Coding Logic
```typescript
const getTimerColor = () => {
  if (timerSeconds > 120) return "text-green-600 dark:text-green-400"
  if (timerSeconds > 60) return "text-yellow-600 dark:text-yellow-400"
  return "text-red-600 dark:text-red-400"
}
```

## Data Flow

### Question Extraction
```
assignment.exit_ticket_content (Markdown)
  ↓
extractQuestionsFromExitTicket()
  ↓
Questions Array:
[
  { question: "Q1 text", index: 0 },
  { question: "Q2 text", index: 1 },
  ...
]
```

### Answer Management
```typescript
// Storage structure
answers = {
  "assignment-id-1": {
    0: "Student's answer to Q1",
    1: "Student's answer to Q2",
    ...
  },
  "assignment-id-2": {
    0: "...",
    ...
  }
}

// Update function
const handleAnswerChange = (assignmentId, qIndex, value) => {
  setAnswers(prev => ({
    ...prev,
    [assignmentId]: {
      ...(prev[assignmentId] || {}),
      [qIndex]: value
    }
  }))
}
```

### Submission Flow
```
handleSubmit()
  ↓
questionsArray.length > 0 ?
  ↓
answeredQuestions = questions with non-empty answers
submissionPercentage = (answeredQuestions / totalQuestions) * 100
  ↓
Create answerArray: [
  { question: "Q1", answer: "Student answer" },
  ...
]
  ↓
TRY: UPDATE homework_submissions
CATCH: INSERT new homework_submissions
  ↓
Invalidate Query Cache
Show Success Toast
Return to List View
```

## Progress Calculation

```typescript
const answeredCount = questionsArray.filter(
  (_, i) => answers[activeHomeworkId]?.[i]?.trim()
).length

const progressPercent = (currentQuestionIndex / questionsArray.length) * 100

const submissionPercentage = 
  (answeredQuestions / totalQuestions) * 100
```

## Database Schema Integration

### homework_assignments Table
```sql
id: UUID
period_title: string
subject: string
topic: string
exit_ticket_content: TEXT (Markdown with questions)
assignment_type: "at-home" | "in-class"
class_level: string
section: string
created_at: timestamp
```

### homework_submissions Table
```sql
id: UUID
assignment_id: UUID (FK)
student_id: UUID (FK)
answers: JSONB [
  { question: string, answer: string },
  ...
]
submission_percentage: number (0-100)
completed: boolean
completed_at: timestamp
```

## Query Hooks

### Fetch Student Info
```typescript
useQuery({
  queryKey: ["student-class-info", user?.id],
  queryFn: async () => {
    // Get class_level and section from student_assessments
  }
})
```

### Fetch Assignments
```typescript
useQuery({
  queryKey: ["student-homework", user?.id, studentClassInfo],
  queryFn: async () => {
    // Fetch from homework_assignments
    // Filter by: class_level, section, assignment_type="at-home"
  }
})
```

### Fetch Submissions
```typescript
useQuery({
  queryKey: ["homework-submissions", user?.id],
  queryFn: async () => {
    // Fetch from homework_submissions by student_id
  }
})
```

## Conditional Rendering Logic

### Loading State
```typescript
if (isLoading) return <LoadingSpinner />
```

### Empty State
```typescript
if (!assignments?.length) return (
  <Card with EmptyState message />
)
```

### View Selection
```typescript
if (currentView === "list") {
  return <HomeworkListView />
}
// Else (currentView === "start")
return <HomeworkStartView />
```

## Component Props & Interfaces

```typescript
interface HomeworkQuestion {
  question: string
  index: number
}

// No props needed - uses hooks for all data
const StudentHomework = () => { ... }
```

## Styling Architecture

### Tailwind Classes Used
```
Layout:
- space-y-4: Vertical spacing
- flex gap-2: Horizontal layouts
- grid: Card layouts

Colors:
- bg-primary/10: Light primary background
- text-emerald-600: Success text
- border-red-200: Warning borders

States:
- disabled: Button disabled styling
- hover:bg-accent/50: Interactive elements
- dark: Dark mode variants

Sizing:
- w-4 h-4: Small icons
- text-sm: Small text
- text-4xl: Large timer display
```

### Dark Mode Support
```tsx
className="bg-blue-50 dark:bg-blue-900/20"
className="text-yellow-700 dark:text-yellow-200"
className="border-red-200 dark:border-red-800"
```

## Error Handling

### Try-Catch for Submission
```typescript
try {
  // Try UPDATE on existing record
  const { error } = await supabase
    .from("homework_submissions")
    .update({ ... })
    .eq("assignment_id", assignmentId)
    .eq("student_id", user!.id)
  
  if (error) throw error
} catch (e) {
  // Fallback: Try INSERT new record
  try {
    await supabase
      .from("homework_submissions")
      .insert({ ... })
  } catch (fallbackError) {
    toast.error(fallbackError.message)
  }
}
```

## Performance Optimizations

### Query Caching
```typescript
// Automatically cached by React Query
queryClient.invalidateQueries({ 
  queryKey: ["homework-submissions"] 
})
// Forces fresh data after submission
```

### Effect Dependencies
```typescript
useEffect(() => {
  // Cleanup on unmount
  return () => clearInterval(interval)
}, [timerActive, timerSeconds])
// Only reruns when these specific values change
```

### Conditional Queries
```typescript
enabled: !!user?.id && !!studentClassInfo?.student_class
// Prevents API calls when dependencies missing
```

## Testing Strategies

### Unit Tests
- Timer countdown logic
- Format time function
- Color coding function
- Answer update logic
- Progress calculation

### Integration Tests
- Load assignments
- Start homework
- Timer lifecycle
- Answer submission
- Return to list view

### E2E Tests
- Complete homework flow
- View mode switching
- Auto-submit trigger
- Manual submit
- Submitted display

## Browser DevTools Debugging

### In Console
```javascript
// Check component state
document.querySelector('[data-homework-timer]')?.textContent

// Monitor timer
setInterval(() => {
  console.log('Timer:', document.querySelector('[data-timer]')?.textContent)
}, 1000)
```

### React DevTools
1. Open React DevTools tab
2. Find StudentHomework component
3. Watch state changes:
   - timerSeconds
   - currentView
   - answers
   - submitting

## Accessibility Features

- Semantic HTML with proper heading hierarchy
- ARIA labels on buttons
- Color coding + text labels (not color alone)
- Keyboard navigation support
- Sufficient contrast ratios
- Focus management

## Browser Support

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome | ✅ Full | No issues |
| Firefox | ✅ Full | No issues |
| Safari | ✅ Full | No issues |
| Edge | ✅ Full | Chromium-based |
| Mobile Safari | ✅ Full | Responsive design |
| Chrome Mobile | ✅ Full | Touch-friendly |

## Known Limitations & Future Work

### Current Limitations
1. Timer restarts if page refreshed
2. No offline support
3. Questions must be markdown numbered/bulleted lists
4. No question skipping allowed in "One at a Time" mode
5. No save drafts feature

### Planned Enhancements
1. Auto-save drafts every 30 seconds
2. Question bookmarking
3. Review screen before final submit
4. Time extension requests
5. Per-question time tracking
6. Offline mode with sync

---

## Dependencies

```json
{
  "@tanstack/react-query": "^latest",
  "lucide-react": "^latest",
  "sonner": "^latest",
  "tailwindcss": "^latest"
}
```

## Related Files
- `src/integrations/supabase/client.ts` - Supabase client
- `src/contexts/AuthContext.tsx` - Authentication context
- `src/hooks/use-toast.ts` - Toast notifications
- `src/components/ui/*` - UI component library

---

**Last Updated**: April 18, 2026
**Version**: 1.0 (Production)
**Status**: Stable & Ready for Use
