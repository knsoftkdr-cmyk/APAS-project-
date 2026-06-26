export interface AssessmentQuestion {
  id: number;
  text: string;
  modality?: string;
}

export interface Dimension {
  name: string;
  description: string;
  questions: AssessmentQuestion[];
}

export interface AgeGroupConfig {
  ageGroup: number;
  label: string;
  model: string;
  respondent: string;
  totalQuestions: number;
  options: { label: string; emoji: string; value: number }[];
  dimensions: Dimension[];
  questions: AssessmentQuestion[];
}

// --- Group A --- Nursery (Age 3-5) | 100 items | Parent/Teacher Observation ---

const GROUP_A: AgeGroupConfig = {
  ageGroup: 3,
  label: "Nursery (Age 3-5)",
  model: "Developmental Milestones | Early MI (Gardner) | Erikson Stage 2 | WHO Motor Standards | VARK Precursor",
  respondent: "Parent / Teacher (Observation)",
  totalQuestions: 100,
  options: [
    { label: "Always", emoji: "😊", value: 4 },
    { label: "Sometimes", emoji: "🙂", value: 3 },
    { label: "Rarely", emoji: "😐", value: 2 },
    { label: "Never", emoji: "😶", value: 1 },
    { label: "Not yet observed", emoji: "🤷", value: 0 },
  ],
  dimensions: [
    {
      name: "Social & Emotional Development",
      description: "Erikson Stage 2 — Autonomy vs Shame | Bowlby Attachment",
      questions: [
        { id: 1, text: "Makes consistent eye contact with familiar adults and peers" },
        { id: 2, text: "Smiles and laughs in response to playful interaction" },
        { id: 3, text: "Expresses happiness, sadness, anger and fear using words or gestures" },
        { id: 4, text: "Seeks comfort from a trusted adult when upset, hurt or frightened" },
        { id: 5, text: "Calms down within a few minutes when soothed by a caregiver" },
        { id: 6, text: "Shows awareness of another child's distress and tries to help" },
        { id: 7, text: "Plays alongside other children without conflict or aggression" },
        { id: 8, text: "Shares a toy or material when gently prompted by an adult" },
        { id: 9, text: "Shows pride in completing a task independently" },
        { id: 10, text: "Demonstrates growing independence, trying things without always asking for help" },
      ],
    },
    {
      name: "Language & Communication",
      description: "Vygotsky ZPD — Language Scaffolding | ASHA Milestones",
      questions: [
        { id: 11, text: "Uses sentences of at least 2-3 words to express needs or ideas" },
        { id: 12, text: "Names at least 10 familiar objects when shown pictures" },
        { id: 13, text: "Points to objects in pictures when named by an adult" },
        { id: 14, text: "Follows two-step instructions without gestural prompts" },
        { id: 15, text: "Asks simple questions using 'what', 'where' or 'who'" },
        { id: 16, text: "Repeats new words after hearing them once or twice" },
        { id: 17, text: "Retells a simple story with 2-3 key events in sequence" },
        { id: 18, text: "Recognises and responds to their own printed name" },
        { id: 19, text: "Uses pronouns correctly — I, me, you, he, she — at least some of the time" },
        { id: 20, text: "Speaks clearly enough for familiar adults to understand most of the time" },
      ],
    },
    {
      name: "Cognitive Development & Early Numeracy",
      description: "Piaget Preoperational Stage | Early Numeracy Frameworks",
      questions: [
        { id: 21, text: "Shows curiosity — explores, touches and investigates new objects" },
        { id: 22, text: "Sorts objects by colour when shown how" },
        { id: 23, text: "Sorts objects by shape when shown how" },
        { id: 24, text: "Counts up to 10 objects correctly with one-to-one correspondence" },
        { id: 25, text: "Identifies at least 8 basic colours by name" },
        { id: 26, text: "Completes a simple 4-6 piece puzzle independently" },
        { id: 27, text: "Recognises common animals and names them correctly" },
        { id: 28, text: "Matches identical shapes or pictures in a simple matching game" },
        { id: 29, text: "Recognises their own written name and a few familiar letters" },
        { id: 30, text: "Engages in imaginative or pretend play for at least 5 minutes" },
      ],
    },
    {
      name: "Physical & Motor Development",
      description: "WHO Motor Development Standards | Gesell Developmental Sequences",
      questions: [
        { id: 31, text: "Walks and runs with confidence, balance and coordination" },
        { id: 32, text: "Climbs steps using alternate feet with minimal support" },
        { id: 33, text: "Kicks a ball with aim and reasonable control" },
        { id: 34, text: "Throws a ball overhand toward a target" },
        { id: 35, text: "Catches a large ball with both arms when thrown gently" },
        { id: 36, text: "Holds a crayon or pencil with a finger grip rather than a fist grip" },
        { id: 37, text: "Draws a recognisable circle or cross on paper" },
        { id: 38, text: "Stacks at least 6 small blocks without toppling" },
        { id: 39, text: "Attempts to dress independently — manages buttons or a zip with effort" },
        { id: 40, text: "Uses child scissors to cut along a straight line" },
      ],
    },
    {
      name: "Emerging Modality Signals — Visual",
      description: "VARK Precursor Indicators (Observation-Based)",
      questions: [
        { id: 41, text: "Watches pictures, faces or objects intently before reacting", modality: "Visual" },
        { id: 42, text: "Recognises a familiar object or person from a picture alone", modality: "Visual" },
        { id: 43, text: "Is drawn to colourful books, pictures or visual displays", modality: "Visual" },
        { id: 44, text: "Calms or settles when shown a picture, photo or familiar visual object", modality: "Visual" },
        { id: 45, text: "Notices when something in a familiar picture or room changes", modality: "Visual" },
      ],
    },
    {
      name: "Emerging Modality Signals — Auditory",
      description: "VARK Precursor Indicators (Observation-Based)",
      questions: [
        { id: 46, text: "Turns toward and responds to a familiar voice or sound", modality: "Auditory" },
        { id: 47, text: "Calms or engages when sung to or spoken to in a soothing tone", modality: "Auditory" },
        { id: 48, text: "Repeats sounds, songs or rhymes after hearing them", modality: "Auditory" },
        { id: 49, text: "Reacts differently to different tones of voice (happy, firm, soothing)", modality: "Auditory" },
        { id: 50, text: "Enjoys being read to even before understanding every word", modality: "Auditory" },
      ],
    },
    {
      name: "Emerging Modality Signals — Kinaesthetic",
      description: "VARK Precursor Indicators (Observation-Based)",
      questions: [
        { id: 51, text: "Learns a new action (clapping, waving) faster by doing it with help than by being told", modality: "Kinaesthetic" },
        { id: 52, text: "Prefers touching, holding or manipulating an object to just looking at it", modality: "Kinaesthetic" },
        { id: 53, text: "Settles or focuses better when allowed to move, rock or fidget gently", modality: "Kinaesthetic" },
        { id: 54, text: "Imitates a physical action (a dance step, a gesture) after seeing it once", modality: "Kinaesthetic" },
        { id: 55, text: "Explores new toys mainly by handling and moving them rather than observing", modality: "Kinaesthetic" },
      ],
    },
    {
      name: "Emerging Modality Signals — Print/Symbol",
      description: "VARK Precursor Indicators (Observation-Based)",
      questions: [
        { id: 56, text: "Shows interest in books, even if just turning pages or pointing at print", modality: "Read-Write" },
        { id: 57, text: "Recognises a logo, sign or symbol (such as a favourite shop or show) by sight", modality: "Read-Write" },
        { id: 58, text: "Tries to 'write' or scribble in imitation of adults writing", modality: "Read-Write" },
        { id: 59, text: "Points to or asks about letters or numbers seen around the house", modality: "Read-Write" },
        { id: 60, text: "Pays attention longer to a book with both pictures and print than to a picture alone", modality: "Read-Write" },
      ],
    },
    {
      name: "Early Multiple Intelligences — Linguistic & Logical",
      description: "Gardner MI Theory (Early Indicators)",
      questions: [
        { id: 61, text: "Enjoys being read to and studies illustrations carefully" },
        { id: 62, text: "Spontaneously narrates play or uses descriptive language" },
        { id: 63, text: "Repeats and plays with new words for the fun of their sound" },
        { id: 64, text: "Asks 'why' or 'what's that' questions frequently" },
        { id: 65, text: "Enjoys simple rhymes, songs or finger-plays with words" },
        { id: 66, text: "Asks repeated questions about how things work" },
        { id: 67, text: "Notices and points out patterns (stripes, repeated shapes)" },
        { id: 68, text: "Tries to count objects even if not always accurately" },
        { id: 69, text: "Enjoys cause-and-effect toys (pressing a button to get a result)" },
        { id: 70, text: "Sorts or lines up objects by size or type without being asked" },
      ],
    },
    {
      name: "Early Multiple Intelligences — Spatial, Musical, Bodily & Social",
      description: "Gardner MI Theory (Early Indicators)",
      questions: [
        { id: 71, text: "Engages deeply and independently in drawing, colouring or clay" },
        { id: 72, text: "Gravitates to building, stacking and arranging objects" },
        { id: 73, text: "Completes simple shape puzzles or shape-sorters with ease" },
        { id: 74, text: "Shows strong interest in music, humming or responding to songs" },
        { id: 75, text: "Claps, sways or bounces in rhythm to music" },
        { id: 76, text: "Demonstrates a strong preference for movement-based play" },
        { id: 77, text: "Learns new physical actions (jumping, climbing) quickly" },
        { id: 78, text: "Seeks out other children and initiates simple games" },
        { id: 79, text: "Has a preferred activity they return to independently" },
        { id: 80, text: "Notices and comments on insects, plants or animals" },
      ],
    },
    {
      name: "Early Multiple Intelligences — Intrapersonal & Naturalist",
      description: "Gardner MI Theory (Early Indicators)",
      questions: [
        { id: 81, text: "Shows clear preferences (favourite toy, food, activity)" },
        { id: 82, text: "Resists interruption when deeply engaged in an activity" },
        { id: 83, text: "Expresses frustration or anger clearly when something is wrong" },
        { id: 84, text: "Shows growing awareness of 'I can do this myself'" },
        { id: 85, text: "Shows early signs of empathy, such as comforting a crying child" },
        { id: 86, text: "Imitates the actions or expressions of familiar adults" },
        { id: 87, text: "Enjoys being part of group activities such as circle time" },
        { id: 88, text: "Is drawn to outdoor spaces, water or natural materials" },
        { id: 89, text: "Shows curiosity about weather, clouds or the outdoors" },
        { id: 90, text: "Notices the difference between living and non-living things" },
      ],
    },
    {
      name: "Additional Developmental Observations",
      description: "Gardner MI Theory — Interpersonal & Extended Indicators",
      questions: [
        { id: 91, text: "Reaches out for or responds warmly to family members" },
        { id: 92, text: "Uses gestures and body movement to communicate before words" },
        { id: 93, text: "Shows good control when handling small objects with hands" },
        { id: 94, text: "Enjoys music or singing as a way to settle or calm down" },
        { id: 95, text: "Tries to copy a tune or rhythm after hearing it" },
        { id: 96, text: "Enjoys looking at picture books with detailed illustrations" },
        { id: 97, text: "Notices the layout of a room or where things belong" },
        { id: 98, text: "Enjoys caring for or interacting with a pet or plant" },
        { id: 99, text: "Enjoys gardening, growing plants or caring for animals" },
        { id: 100, text: "Feels calm and happy when in natural settings" },
      ],
    },
  ],
  get questions() {
    return this.dimensions.flatMap((d) => d.questions);
  },
};

// --- Group B --- Primary (Age 6-8 / Grades 1-3) | 100 items | Self-Report ---

const GROUP_B: AgeGroupConfig = {
  ageGroup: 6,
  label: "Primary (Age 6-8)",
  model: "VARK (Fleming) | Multiple Intelligences (Gardner) | Self-Regulation | School Readiness",
  respondent: "Self (read aloud if needed)",
  totalQuestions: 100,
  options: [
    { label: "Always", emoji: "😊", value: 4 },
    { label: "Sometimes", emoji: "🙂", value: 3 },
    { label: "Not much", emoji: "😐", value: 2 },
    { label: "Never", emoji: "😶", value: 1 },
    { label: "Not sure", emoji: "🤷", value: 0 },
  ],
  dimensions: [
    {
      name: "VARK: Visual",
      description: "Fleming VARK Model — Visual Channel",
      questions: [
        { id: 1, text: "I remember things better when I see a picture or diagram", modality: "Visual" },
        { id: 2, text: "I understand a story better when I look at the pictures", modality: "Visual" },
        { id: 3, text: "I like it when my teacher draws or shows something on the board", modality: "Visual" },
        { id: 4, text: "I notice colours and shapes more than most people", modality: "Visual" },
        { id: 5, text: "I like books with lots of pictures", modality: "Visual" },
        { id: 6, text: "I remember a place better if I have seen a map or photo of it", modality: "Visual" },
        { id: 7, text: "I find it easier to learn something when I watch someone do it first", modality: "Visual" },
        { id: 8, text: "I like colouring in different colours to show different ideas", modality: "Visual" },
        { id: 9, text: "I remember a person's face better than their name", modality: "Visual" },
        { id: 10, text: "I like looking at charts, posters or picture timetables", modality: "Visual" },
        { id: 11, text: "I notice when something in the classroom display has changed", modality: "Visual" },
        { id: 12, text: "I prefer watching a video to just listening to someone talk", modality: "Visual" },
      ],
    },
    {
      name: "VARK: Auditory",
      description: "Fleming VARK Model — Auditory Channel",
      questions: [
        { id: 13, text: "I remember something better when someone explains it out loud", modality: "Auditory" },
        { id: 14, text: "I enjoy listening to instructions being read to me", modality: "Auditory" },
        { id: 15, text: "I like it when my teacher reads stories aloud", modality: "Auditory" },
        { id: 16, text: "I remember songs and rhymes easily after hearing them", modality: "Auditory" },
        { id: 17, text: "I like talking out loud to myself when I am thinking", modality: "Auditory" },
        { id: 18, text: "I understand a lesson better when there is discussion", modality: "Auditory" },
        { id: 19, text: "I notice small differences in how people say things", modality: "Auditory" },
        { id: 20, text: "I like listening to music while I do quiet activities", modality: "Auditory" },
        { id: 21, text: "I remember a phone number or list better if I say it out loud", modality: "Auditory" },
        { id: 22, text: "I prefer being told what to do rather than reading it myself", modality: "Auditory" },
        { id: 23, text: "I enjoy listening to audiobooks or podcasts for children", modality: "Auditory" },
        { id: 24, text: "I find it easier to learn a poem by saying it again and again", modality: "Auditory" },
      ],
    },
    {
      name: "VARK: Read/Write",
      description: "Fleming VARK Model — Read/Write Channel",
      questions: [
        { id: 25, text: "I like writing down or drawing what I want to remember", modality: "Read-Write" },
        { id: 26, text: "I understand a task better when I can read the instructions myself", modality: "Read-Write" },
        { id: 27, text: "I enjoy looking at words and trying to read them", modality: "Read-Write" },
        { id: 28, text: "I like making lists of things I need to do or remember", modality: "Read-Write" },
        { id: 29, text: "I prefer reading a story myself to having it read to me", modality: "Read-Write" },
        { id: 30, text: "I like copying down words or sentences from the board", modality: "Read-Write" },
        { id: 31, text: "I enjoy writing short stories, messages or labels", modality: "Read-Write" },
        { id: 32, text: "I notice when a word is spelled in an interesting way", modality: "Read-Write" },
        { id: 33, text: "I like using flashcards or word cards to learn new words", modality: "Read-Write" },
        { id: 34, text: "I remember something better after I have written it down", modality: "Read-Write" },
        { id: 35, text: "I enjoy looking through books to find information", modality: "Read-Write" },
        { id: 36, text: "I like filling in worksheets with written answers", modality: "Read-Write" },
      ],
    },
    {
      name: "VARK: Kinaesthetic",
      description: "Fleming VARK Model — Kinaesthetic Channel",
      questions: [
        { id: 37, text: "I learn best when I can touch, make or move something", modality: "Kinaesthetic" },
        { id: 38, text: "I find it easier to remember things I have actually done", modality: "Kinaesthetic" },
        { id: 39, text: "When I do not understand something, I ask someone to show me how", modality: "Kinaesthetic" },
        { id: 40, text: "I like using my hands to build, make or take things apart", modality: "Kinaesthetic" },
        { id: 41, text: "I find it hard to sit still for a very long time", modality: "Kinaesthetic" },
        { id: 42, text: "I learn a new movement or skill quickly by trying it myself", modality: "Kinaesthetic" },
        { id: 43, text: "I enjoy acting out a story instead of just listening to it", modality: "Kinaesthetic" },
        { id: 44, text: "I like using real objects (counters, blocks) to solve a problem", modality: "Kinaesthetic" },
        { id: 45, text: "I remember a dance step or action better than the words for it", modality: "Kinaesthetic" },
        { id: 46, text: "I enjoy science activities where I get to do the experiment", modality: "Kinaesthetic" },
        { id: 47, text: "I like field trips or hands-on activities more than sitting lessons", modality: "Kinaesthetic" },
        { id: 48, text: "I learn better when I can walk around or move while thinking", modality: "Kinaesthetic" },
      ],
    },
    {
      name: "VARK: Multimodal",
      description: "Fleming VARK Model — Multimodal",
      questions: [
        { id: 49, text: "I use different ways to learn depending on what I am doing", modality: "Multimodal" },
        { id: 50, text: "I use pictures, sounds, words and actions together to help me remember", modality: "Multimodal" },
      ],
    },
    {
      name: "Linguistic Intelligence",
      description: "Gardner MI — Linguistic-Verbal Domain",
      questions: [
        { id: 51, text: "I enjoy listening to or telling stories" },
        { id: 52, text: "I like learning new and unusual words" },
        { id: 53, text: "I enjoy writing sentences, short stories or messages" },
        { id: 54, text: "I remember jokes, riddles and rhymes easily" },
        { id: 55, text: "I can retell a story I have heard in the right order" },
      ],
    },
    {
      name: "Logical-Mathematical Intelligence",
      description: "Gardner MI — Logical-Mathematical Domain",
      questions: [
        { id: 56, text: "I enjoy counting and working with numbers" },
        { id: 57, text: "I like solving puzzles and brain teasers" },
        { id: 58, text: "I can spot patterns in colours, shapes or numbers" },
        { id: 59, text: "I enjoy figuring out how things work by myself" },
        { id: 60, text: "I like games that have rules, strategy and scoring" },
      ],
    },
    {
      name: "Spatial Intelligence",
      description: "Gardner MI — Visual-Spatial Domain",
      questions: [
        { id: 61, text: "I enjoy drawing and creating detailed pictures" },
        { id: 62, text: "I like building things with blocks, LEGO or construction sets" },
        { id: 63, text: "I notice small details in pictures that others might miss" },
        { id: 64, text: "I can picture what a finished drawing or model will look like before I start" },
        { id: 65, text: "I enjoy jigsaw puzzles and shape-matching games" },
      ],
    },
    {
      name: "Musical Intelligence",
      description: "Gardner MI — Musical-Rhythmic Domain",
      questions: [
        { id: 66, text: "I enjoy music lessons and singing in class or at home" },
        { id: 67, text: "I remember song lyrics and melodies after hearing them a few times" },
        { id: 68, text: "I like clapping, tapping or drumming along to a beat" },
        { id: 69, text: "I often hum or sing to myself while working or playing" },
        { id: 70, text: "I enjoy dancing or moving my body in time with music" },
      ],
    },
    {
      name: "Bodily-Kinaesthetic Intelligence",
      description: "Gardner MI — Bodily-Kinaesthetic Domain",
      questions: [
        { id: 71, text: "I enjoy outdoor games, running, jumping and sports" },
        { id: 72, text: "I like using my hands to make, build or take apart things" },
        { id: 73, text: "I pick up new movements and physical skills quickly" },
        { id: 74, text: "I enjoy acting, role play or drama activities" },
        { id: 75, text: "I enjoy physical challenges like climbing, balancing or gymnastics" },
      ],
    },
    {
      name: "Interpersonal Intelligence",
      description: "Gardner MI — Interpersonal Domain",
      questions: [
        { id: 76, text: "I enjoy working together with classmates on group activities" },
        { id: 77, text: "I like helping a friend who is stuck on something" },
        { id: 78, text: "I am good at knowing how someone is feeling without being told" },
        { id: 79, text: "I make friends easily when I meet someone new" },
        { id: 80, text: "I notice when a classmate is upset or left out" },
      ],
    },
    {
      name: "Intrapersonal Intelligence",
      description: "Gardner MI — Intrapersonal Domain",
      questions: [
        { id: 81, text: "I know what I am good at and what I find hard" },
        { id: 82, text: "I like having some quiet time by myself" },
        { id: 83, text: "I have a favourite activity I enjoy doing on my own" },
        { id: 84, text: "I keep trying even when something is difficult" },
        { id: 85, text: "I can tell when I am feeling worried, excited or bored" },
      ],
    },
    {
      name: "Naturalist Intelligence",
      description: "Gardner MI — Naturalist Domain",
      questions: [
        { id: 86, text: "I enjoy spending time outside in gardens, parks or nature" },
        { id: 87, text: "I like observing animals, insects and plants closely" },
        { id: 88, text: "I notice changes in weather such as clouds, wind or rain" },
        { id: 89, text: "I enjoy gardening, growing plants or caring for animals" },
        { id: 90, text: "I feel calm and happy when I am in natural settings" },
      ],
    },
    {
      name: "Self-Regulation & School Readiness",
      description: "Vygotsky Self-Regulation | School Readiness Framework | Dweck Growth Mindset",
      questions: [
        { id: 91, text: "I finish one task completely before I start a new one" },
        { id: 92, text: "I follow classroom rules even when it feels hard" },
        { id: 93, text: "I ask for help when I am stuck rather than giving up" },
        { id: 94, text: "I try again if I get something wrong the first time" },
        { id: 95, text: "I feel safe, comfortable and happy at school" },
        { id: 96, text: "I wait for my turn without getting frustrated" },
        { id: 97, text: "I keep my belongings organised and know where things are" },
        { id: 98, text: "I can work quietly without disturbing others" },
        { id: 99, text: "I remember instructions given at the start of a lesson" },
        { id: 100, text: "I believe I can get better at things if I keep practising" },
      ],
    },
  ],
  get questions() {
    return this.dimensions.flatMap((d) => d.questions);
  },
};

// --- Group C --- Upper Primary (Age 9-10 / Grades 4-5) | 100 items | Self-Report ---

const GROUP_C: AgeGroupConfig = {
  ageGroup: 9,
  label: "Upper Primary (Age 9-10)",
  model: "VARK (Fleming) | Multiple Intelligences (Gardner) | Study Skills (Zimmerman)",
  respondent: "Self (independent)",
  totalQuestions: 100,
  options: [
    { label: "Strongly Agree", emoji: "✅", value: 5 },
    { label: "Agree", emoji: "👍", value: 4 },
    { label: "Neutral", emoji: "😐", value: 3 },
    { label: "Disagree", emoji: "👎", value: 2 },
    { label: "Strongly Disagree", emoji: "❌", value: 1 },
    { label: "Not Sure", emoji: "🤷", value: 0 },
  ],
  dimensions: [
    {
      name: "VARK: Visual",
      description: "Fleming VARK Model — Visual Channel",
      questions: [
        { id: 1, text: "I understand things better when I see a picture, chart or diagram", modality: "Visual" },
        { id: 2, text: "I like teachers to show examples on the board rather than just explain them", modality: "Visual" },
        { id: 3, text: "I remember information better if I have seen it written or drawn out", modality: "Visual" },
        { id: 4, text: "I notice colours, shapes and visual details that other people often miss", modality: "Visual" },
        { id: 5, text: "I prefer reading a book with diagrams and illustrations to one with only text", modality: "Visual" },
        { id: 6, text: "I find it easier to follow a map or a set of pictures than spoken directions", modality: "Visual" },
        { id: 7, text: "I like making posters, charts or mind-maps to help me remember things", modality: "Visual" },
        { id: 8, text: "I picture an idea in my head to help me understand it better", modality: "Visual" },
        { id: 9, text: "I remember a process better after watching someone do it first", modality: "Visual" },
        { id: 10, text: "I enjoy watching videos or demonstrations more than listening to a talk", modality: "Visual" },
        { id: 11, text: "I notice when a chart, graph or poster does not look quite right", modality: "Visual" },
        { id: 12, text: "I like using different colours to organise my notes or work", modality: "Visual" },
      ],
    },
    {
      name: "VARK: Auditory",
      description: "Fleming VARK Model — Auditory Channel",
      questions: [
        { id: 13, text: "I understand a lesson better when the teacher explains it out loud", modality: "Auditory" },
        { id: 14, text: "I remember things better after talking about them with someone else", modality: "Auditory" },
        { id: 15, text: "I like listening to stories, podcasts or audiobooks", modality: "Auditory" },
        { id: 16, text: "I enjoy class discussions and talking through ideas with others", modality: "Auditory" },
        { id: 17, text: "I remember a song, rhyme or chant more easily than written words", modality: "Auditory" },
        { id: 18, text: "I often talk to myself quietly when I am working something out", modality: "Auditory" },
        { id: 19, text: "I prefer being told how to do something rather than reading instructions", modality: "Auditory" },
        { id: 20, text: "I notice when someone explains something in an interesting way", modality: "Auditory" },
        { id: 21, text: "I like reciting or repeating things out loud to remember them", modality: "Auditory" },
        { id: 22, text: "I find it easier to learn through discussion than through silent reading", modality: "Auditory" },
        { id: 23, text: "I enjoy debates or talking about both sides of an idea", modality: "Auditory" },
        { id: 24, text: "I sometimes find that music or background sound helps me concentrate", modality: "Auditory" },
      ],
    },
    {
      name: "VARK: Read/Write",
      description: "Fleming VARK Model — Read/Write Channel",
      questions: [
        { id: 25, text: "I learn well by reading books, worksheets or written instructions", modality: "Read-Write" },
        { id: 26, text: "I like writing down notes or lists to help me remember things", modality: "Read-Write" },
        { id: 27, text: "I enjoy reading on my own rather than being read to", modality: "Read-Write" },
        { id: 28, text: "I find it easier to understand something once I have written it down", modality: "Read-Write" },
        { id: 29, text: "I like looking things up in books or online to find more information", modality: "Read-Write" },
        { id: 30, text: "I notice when a word is spelled in an interesting or unusual way", modality: "Read-Write" },
        { id: 31, text: "I prefer written feedback on my work that I can read again later", modality: "Read-Write" },
        { id: 32, text: "I enjoy writing stories, reports or journal entries", modality: "Read-Write" },
        { id: 33, text: "I keep my written notes organised so I can find them again", modality: "Read-Write" },
        { id: 34, text: "I would rather read about something than watch a video about it", modality: "Read-Write" },
        { id: 35, text: "I like making my own word lists or glossaries for new topics", modality: "Read-Write" },
        { id: 36, text: "I revise best by rewriting my notes in my own words", modality: "Read-Write" },
      ],
    },
    {
      name: "VARK: Kinaesthetic",
      description: "Fleming VARK Model — Kinaesthetic Channel",
      questions: [
        { id: 37, text: "I learn best by doing experiments, projects or hands-on activities", modality: "Kinaesthetic" },
        { id: 38, text: "I remember things better once I have actually done them myself", modality: "Kinaesthetic" },
        { id: 39, text: "I find it hard to sit and listen for a long time without doing something", modality: "Kinaesthetic" },
        { id: 40, text: "I like using real objects, models or equipment to understand a topic", modality: "Kinaesthetic" },
        { id: 41, text: "I learn a new skill quickly when I am allowed to try it myself", modality: "Kinaesthetic" },
        { id: 42, text: "I use my hands or body to help me think something through", modality: "Kinaesthetic" },
        { id: 43, text: "I prefer acting things out to just reading about them", modality: "Kinaesthetic" },
        { id: 44, text: "I enjoy field trips, practical lessons or making things", modality: "Kinaesthetic" },
        { id: 45, text: "I need to try something out before I really understand how it works", modality: "Kinaesthetic" },
        { id: 46, text: "I like activities where I can move around rather than just sit still", modality: "Kinaesthetic" },
        { id: 47, text: "I learn well through role-play, building or practical investigation", modality: "Kinaesthetic" },
        { id: 48, text: "I remember a process better once I have practised it physically", modality: "Kinaesthetic" },
      ],
    },
    {
      name: "VARK: Multimodal",
      description: "Fleming VARK Model — Multimodal",
      questions: [
        { id: 49, text: "I use different ways of learning depending on the subject or task", modality: "Multimodal" },
        { id: 50, text: "I notice which way of learning works best for me in different situations", modality: "Multimodal" },
      ],
    },
    {
      name: "Linguistic Intelligence",
      description: "Gardner MI — Linguistic-Verbal Domain",
      questions: [
        { id: 51, text: "I enjoy reading books, comics or magazines for fun" },
        { id: 52, text: "I like writing stories, poems or journal entries" },
        { id: 53, text: "I enjoy class debates, discussions or word games" },
        { id: 54, text: "I find it easy to explain an idea clearly to someone else" },
        { id: 55, text: "I remember new or unusual words and enjoy using them" },
      ],
    },
    {
      name: "Logical-Mathematical Intelligence",
      description: "Gardner MI — Logical-Mathematical Domain",
      questions: [
        { id: 56, text: "I enjoy solving number problems and maths puzzles" },
        { id: 57, text: "I like working out why something happens the way it does" },
        { id: 58, text: "I enjoy logic puzzles, strategy games or simple coding" },
        { id: 59, text: "I notice patterns in numbers, shapes or information quickly" },
        { id: 60, text: "I like breaking a tricky problem into smaller, clearer steps" },
      ],
    },
    {
      name: "Spatial Intelligence",
      description: "Gardner MI — Visual-Spatial Domain",
      questions: [
        { id: 61, text: "I enjoy drawing, designing or making detailed artwork" },
        { id: 62, text: "I like building things with construction sets, blocks or models" },
        { id: 63, text: "I notice small visual details that other people often miss" },
        { id: 64, text: "I can picture in my mind what something will look like before I make it" },
        { id: 65, text: "I enjoy jigsaw puzzles, mazes and shape-based games" },
      ],
    },
    {
      name: "Musical Intelligence",
      description: "Gardner MI — Musical-Rhythmic Domain",
      questions: [
        { id: 66, text: "I enjoy music lessons, singing or playing an instrument" },
        { id: 67, text: "I remember tunes, rhythms and song lyrics easily" },
        { id: 68, text: "I like tapping, clapping or drumming along to a beat" },
        { id: 69, text: "I often hum, sing or make up tunes while I am working or playing" },
        { id: 70, text: "I enjoy dancing or moving in time with music" },
      ],
    },
    {
      name: "Bodily-Kinaesthetic Intelligence",
      description: "Gardner MI — Bodily-Kinaesthetic Domain",
      questions: [
        { id: 71, text: "I enjoy sports, gymnastics, dance or other physical activities" },
        { id: 72, text: "I like making or building things with my hands" },
        { id: 73, text: "I pick up new physical skills or movements quickly" },
        { id: 74, text: "I enjoy drama, role-play or acting things out" },
        { id: 75, text: "I find it hard to stay still for long periods of time" },
      ],
    },
    {
      name: "Interpersonal Intelligence",
      description: "Gardner MI — Interpersonal Domain",
      questions: [
        { id: 76, text: "I enjoy working with classmates on group projects" },
        { id: 77, text: "I am good at noticing how someone else is feeling" },
        { id: 78, text: "I like helping a friend who is finding something difficult" },
        { id: 79, text: "I make friends easily and enjoy meeting new people" },
        { id: 80, text: "I am often the one who helps sort out an argument between friends" },
      ],
    },
    {
      name: "Intrapersonal Intelligence",
      description: "Gardner MI — Intrapersonal Domain",
      questions: [
        { id: 81, text: "I know what subjects or activities I am good at and which I find harder" },
        { id: 82, text: "I enjoy some quiet time to think or work on my own" },
        { id: 83, text: "I keep trying even when something feels difficult at first" },
        { id: 84, text: "I can usually tell when I am feeling happy, worried or frustrated" },
        { id: 85, text: "I like setting myself small goals and trying to reach them" },
      ],
    },
    {
      name: "Naturalist Intelligence",
      description: "Gardner MI — Naturalist Domain",
      questions: [
        { id: 86, text: "I enjoy being outdoors, in gardens, parks or nature" },
        { id: 87, text: "I like observing plants, animals or insects closely" },
        { id: 88, text: "I notice changes in the weather or the seasons" },
        { id: 89, text: "I enjoy learning about animals, plants or the environment" },
        { id: 90, text: "I like sorting or grouping natural objects such as leaves, rocks or shells" },
      ],
    },
    {
      name: "Study Skills & Independence",
      description: "Early Self-Regulated Learning Indicators (Zimmerman, simplified)",
      questions: [
        { id: 91, text: "I check my work to look for mistakes before handing it in" },
        { id: 92, text: "I plan what I need to do before I start a project or piece of homework" },
        { id: 93, text: "I try a different way of doing something if my first attempt does not work" },
        { id: 94, text: "I keep my books, folders and belongings organised" },
        { id: 95, text: "I finish my homework or classwork without needing many reminders" },
        { id: 96, text: "I ask for help when I am stuck instead of giving up" },
        { id: 97, text: "I can work on my own for a reasonable amount of time without losing focus" },
        { id: 98, text: "I think about what went well and what I could improve after a test or project" },
        { id: 99, text: "I follow instructions carefully without needing them repeated often" },
        { id: 100, text: "I believe that practising something makes me better at it over time" },
      ],
    },
  ],
  get questions() {
    return this.dimensions.flatMap((d) => d.questions);
  },
};

// --- Group D --- Early Middle (Age 11-13 / Grades 6-8) | 100 items | Self-Report ---

const GROUP_D: AgeGroupConfig = {
  ageGroup: 11,
  label: "Early Middle (Age 11-13)",
  model: "VARK (Fleming) | Multiple Intelligences (Gardner) | Metacognition (Flavell/Zimmerman)",
  respondent: "Self (independent)",
  totalQuestions: 100,
  options: [
    { label: "Strongly Agree", emoji: "✅", value: 5 },
    { label: "Agree", emoji: "👍", value: 4 },
    { label: "Neutral", emoji: "😐", value: 3 },
    { label: "Disagree", emoji: "👎", value: 2 },
    { label: "Strongly Disagree", emoji: "❌", value: 1 },
    { label: "Not Sure", emoji: "🤷", value: 0 },
  ],
  dimensions: [
    {
      name: "VARK: Visual",
      description: "Fleming VARK Model — Visual Channel",
      questions: [
        { id: 1, text: "I understand information better when shown as a diagram or chart", modality: "Visual" },
        { id: 2, text: "I prefer visual notes such as mind maps, diagrams or colour-coding", modality: "Visual" },
        { id: 3, text: "I remember a process better after seeing it demonstrated", modality: "Visual" },
        { id: 4, text: "I notice visual details that others tend to miss", modality: "Visual" },
        { id: 5, text: "I learn well from videos, slides or infographics", modality: "Visual" },
        { id: 6, text: "I find graphs and charts easier to interpret than long text", modality: "Visual" },
        { id: 7, text: "I picture an idea in my mind to help me understand it", modality: "Visual" },
        { id: 8, text: "I prefer a labelled diagram to a written paragraph explaining the same thing", modality: "Visual" },
        { id: 9, text: "I remember where information appeared on a page or slide", modality: "Visual" },
        { id: 10, text: "I use highlighting or colour to organise my notes", modality: "Visual" },
        { id: 11, text: "I find it easier to follow a map or floor plan than written directions", modality: "Visual" },
        { id: 12, text: "I understand a concept better once I have seen an example worked out visually", modality: "Visual" },
      ],
    },
    {
      name: "VARK: Auditory",
      description: "Fleming VARK Model — Auditory Channel",
      questions: [
        { id: 13, text: "I learn best by listening to clear explanations and discussions", modality: "Auditory" },
        { id: 14, text: "I remember things better after talking about them with someone", modality: "Auditory" },
        { id: 15, text: "I prefer a teacher explaining a topic out loud to reading it silently", modality: "Auditory" },
        { id: 16, text: "I use audio recordings or read my notes aloud to revise", modality: "Auditory" },
        { id: 17, text: "I follow podcasts, talks or audiobooks easily", modality: "Auditory" },
        { id: 18, text: "I find it easier to understand spoken instructions than written ones", modality: "Auditory" },
        { id: 19, text: "I remember a class discussion better than the textbook page on the same topic", modality: "Auditory" },
        { id: 20, text: "I think out loud when working through a difficult problem", modality: "Auditory" },
        { id: 21, text: "I notice tone of voice and pick up meaning from how something is said", modality: "Auditory" },
        { id: 22, text: "I prefer asking a question out loud to looking up the answer myself", modality: "Auditory" },
        { id: 23, text: "I enjoy debates and verbal discussions to explore a topic", modality: "Auditory" },
        { id: 24, text: "I find background music or sound sometimes helps me concentrate", modality: "Auditory" },
      ],
    },
    {
      name: "VARK: Read/Write",
      description: "Fleming VARK Model — Read/Write Channel",
      questions: [
        { id: 25, text: "I learn best from reading detailed notes or textbooks", modality: "Read-Write" },
        { id: 26, text: "I retain information better when I write it out in my own words", modality: "Read-Write" },
        { id: 27, text: "I prefer reading instructions myself rather than being told them", modality: "Read-Write" },
        { id: 28, text: "I make written summaries or lists to help me revise", modality: "Read-Write" },
        { id: 29, text: "I enjoy looking things up and reading further about a topic", modality: "Read-Write" },
        { id: 30, text: "I notice when a sentence is grammatically incorrect or unclear", modality: "Read-Write" },
        { id: 31, text: "I prefer written feedback on my work to verbal feedback", modality: "Read-Write" },
        { id: 32, text: "I find it easier to understand something once I have written it down", modality: "Read-Write" },
        { id: 33, text: "I keep organised written notes that I refer back to", modality: "Read-Write" },
        { id: 34, text: "I would rather read an article than watch a video covering the same topic", modality: "Read-Write" },
        { id: 35, text: "I like making my own glossary of new or difficult words", modality: "Read-Write" },
        { id: 36, text: "I revise most effectively by rewriting my notes in a different format", modality: "Read-Write" },
      ],
    },
    {
      name: "VARK: Kinaesthetic",
      description: "Fleming VARK Model — Kinaesthetic Channel",
      questions: [
        { id: 37, text: "I learn best through practicals, experiments and hands-on activities", modality: "Kinaesthetic" },
        { id: 38, text: "I remember things far better if I have done them rather than read about them", modality: "Kinaesthetic" },
        { id: 39, text: "I find it hard to concentrate on long lectures without something to do", modality: "Kinaesthetic" },
        { id: 40, text: "I prefer subjects with labs, fieldwork or projects to purely theory-based ones", modality: "Kinaesthetic" },
        { id: 41, text: "I pick up a new physical or technical skill quickly by trying it myself", modality: "Kinaesthetic" },
        { id: 42, text: "I use movement (walking, tapping, gesturing) to help myself think", modality: "Kinaesthetic" },
        { id: 43, text: "I remember a process better once I have physically carried it out myself", modality: "Kinaesthetic" },
        { id: 44, text: "I prefer building or making something to writing about how it is built", modality: "Kinaesthetic" },
        { id: 45, text: "I find it easier to learn through role play or simulation than through reading", modality: "Kinaesthetic" },
        { id: 46, text: "I need to try something myself before the theory fully makes sense", modality: "Kinaesthetic" },
        { id: 47, text: "I enjoy subjects that involve using tools, equipment or materials", modality: "Kinaesthetic" },
        { id: 48, text: "I focus better when I can move around rather than sit still for a long period", modality: "Kinaesthetic" },
      ],
    },
    {
      name: "VARK: Multimodal",
      description: "Fleming VARK Model — Multimodal",
      questions: [
        { id: 49, text: "I use a mix of methods depending on the subject or type of content", modality: "Multimodal" },
        { id: 50, text: "I consciously choose the learning channel that suits the specific task", modality: "Multimodal" },
      ],
    },
    {
      name: "Linguistic Intelligence",
      description: "Gardner MI — Linguistic-Verbal Domain",
      questions: [
        { id: 51, text: "I enjoy reading books, articles or stories for pleasure" },
        { id: 52, text: "I express my ideas clearly and with confidence in writing" },
        { id: 53, text: "I enjoy debates, class discussions and word-based games" },
        { id: 54, text: "I can explain a concept clearly to a classmate" },
        { id: 55, text: "I enjoy writing creatively such as stories, poems or scripts" },
      ],
    },
    {
      name: "Logical-Mathematical Intelligence",
      description: "Gardner MI — Logical-Mathematical Domain",
      questions: [
        { id: 56, text: "I enjoy solving maths problems, especially multi-step ones" },
        { id: 57, text: "I like working out why things happen the way they do" },
        { id: 58, text: "I enjoy logical puzzles, strategy games or coding" },
        { id: 59, text: "I identify patterns and numerical sequences quickly" },
        { id: 60, text: "I enjoy breaking a complex problem into smaller, structured steps" },
      ],
    },
    {
      name: "Spatial Intelligence",
      description: "Gardner MI — Visual-Spatial Domain",
      questions: [
        { id: 61, text: "I enjoy art, design, photography or technical drawing" },
        { id: 62, text: "I can visualise how a finished product will look before it is built" },
        { id: 63, text: "I am good at reading maps and navigating new environments" },
        { id: 64, text: "I find it easy to mentally rotate objects or imagine them from different angles" },
        { id: 65, text: "I enjoy creating things such as models, posters or designs" },
      ],
    },
    {
      name: "Musical Intelligence",
      description: "Gardner MI — Musical-Rhythmic Domain",
      questions: [
        { id: 66, text: "I remember melodies and rhythms with ease" },
        { id: 67, text: "I notice structural patterns in music such as beat or chord changes" },
        { id: 68, text: "I express myself through music, singing or playing an instrument" },
        { id: 69, text: "I connect specific emotions to pieces of music I know well" },
        { id: 70, text: "I find music a useful tool for managing my mood or focus" },
      ],
    },
    {
      name: "Bodily-Kinaesthetic Intelligence",
      description: "Gardner MI — Bodily-Kinaesthetic Domain",
      questions: [
        { id: 71, text: "I am skilled at sports, dance, drama or physical performance" },
        { id: 72, text: "I use natural hand gestures and movement when I explain things" },
        { id: 73, text: "I pick up new physical skills or movement patterns quickly" },
        { id: 74, text: "I enjoy activities that involve skilled use of my hands" },
        { id: 75, text: "I am aware of how my posture affects my mood and focus" },
      ],
    },
    {
      name: "Interpersonal Intelligence",
      description: "Gardner MI — Interpersonal Domain",
      questions: [
        { id: 76, text: "I work effectively in team projects and group discussions" },
        { id: 77, text: "I am skilled at reading people's moods and responding with sensitivity" },
        { id: 78, text: "I naturally take on a leadership or coordinating role in group work" },
        { id: 79, text: "I enjoy helping classmates who are struggling with a concept" },
        { id: 80, text: "I can adapt how I communicate depending on who I am speaking to" },
      ],
    },
    {
      name: "Intrapersonal Intelligence",
      description: "Gardner MI — Intrapersonal Domain",
      questions: [
        { id: 81, text: "I actively reflect on my own strengths and areas to develop" },
        { id: 82, text: "I set personal academic goals and monitor my own progress" },
        { id: 83, text: "I prefer working independently on deep or complex tasks" },
        { id: 84, text: "I stay motivated to learn even without external rewards or praise" },
        { id: 85, text: "I have a clear sense of what I value and what matters to me" },
      ],
    },
    {
      name: "Naturalist Intelligence",
      description: "Gardner MI — Naturalist Domain",
      questions: [
        { id: 86, text: "I am genuinely curious about the natural world, including ecology and biology" },
        { id: 87, text: "I naturally connect classroom learning to real-world patterns and examples" },
        { id: 88, text: "I notice patterns in data sets, natural systems or complex environments" },
        { id: 89, text: "I am drawn to science, geography or environmental topics" },
        { id: 90, text: "I enjoy fieldwork, outdoor learning or science experiments" },
      ],
    },
    {
      name: "Metacognition & Study Habits",
      description: "Flavell Metacognition | Zimmerman Self-Regulated Learning | Information Processing",
      questions: [
        { id: 91, text: "I plan my study session before I start, knowing what I want to accomplish" },
        { id: 92, text: "I review my mistakes carefully to understand exactly where I went wrong" },
        { id: 93, text: "I break large assignments into smaller, manageable steps with deadlines" },
        { id: 94, text: "I can distinguish between genuinely understanding something and just memorising it" },
        { id: 95, text: "I change my study approach when my current method is not working" },
        { id: 96, text: "I test myself on content rather than just re-reading my notes" },
        { id: 97, text: "I prioritise topics based on importance and my own understanding gaps" },
        { id: 98, text: "I avoid distractions deliberately during focused study sessions" },
        { id: 99, text: "I reflect after an exam or assignment on what I could do differently next time" },
        { id: 100, text: "I am aware of the study strategies that work best for me specifically" },
      ],
    },
  ],
  get questions() {
    return this.dimensions.flatMap((d) => d.questions);
  },
};

// --- Group E --- Senior (Age 14-15 / Grades 9-10) | 100 items | Self-Report ---

const GROUP_E: AgeGroupConfig = {
  ageGroup: 14,
  label: "Senior (Age 14-15)",
  model: "VARK (Fleming) | Big Five OCEAN | Holland RIASEC | DISC | Career Orientation | Metacognition",
  respondent: "Self (independent)",
  totalQuestions: 100,
  options: [
    { label: "Strongly Agree", emoji: "✅", value: 5 },
    { label: "Agree", emoji: "👍", value: 4 },
    { label: "Neutral", emoji: "😐", value: 3 },
    { label: "Disagree", emoji: "👎", value: 2 },
    { label: "Strongly Disagree", emoji: "❌", value: 1 },
    { label: "Not Sure", emoji: "🤷", value: 0 },
  ],
  dimensions: [
    {
      name: "VARK: Visual",
      description: "Fleming VARK Model — Visual Channel",
      questions: [
        { id: 1, text: "I understand new material best through diagrams, charts and visual summaries", modality: "Visual" },
        { id: 2, text: "I create visual representations of information such as colour-coded notes or concept maps", modality: "Visual" },
        { id: 3, text: "I retain information longer when I have seen it represented graphically", modality: "Visual" },
        { id: 4, text: "I prefer infographics or annotated diagrams to dense blocks of text", modality: "Visual" },
        { id: 5, text: "I can recall the visual layout of a page or slide when trying to remember content", modality: "Visual" },
        { id: 6, text: "I find data easier to interpret as a graph than as a table of numbers", modality: "Visual" },
        { id: 7, text: "I visualise a process step-by-step to help myself understand it", modality: "Visual" },
        { id: 8, text: "I annotate or highlight visual material more than written text", modality: "Visual" },
        { id: 9, text: "I learn a new skill faster after watching a demonstration than after reading a manual", modality: "Visual" },
        { id: 10, text: "I notice inconsistencies in visual data, such as a mislabelled axis or chart", modality: "Visual" },
        { id: 11, text: "I prefer video tutorials to written instructions for technical tasks", modality: "Visual" },
        { id: 12, text: "I remember exactly where on a page or slide a piece of information appeared", modality: "Visual" },
      ],
    },
    {
      name: "VARK: Auditory",
      description: "Fleming VARK Model — Auditory Channel",
      questions: [
        { id: 13, text: "I understand new material best by listening to explanations, lectures or podcasts", modality: "Auditory" },
        { id: 14, text: "I revise by talking through content aloud, alone or in a study group", modality: "Auditory" },
        { id: 15, text: "I retain spoken information better than the same information in writing", modality: "Auditory" },
        { id: 16, text: "I find that discussing a topic out loud clarifies my understanding of it", modality: "Auditory" },
        { id: 17, text: "I use verbal repetition or recitation as a primary revision technique", modality: "Auditory" },
        { id: 18, text: "I pick up nuance and meaning from tone of voice in a discussion", modality: "Auditory" },
        { id: 19, text: "I prefer a verbal explanation to a written one when I am confused", modality: "Auditory" },
        { id: 20, text: "I learn effectively from structured debate or Socratic-style questioning", modality: "Auditory" },
        { id: 21, text: "I find I think more clearly when I articulate my reasoning aloud", modality: "Auditory" },
        { id: 22, text: "I retain content from audiobooks or recorded lectures well", modality: "Auditory" },
        { id: 23, text: "I notice and remember the structure of a spoken argument", modality: "Auditory" },
        { id: 24, text: "I find that explaining a topic aloud to someone else deepens my own understanding", modality: "Auditory" },
      ],
    },
    {
      name: "VARK: Read/Write",
      description: "Fleming VARK Model — Read/Write Channel",
      questions: [
        { id: 25, text: "I understand new material best through careful reading and detailed note-taking", modality: "Read-Write" },
        { id: 26, text: "I produce written summaries, outlines or reformatted notes as my primary revision tool", modality: "Read-Write" },
        { id: 27, text: "I prefer dense, well-organised written material to spoken explanation", modality: "Read-Write" },
        { id: 28, text: "I revise most effectively by rewriting key ideas in my own words", modality: "Read-Write" },
        { id: 29, text: "I read supplementary material beyond what is assigned to deepen my understanding", modality: "Read-Write" },
        { id: 30, text: "I notice precise or imprecise use of language in what I read", modality: "Read-Write" },
        { id: 31, text: "I prefer written feedback that I can reread and analyse over verbal feedback", modality: "Read-Write" },
        { id: 32, text: "I keep structured, written records of my learning that I return to", modality: "Read-Write" },
        { id: 33, text: "I find it easier to construct an argument in writing than verbally", modality: "Read-Write" },
        { id: 34, text: "I would rather read a detailed report than watch a summary video on the same topic", modality: "Read-Write" },
        { id: 35, text: "I build my own glossary or reference notes for unfamiliar terminology", modality: "Read-Write" },
        { id: 36, text: "I retain technical or factual material best after writing it down myself", modality: "Read-Write" },
      ],
    },
    {
      name: "VARK: Kinaesthetic",
      description: "Fleming VARK Model — Kinaesthetic Channel",
      questions: [
        { id: 37, text: "I understand new material best by doing — through projects, experiments or real-world application", modality: "Kinaesthetic" },
        { id: 38, text: "I need concrete examples and practical experience before abstract theory makes sense", modality: "Kinaesthetic" },
        { id: 39, text: "I find it difficult to absorb purely theoretical material without a practical component", modality: "Kinaesthetic" },
        { id: 40, text: "I retain a skill far longer once I have actually practised or performed it", modality: "Kinaesthetic" },
        { id: 41, text: "I prefer subjects involving labs, fieldwork or applied projects to purely lecture-based ones", modality: "Kinaesthetic" },
        { id: 42, text: "I pick up technical or physical skills quickly through direct practice", modality: "Kinaesthetic" },
        { id: 43, text: "I use movement, gesture or physical models to think through complex ideas", modality: "Kinaesthetic" },
        { id: 44, text: "I learn a process more securely by carrying it out myself than by watching or reading about it", modality: "Kinaesthetic" },
        { id: 45, text: "I prefer internships, work experience or simulations to classroom-only learning", modality: "Kinaesthetic" },
        { id: 46, text: "I find I need to interact with material physically (build, test, manipulate) before I trust I understand it", modality: "Kinaesthetic" },
        { id: 47, text: "I focus and think more clearly when I am physically active rather than sedentary", modality: "Kinaesthetic" },
        { id: 48, text: "I prefer trial-and-error experimentation to following a fixed set of instructions", modality: "Kinaesthetic" },
      ],
    },
    {
      name: "VARK: Multimodal",
      description: "Fleming VARK Model — Multimodal",
      questions: [
        { id: 49, text: "I naturally draw on multiple learning channels depending on the subject or complexity", modality: "Multimodal" },
        { id: 50, text: "I consciously select the learning mode most suited to a specific task or subject", modality: "Multimodal" },
      ],
    },
    {
      name: "Openness to Experience",
      description: "Big Five OCEAN — Factor O",
      questions: [
        { id: 51, text: "I actively seek out ideas and perspectives that challenge what I already believe" },
        { id: 52, text: "I am drawn to creative, imaginative or artistic work" },
        { id: 53, text: "I enjoy exploring unfamiliar subjects, cultures or ways of thinking" },
        { id: 54, text: "I am excited by ambiguity and open questions rather than unsettled by them" },
      ],
    },
    {
      name: "Conscientiousness",
      description: "Big Five OCEAN — Factor C",
      questions: [
        { id: 55, text: "I plan my work systematically before I begin" },
        { id: 56, text: "I consistently meet deadlines without needing reminders" },
        { id: 57, text: "I set specific, measurable goals and track my own progress toward them" },
        { id: 58, text: "I take responsibility for outcomes rather than attributing them to luck or others" },
      ],
    },
    {
      name: "Extraversion",
      description: "Big Five OCEAN — Factor E",
      questions: [
        { id: 59, text: "I feel energised and recharged after spending time in social groups" },
        { id: 60, text: "I am comfortable speaking up and presenting in front of an audience" },
        { id: 61, text: "I initiate conversations and introductions with new people naturally" },
        { id: 62, text: "I seek out networking, group discussions and community involvement" },
      ],
    },
    {
      name: "Agreeableness",
      description: "Big Five OCEAN — Factor A",
      questions: [
        { id: 63, text: "I consider the feelings and impact on others before I act or speak" },
        { id: 64, text: "I volunteer to help others without being asked or rewarded" },
        { id: 65, text: "I remain cooperative and collaborative even when I strongly disagree" },
        { id: 66, text: "I actively listen to others without interrupting or dismissing their views" },
      ],
    },
    {
      name: "Emotional Stability",
      description: "Big Five OCEAN — Factor N (Reverse Scored)",
      questions: [
        { id: 67, text: "I remain calm and composed under pressure, deadlines or uncertainty" },
        { id: 68, text: "I recover quickly from setbacks, criticism and disappointments" },
        { id: 69, text: "I manage my emotional responses well during high-stakes situations" },
        { id: 70, text: "I maintain perspective when things go wrong rather than catastrophising" },
      ],
    },
    {
      name: "Holland RIASEC — Career Aptitude",
      description: "Holland RIASEC Model — 6 Career Types",
      questions: [
        { id: 71, text: "I enjoy practical, hands-on or technical work such as building or repairing (Realistic)" },
        { id: 72, text: "I am good with tools, machinery or technical systems (Realistic)" },
        { id: 73, text: "I enjoy investigating, researching and solving complex problems systematically (Investigative)" },
        { id: 74, text: "I am drawn to science, data analysis and evidence-based thinking (Investigative)" },
        { id: 75, text: "I enjoy creative expression such as writing, art, music or design (Artistic)" },
        { id: 76, text: "I prefer open-ended tasks where I can express originality (Artistic)" },
        { id: 77, text: "I find deep satisfaction in helping, teaching or supporting other people (Social)" },
        { id: 78, text: "I am drawn to careers in healthcare, education, counselling or community work (Social)" },
        { id: 79, text: "I enjoy leading, persuading, negotiating and managing projects or teams (Enterprising)" },
        { id: 80, text: "I prefer structured, organised, rule-based tasks and administrative processes (Conventional)" },
      ],
    },
    {
      name: "DISC — Behavioural & Communication Style",
      description: "DISC Behavioural Assessment Model — 4 Styles",
      questions: [
        { id: 81, text: "In a group, I naturally step forward to take charge and set direction (Dominant)" },
        { id: 82, text: "I am direct, results-focused and decisive, preferring action over discussion (Dominant)" },
        { id: 83, text: "I motivate others with enthusiasm, energy and an optimistic outlook (Influential)" },
        { id: 84, text: "I am persuasive and expressive, and enjoy building relationships and influence (Influential)" },
        { id: 85, text: "I work steadily and reliably, staying patient, consistent and collaborative (Steady)" },
        { id: 86, text: "I am a trusted support to others, dependable, empathetic and loyal (Steady)" },
        { id: 87, text: "I focus intensely on accuracy, quality and getting details exactly right (Conscientious)" },
        { id: 88, text: "I analyse situations carefully before acting and hold myself to high standards (Conscientious)" },
      ],
    },
    {
      name: "Academic & Career Orientation",
      description: "Holland RIASEC | Academic Preferences | Self-Determination Theory",
      questions: [
        { id: 89, text: "I am drawn to STEM subjects such as science, technology, engineering or mathematics" },
        { id: 90, text: "I am drawn to humanities such as literature, history, philosophy or languages" },
        { id: 91, text: "I am drawn to creative fields such as art, design, media or performing arts" },
        { id: 92, text: "I am drawn to people-centred professions such as medicine, teaching or law" },
        { id: 93, text: "I am drawn to business, entrepreneurship and organisational leadership" },
        { id: 94, text: "I want to build, lead or scale something — a team, a company or a movement" },
      ],
    },
    {
      name: "Metacognition & Self-Directed Learning",
      description: "Flavell Metacognition | Zimmerman SRL | Self-Determination Theory",
      questions: [
        { id: 95, text: "I identify my own learning gaps without needing a teacher to point them out" },
        { id: 96, text: "I actively seek feedback on my work and use it deliberately to improve" },
        { id: 97, text: "I set long-term academic or career goals and adjust short-term plans to stay on track" },
        { id: 98, text: "I take full ownership of my academic progress rather than depending on others" },
        { id: 99, text: "I know which conditions — time of day, environment, approach — optimise my learning" },
        { id: 100, text: "I see academic setbacks as information and opportunities rather than as failures" },
      ],
    },
  ],
  get questions() {
    return this.dimensions.flatMap((d) => d.questions);
  },
};

// --- Exports ---

export const AGE_GROUPS: AgeGroupConfig[] = [GROUP_A, GROUP_B, GROUP_C, GROUP_D, GROUP_E];

export function getAgeGroupConfig(ageGroupOrAge: number): AgeGroupConfig | undefined {
  const direct = AGE_GROUPS.find((g) => g.ageGroup === ageGroupOrAge);
  if (direct) return direct;

  // Fallback: interpret as actual age
  if (ageGroupOrAge >= 3 && ageGroupOrAge < 6) return AGE_GROUPS.find((g) => g.ageGroup === 3);
  if (ageGroupOrAge >= 6 && ageGroupOrAge < 9) return AGE_GROUPS.find((g) => g.ageGroup === 6);
  if (ageGroupOrAge >= 9 && ageGroupOrAge < 11) return AGE_GROUPS.find((g) => g.ageGroup === 9);
  if (ageGroupOrAge >= 11 && ageGroupOrAge < 14) return AGE_GROUPS.find((g) => g.ageGroup === 11);
  return AGE_GROUPS.find((g) => g.ageGroup === 14);
}

export function getDimensionForQuestion(config: AgeGroupConfig, questionId: number): Dimension | undefined {
  return config.dimensions.find((d) => d.questions.some((q) => q.id === questionId));
}

export function getDimensionStartIndex(config: AgeGroupConfig, dimensionIndex: number): number {
  let start = 0;
  for (let i = 0; i < dimensionIndex; i++) {
    start += config.dimensions[i].questions.length;
  }
  return start;
}

/** Compute VARK scores from answers for groups B-E */
export function computeVARKScores(config: AgeGroupConfig, answers: Record<number, number>): Record<string, number> {
  const scores: Record<string, number> = { Visual: 0, Auditory: 0, "Read-Write": 0, Kinaesthetic: 0, Multimodal: 0 };
  for (const dim of config.dimensions) {
    for (const q of dim.questions) {
      if (q.modality && answers[q.id] !== undefined) {
        scores[q.modality] = (scores[q.modality] || 0) + answers[q.id];
      }
    }
  }
  return scores;
}

/** Get dimension score interpretation band */
export function getScoreBand(scorePercent: number): string {
  if (scorePercent >= 90) return "Strongly developed";
  if (scorePercent >= 70) return "Well developed";
  if (scorePercent >= 50) return "Emerging";
  if (scorePercent >= 30) return "Developing";
  return "Needs attention";
}
