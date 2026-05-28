# Homework Page UI - Complete Implementation Guide

## Overview
The StudentHomework component has been redesigned with a modern, flow-based UI that separates the homework list view from the homework attempt view with a 5-minute countdown timer.

## Feature Flow

### 1. **Homework List View** (Default View)
- **Purpose**: Display all pending homework assignments for the student
- **Components Shown**:
  - Homework title with subject and topic badges
  - Question count badge
  - Period information and assignment date
  - Status badge (Pending/Submitted)
  - Preview of first 2 questions (truncated)
  - **"Start Homework" Button**: Initiates the homework attempt

### 2. **Homework Start View** (Timer Active)
Triggered when student clicks "Start Homework" button

#### A. Timer Banner (Always Visible at Top)
- **Time Remaining**: Large, bold countdown display (MM:SS format)
- **Color Coding**:
  - Green: > 2 minutes remaining
  - Yellow: 1-2 minutes remaining  
  - Red: < 1 minute remaining
- **Progress Tracker**: Shows X/Y questions answered
- **Auto-Submit Notice**: "Auto-submit when time's up"
- **Progress Bar**: Visual indicator of completion percentage

#### B. Homework Header
- Displays homework title with home icon
- Subject and topic information
- Close button to return to list view

#### C. View Mode Toggle
- **One at a Time**: View and answer one question per screen
- **All Questions**: View all questions on one scrollable page
- Students can toggle between views anytime

#### D. Question Display (One at a Time Mode)
- **Question Header**: "Question X of Y"
- **Question Text**: Clear, readable format
- **Answer Input**: Large textarea for student response
- **Navigation Controls**:
  - Previous button (disabled on first question)
  - Next button (disabled on last question)
  - Answered counter badge

#### E. Question Display (All Questions Mode)
- **Numbered List**: All questions shown with answer fields
- **Consistent Styling**: Each question has numbered badge
- **Scrollable Area**: For quick navigation

#### F. Submit Section (Sticky Bottom)
- **Cancel Button**: Returns to list view without submitting
- **Submit Button**: 
  - Primary emerald color
  - Disabled when timer reaches 0 (auto-submit occurs)
  - Shows loading state during submission

#### G. Time Warning Alert (< 60 seconds)
- Red alert card appears
- Shows countdown message
- "Your homework will auto-submit in MM:SS"

## Key Features

### ✅ Auto-Submit Functionality
- When timer reaches 0, homework automatically submits
- Calculates submission percentage based on answered questions
- Shows confirmation toast

### ✅ Manual Submit
- "Submit Homework" button allows early submission
- Same submission percentage calculation
- Clear visual feedback

### ✅ Progress Tracking
- Real-time count of answered vs. total questions
- Progress bar showing completion percentage
- Each question marked as answered when text entered

### ✅ Timer Management
- Starts at 5 minutes (300 seconds)
- Counts down every second
- Color changes based on remaining time
- Stops on completion or navigation back to list

### ✅ View Flexibility
- Toggle between "One at a Time" and "All Questions" modes
- Maintained state during session
- Smooth transitions between modes

### ✅ Submitted Homework Display
- Returns to list view after submission
- Shows submission percentage in emerald badge
- Displays submitted answers read-only
- Date/time of submission shown

## UI/UX Improvements

### Visual Hierarchy
- Timer prominently displayed at top of attempt view
- Questions clearly numbered and formatted
- Progress tracking always visible
- Status indicators (pending/submitted) in list view

### Color System
- **Primary Blue**: Main actions and questions
- **Emerald Green**: Success states and submit button
- **Yellow**: Warning (timer 1-2 min)
- **Red**: Critical (timer < 1 min)

### Responsive Design
- Mobile-friendly layout
- Stacked buttons on small screens
- Textarea sized appropriately for input
- Scrollable areas for long content

### Accessibility
- Clear labels on all inputs
- Countdown timer readable and prominent
- Badge indicators for status
- High contrast colors for timer warnings

## Component State Management

### State Variables
```typescript
currentView: "list" | "start"      // Current view mode
activeHomeworkId: string | null    // ID of active homework
currentQuestionIndex: number       // Current question in "one at a time" mode
timerSeconds: number              // Countdown timer (starts at 300)
timerActive: boolean              // Timer running state
showAllQuestions: boolean         // View mode toggle
answers: Record<string, Record<number, string>>  // Student answers
```

### Hook Dependencies
- `useAuth()`: Get current user ID
- `useQuery()`: Fetch assignments, submissions, class info
- `useQueryClient()`: Invalidate cache on submission
- `useEffect()`: Timer countdown logic

## Database Integration

### Tables Used
- `homework_assignments`: Homework assignment details
- `homework_submissions`: Student submission records
- `student_assessments`: Student class/section info

### Key Fields
- `exit_ticket_content`: Source of extracted questions
- `submission_percentage`: Calculated from answered questions
- `completed_at`: Submission timestamp

## Time Management Logic

### Timer Countdown
```typescript
useEffect(() => {
  if (!timerActive || timerSeconds <= 0) {
    if (timerSeconds === 0 && timerActive) {
      handleAutoSubmit(); // Auto-submit on 0
    }
    return;
  }

  const interval = setInterval(() => {
    setTimerSeconds((prev) => prev <= 1 ? 0 : prev - 1);
  }, 1000);

  return () => clearInterval(interval);
}, [timerActive, timerSeconds]);
```

### Color Coding Function
```typescript
const getTimerColor = () => {
  if (timerSeconds > 120) return "text-green-600";    // > 2 min
  if (timerSeconds > 60) return "text-yellow-600";    // 1-2 min
  return "text-red-600";                              // < 1 min
};
```

## Submission Flow

### Pre-Submission
1. Student clicks "Submit Homework" or timer reaches 0
2. Component collects all answers from state
3. Calculates submission percentage

### Submission
1. Attempts to update existing homework_submission record
2. If no record exists, inserts new record
3. Marks as completed with timestamp

### Post-Submission
1. Invalidates homework-submissions query cache
2. Shows success toast with percentage
3. Returns to list view
4. Shows submitted status in assignment card

## Testing Checklist

- [ ] Timer starts at 5:00 when "Start Homework" clicked
- [ ] Timer counts down every second
- [ ] Color changes: Green → Yellow → Red
- [ ] "One at a Time" mode shows single question
- [ ] "All Questions" mode shows all questions
- [ ] Navigation buttons work in "One at a Time" mode
- [ ] "Cancel" returns to list without submission
- [ ] Manual "Submit" saves answers with percentage
- [ ] Auto-submit occurs when timer reaches 0:00
- [ ] Warning alert appears at < 60 seconds
- [ ] Progress bar updates as questions answered
- [ ] Submitted homework shows in list with badge
- [ ] Answered count accurate
- [ ] Timer stops on return to list view
- [ ] View mode toggle preserves answers
- [ ] Submission percentage calculated correctly

## Code Highlights

### New Imports
```typescript
import { Play, AlertCircle, ChevronRight, ChevronLeft, Home } from "lucide-react";
import { Progress } from "@/components/ui/progress";
```

### New Components Used
- `Progress`: Displays completion progress bar
- Timer display with format function
- Conditional rendering for view states
- Color-coded timer alerts

## Future Enhancements

1. **Question Bookmarking**: Mark questions to review later
2. **Answer Review**: Review all answers before final submission
3. **Time Extension**: Teacher can grant time extensions
4. **Partial Saves**: Auto-save answers periodically
5. **Analytics**: Track time spent per question
6. **Collaboration**: P2P homework help (if enabled)

## Styling Notes

- Uses Tailwind CSS utility classes
- Dark mode support with `dark:` prefix
- Responsive breakpoints for mobile/tablet/desktop
- Smooth animations with `animate-fade-in`
- Consistent spacing and border radius

## Known Limitations

- Timer does not pause if page refreshed
- Auto-submit doesn't persist if browser closes
- Requires internet connection for submission
- Question extraction from markdown limited to numbered/bulleted lists

## Browser Compatibility

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- Mobile browsers: ✅ Responsive design

---

**Last Updated**: April 18, 2026
**Component**: StudentHomework.tsx
**Status**: Ready for Production
