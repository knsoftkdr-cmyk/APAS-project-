export interface AssessmentQuestion {
  id: number;
  text: string;
  /** Optional modality tag for VARK-type questions */
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
  maxScorePerDimension: number;
  options: { label: string; emoji: string; value: number }[];
  dimensions: Dimension[];
  /** Flat list of all questions (computed helper) */
  questions: AssessmentQuestion[];
}

// ─── Group A — Age 3 to 4 (50 items, 5 dimensions × 10) ───

const GROUP_A: AgeGroupConfig = {
  ageGroup: 3,
  label: "Child (Age 3–4)",
  model: "Developmental Milestones · Early MI (Gardner) · Erikson Stage 2 · WHO Motor Standards",
  respondent: "Parent / Teacher",
  totalQuestions: 50,
  maxScorePerDimension: 40,
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
        { id: 6, text: "Shows awareness of another child's distress (looks concerned, tries to help)" },
        { id: 7, text: "Plays alongside other children without conflict or aggression" },
        { id: 8, text: "Shares a toy or material when gently prompted by an adult" },
        { id: 9, text: "Shows pride in completing a task independently" },
        { id: 10, text: "Demonstrates growing independence — tries things without always asking for help" },
      ],
    },
    {
      name: "Language & Communication",
      description: "Vygotsky ZPD — language scaffolding | ASHA Milestones",
      questions: [
        { id: 11, text: "Uses sentences of at least 2–3 words to express needs or ideas" },
        { id: 12, text: "Names at least 10 familiar objects when shown pictures" },
        { id: 13, text: "Points to objects in pictures when named by an adult" },
        { id: 14, text: "Follows two-step instructions without gestural prompts" },
        { id: 15, text: "Asks simple questions using 'what', 'where' or 'who'" },
        { id: 16, text: "Repeats new words after hearing them once or twice" },
        { id: 17, text: "Retells a simple story with 2–3 key events in sequence" },
        { id: 18, text: "Recognises and responds to their own printed name" },
        { id: 19, text: "Uses pronouns correctly — I, me, you, he, she at least some of the time" },
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
        { id: 24, text: "Counts 1–5 objects correctly with one-to-one correspondence" },
        { id: 25, text: "Identifies at least 5 basic colours by name" },
        { id: 26, text: "Completes a simple 4–6 piece puzzle independently" },
        { id: 27, text: "Recognises common animals and names them correctly" },
        { id: 28, text: "Matches identical shapes or pictures in a simple matching game" },
        { id: 29, text: "Understands concepts of 'more' and 'less' with physical objects" },
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
        { id: 39, text: "Attempts to dress independently — manages buttons or zip with effort" },
        { id: 40, text: "Uses child scissors to cut along a straight line" },
      ],
    },
    {
      name: "Early Multiple Intelligences Signals",
      description: "Gardner MI Theory — 8 Domains (Early Indicators)",
      questions: [
        { id: 41, text: "Shows strong interest in music — hums, claps to rhythm, responds to songs (Musical)" },
        { id: 42, text: "Enjoys being read to and studies illustrations carefully (Linguistic)" },
        { id: 43, text: "Spontaneously creates stories, narrates play or uses rich descriptive language (Linguistic)" },
        { id: 44, text: "Gravitates to building, stacking and arranging objects by size or colour (Logical-Spatial)" },
        { id: 45, text: "Demonstrates a strong preference for physical, outdoor, movement-based play (Bodily-Kinaesthetic)" },
        { id: 46, text: "Engages deeply and independently in art — drawing, colouring, clay or collage (Spatial)" },
        { id: 47, text: "Notices and comments on details in nature — insects, plants, weather, clouds (Naturalist)" },
        { id: 48, text: "Seeks out other children, initiates games and shows empathy in play (Interpersonal)" },
        { id: 49, text: "Has a preferred activity they return to independently and resist interruption (Intrapersonal)" },
        { id: 50, text: "Asks repeated 'why' questions about how things work or what things are (Logical-Mathematical)" },
      ],
    },
  ],
  get questions() {
    return this.dimensions.flatMap((d) => d.questions);
  },
};

// ─── Group B — Age 5 to 9 (100 items, 10 dimensions × 10) ───

const GROUP_B: AgeGroupConfig = {
  ageGroup: 5,
  label: "Child (Age 5–9)",
  model: "Multiple Intelligences — 8 domains (Gardner) · VARK (Fleming) · School Readiness",
  respondent: "Self (read aloud if needed)",
  totalQuestions: 100,
  maxScorePerDimension: 40,
  options: [
    { label: "Always", emoji: "😊", value: 4 },
    { label: "Sometimes", emoji: "🙂", value: 3 },
    { label: "Not much", emoji: "😐", value: 2 },
    { label: "Never", emoji: "😶", value: 1 },
    { label: "Not sure", emoji: "🤷", value: 0 },
  ],
  dimensions: [
    {
      name: "Linguistic Intelligence",
      description: "Gardner MI — Linguistic Domain",
      questions: [
        { id: 1, text: "I enjoy listening to stories being read aloud" },
        { id: 2, text: "I like making up my own stories to tell or act out" },
        { id: 3, text: "I enjoy learning new and unusual words" },
        { id: 4, text: "I like reading short books or picture books by myself" },
        { id: 5, text: "I enjoy writing sentences, short stories or messages" },
        { id: 6, text: "I remember jokes, riddles and rhymes easily" },
        { id: 7, text: "I like describing things in as much detail as I can" },
        { id: 8, text: "I enjoy playing word games like rhyming or tongue twisters" },
        { id: 9, text: "I can retell a story I have heard in the right order" },
        { id: 10, text: "I notice when words sound alike or are spelt in interesting ways" },
      ],
    },
    {
      name: "Logical-Mathematical Intelligence",
      description: "Gardner MI — Logical-Mathematical Domain",
      questions: [
        { id: 11, text: "I enjoy counting and working with numbers" },
        { id: 12, text: "I like solving puzzles and brain teasers" },
        { id: 13, text: "I can spot patterns in colours, shapes or numbers" },
        { id: 14, text: "I enjoy figuring out how things work by myself" },
        { id: 15, text: "I like games that have rules, strategy and scoring" },
        { id: 16, text: "I enjoy sorting and organising things into groups" },
        { id: 17, text: "I like doing maths problems even when they are hard" },
        { id: 18, text: "I notice when something does not make sense or add up" },
        { id: 19, text: "I enjoy step-by-step activities where each step leads to the next" },
        { id: 20, text: "I like experiments where I can test what will happen" },
      ],
    },
    {
      name: "Spatial Intelligence",
      description: "Gardner MI — Spatial Domain",
      questions: [
        { id: 21, text: "I enjoy drawing and creating detailed pictures" },
        { id: 22, text: "I can find my way around familiar places without getting lost" },
        { id: 23, text: "I like building things with blocks, LEGO or construction sets" },
        { id: 24, text: "I enjoy looking at diagrams, maps and illustrated books" },
        { id: 25, text: "I notice small details in pictures that others might miss" },
        { id: 26, text: "I like colouring carefully and staying inside the lines" },
        { id: 27, text: "I enjoy making things with craft materials — cutting, folding, sticking" },
        { id: 28, text: "I can picture what a finished drawing or model will look like before I start" },
        { id: 29, text: "I enjoy jigsaw puzzles and shape-matching games" },
        { id: 30, text: "I like looking at things from different angles to understand them better" },
      ],
    },
    {
      name: "Musical Intelligence",
      description: "Gardner MI — Musical Domain",
      questions: [
        { id: 31, text: "I enjoy music lessons and singing in class or at home" },
        { id: 32, text: "I remember song lyrics and melodies after hearing them a few times" },
        { id: 33, text: "I like clapping, tapping or drumming along to a beat" },
        { id: 34, text: "I can tell when music sounds happy, sad, exciting or calm" },
        { id: 35, text: "I often hum or sing to myself while working, playing or walking" },
        { id: 36, text: "I like learning new songs and teaching them to others" },
        { id: 37, text: "I notice when someone sings or plays a note that is wrong" },
        { id: 38, text: "I enjoy dancing or moving my body in time with music" },
        { id: 39, text: "I can follow a simple rhythm by clapping when shown" },
        { id: 40, text: "I feel differently depending on what kind of music is playing" },
      ],
    },
    {
      name: "Bodily-Kinaesthetic Intelligence",
      description: "Gardner MI — Bodily-Kinaesthetic Domain",
      questions: [
        { id: 41, text: "I enjoy outdoor games, running, jumping and sports" },
        { id: 42, text: "I like using my hands to make, build or take apart things" },
        { id: 43, text: "I find it hard to sit still for a very long time" },
        { id: 44, text: "I pick up new movements and physical skills quickly" },
        { id: 45, text: "I enjoy acting, role play or drama activities" },
        { id: 46, text: "I learn something new better when I can try it myself" },
        { id: 47, text: "I like working with materials I can touch — clay, sand, fabric" },
        { id: 48, text: "I enjoy physical challenges like climbing, balancing or gymnastics" },
        { id: 49, text: "I express how I feel by moving — jumping, skipping, dancing" },
        { id: 50, text: "I find it easier to remember things when I do them with my body" },
      ],
    },
    {
      name: "Interpersonal Intelligence",
      description: "Gardner MI — Interpersonal Domain",
      questions: [
        { id: 51, text: "I enjoy working together with classmates on group activities" },
        { id: 52, text: "I like helping a friend who is stuck on something" },
        { id: 53, text: "I am good at knowing how someone is feeling without being told" },
        { id: 54, text: "I enjoy team games where everyone plays a part" },
        { id: 55, text: "I make friends easily when I meet someone new" },
        { id: 56, text: "I like being part of a group more than working alone" },
        { id: 57, text: "I notice when a classmate is upset or left out" },
        { id: 58, text: "I enjoy talking and sharing ideas with others" },
        { id: 59, text: "I can help solve disagreements between friends" },
        { id: 60, text: "I enjoy teaching or explaining things to other children" },
      ],
    },
    {
      name: "Intrapersonal Intelligence",
      description: "Gardner MI — Intrapersonal Domain",
      questions: [
        { id: 61, text: "I know what I am good at and what I find hard" },
        { id: 62, text: "I like having some quiet time by myself" },
        { id: 63, text: "I think about why I feel a certain way" },
        { id: 64, text: "I have a favourite activity I enjoy doing on my own" },
        { id: 65, text: "I keep trying even when something is difficult" },
        { id: 66, text: "I can tell when I am feeling worried, excited or bored" },
        { id: 67, text: "I like setting a personal challenge and working toward it" },
        { id: 68, text: "I feel comfortable making small decisions on my own" },
        { id: 69, text: "I know what kind of activities make me feel calm and happy" },
        { id: 70, text: "I think about what I could do better after I finish a task" },
      ],
    },
    {
      name: "Naturalist Intelligence",
      description: "Gardner MI — Naturalist Domain",
      questions: [
        { id: 71, text: "I enjoy spending time outside in gardens, parks or nature" },
        { id: 72, text: "I like observing animals, insects and plants closely" },
        { id: 73, text: "I notice changes in weather — clouds, wind, rain, temperature" },
        { id: 74, text: "I enjoy sorting and grouping natural objects like leaves or rocks" },
        { id: 75, text: "I like learning the names of animals and plants" },
        { id: 76, text: "I notice small living things that others might ignore — ants, worms, birds" },
        { id: 77, text: "I enjoy gardening, growing plants or caring for animals" },
        { id: 78, text: "I like books, documentaries and programmes about nature" },
        { id: 79, text: "I can identify several birds, trees or insects by sight" },
        { id: 80, text: "I feel calm and happy when I am in natural settings" },
      ],
    },
    {
      name: "VARK Learning Style",
      description: "Fleming VARK Model — Learning Modality Preferences",
      questions: [
        { id: 81, text: "I remember things better when I see a picture or diagram", modality: "Visual" },
        { id: 82, text: "I understand a story better when I look at the illustrations", modality: "Visual" },
        { id: 83, text: "I remember something better when someone explains it out loud", modality: "Auditory" },
        { id: 84, text: "I enjoy listening to instructions being read to me", modality: "Auditory" },
        { id: 85, text: "I learn best when I can touch, make or move something", modality: "Kinaesthetic" },
        { id: 86, text: "I find it easier to remember things I have actually done", modality: "Kinaesthetic" },
        { id: 87, text: "I like writing down or drawing what I want to remember", modality: "Read-Write" },
        { id: 88, text: "I understand a task better when I can read the instructions myself", modality: "Read-Write" },
        { id: 89, text: "When I do not understand something, I ask someone to show me how", modality: "Kinaesthetic" },
        { id: 90, text: "I use different ways to learn depending on what I am doing", modality: "Multimodal" },
      ],
    },
    {
      name: "Self-Regulation & School Readiness",
      description: "School Readiness Framework — Executive Function & Emotional Regulation",
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

// ─── Group C — Age 10 to 14 (100 items, 10 dimensions × 10) ───

const GROUP_C: AgeGroupConfig = {
  ageGroup: 10,
  label: "Student (Age 10–14)",
  model: "Multiple Intelligences · VARK · Information Processing · Metacognition (Flavell/Zimmerman)",
  respondent: "Self (independent)",
  totalQuestions: 100,
  maxScorePerDimension: 50,
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
      name: "Linguistic Intelligence",
      description: "Gardner MI — Linguistic Domain",
      questions: [
        { id: 1, text: "I enjoy reading books, articles or stories for pleasure" },
        { id: 2, text: "I express my ideas clearly and with confidence in writing" },
        { id: 3, text: "I enjoy debates, class discussions and word-based games" },
        { id: 4, text: "I can explain a concept clearly to a classmate" },
        { id: 5, text: "I notice grammatical errors or unusual word choices in text" },
        { id: 6, text: "I enjoy writing creatively — stories, poems, scripts or journals" },
        { id: 7, text: "I remember quotes, lyrics or dialogue from things I have read or heard" },
        { id: 8, text: "I find it easy to write detailed descriptions of people, places or events" },
        { id: 9, text: "I enjoy researching a topic and writing up what I find" },
        { id: 10, text: "I am drawn to subjects that involve reading, writing or language" },
      ],
    },
    {
      name: "Logical-Mathematical Intelligence",
      description: "Gardner MI — Logical-Mathematical Domain",
      questions: [
        { id: 11, text: "I enjoy solving maths problems, especially multi-step ones" },
        { id: 12, text: "I like working out why things happen the way they do" },
        { id: 13, text: "I enjoy logical puzzles, strategy games or coding" },
        { id: 14, text: "I prefer conclusions that are supported by evidence and reasoning" },
        { id: 15, text: "I identify patterns and numerical sequences quickly" },
        { id: 16, text: "I enjoy breaking a complex problem into smaller, structured steps" },
        { id: 17, text: "I find satisfaction in finding the single correct answer to a problem" },
        { id: 18, text: "I like subjects that follow logical rules — maths, physics, computer science" },
        { id: 19, text: "I think through multiple approaches before deciding on a method" },
        { id: 20, text: "I enjoy activities that involve measurement, data or quantitative thinking" },
      ],
    },
    {
      name: "Spatial Intelligence",
      description: "Gardner MI — Spatial Domain",
      questions: [
        { id: 21, text: "I understand information better when shown as a diagram or chart" },
        { id: 22, text: "I enjoy art, design, photography or architecture" },
        { id: 23, text: "I can visualise how a finished product will look before it is built" },
        { id: 24, text: "I am good at reading maps and navigating new environments" },
        { id: 25, text: "I enjoy geometry, technical drawing or spatial reasoning tasks" },
        { id: 26, text: "I notice visual details — colour, proportion, composition — that others miss" },
        { id: 27, text: "I find it easy to mentally rotate objects or imagine them from different angles" },
        { id: 28, text: "I prefer visual notes — mind maps, diagrams, sketches — over written paragraphs" },
        { id: 29, text: "I enjoy creating things — models, posters, designs, layouts" },
        { id: 30, text: "I find my way around unfamiliar places more easily than most people I know" },
      ],
    },
    {
      name: "Musical Intelligence",
      description: "Gardner MI — Musical Domain",
      questions: [
        { id: 31, text: "I remember melodies and rhythms with ease" },
        { id: 32, text: "I notice structural patterns in music — beat, key, chord changes" },
        { id: 33, text: "I express myself through music, singing or an instrument" },
        { id: 34, text: "Background sound significantly affects my ability to concentrate" },
        { id: 35, text: "I connect specific emotions to pieces of music I know well" },
        { id: 36, text: "I can identify a song or piece of music from just a few notes" },
        { id: 37, text: "I enjoy composing, improvising or experimenting with sound" },
        { id: 38, text: "I tend to move, tap or hum along involuntarily when music is playing" },
        { id: 39, text: "I find music a useful tool for managing my mood or focus" },
        { id: 40, text: "I appreciate technical skill in musical performances" },
      ],
    },
    {
      name: "Bodily-Kinaesthetic Intelligence",
      description: "Gardner MI — Bodily-Kinaesthetic Domain",
      questions: [
        { id: 41, text: "I learn best through hands-on experiments and practical activities" },
        { id: 42, text: "I am skilled at sports, dance, drama or physical performance" },
        { id: 43, text: "I use natural hand gestures and movement when I explain things" },
        { id: 44, text: "I prefer labs, fieldwork and making things over reading theory" },
        { id: 45, text: "I pick up new physical skills — technique, movement patterns — quickly" },
        { id: 46, text: "I find it hard to absorb long lectures without something to do or make" },
        { id: 47, text: "I enjoy activities that involve skilled use of my hands — construction, crafts, instruments" },
        { id: 48, text: "I remember things better when I physically act them out or write them down" },
        { id: 49, text: "I am aware of my body posture and how it affects my mood and focus" },
        { id: 50, text: "I enjoy projects that involve real-world making or performance" },
      ],
    },
    {
      name: "Interpersonal Intelligence",
      description: "Gardner MI — Interpersonal Domain",
      questions: [
        { id: 51, text: "I work effectively in team projects and group discussions" },
        { id: 52, text: "I am skilled at reading people's moods and responding with sensitivity" },
        { id: 53, text: "I naturally take on a leadership or coordinating role in group work" },
        { id: 54, text: "I enjoy helping classmates who are struggling with a concept" },
        { id: 55, text: "I prefer studying and working through problems with a group" },
        { id: 56, text: "I notice quickly when someone in a group is disengaged or unhappy" },
        { id: 57, text: "I can adapt how I communicate depending on who I am speaking to" },
        { id: 58, text: "I resolve disagreements between peers calmly and fairly" },
        { id: 59, text: "I feel energised after collaborative work rather than drained" },
        { id: 60, text: "I enjoy social, community-based or service activities" },
      ],
    },
    {
      name: "Intrapersonal Intelligence",
      description: "Gardner MI — Intrapersonal Domain",
      questions: [
        { id: 61, text: "I actively reflect on my own strengths and areas to develop" },
        { id: 62, text: "I set personal academic goals and monitor my own progress" },
        { id: 63, text: "I am clearly aware of how my mood affects the quality of my work" },
        { id: 64, text: "I prefer working independently on deep or complex tasks" },
        { id: 65, text: "I stay motivated to learn even without external rewards or praise" },
        { id: 66, text: "I think carefully about why I reacted a certain way in a situation" },
        { id: 67, text: "I have a clear sense of what I value and what matters to me" },
        { id: 68, text: "I manage my emotional responses to frustration, failure or pressure" },
        { id: 69, text: "I take responsibility for my results rather than blaming external factors" },
        { id: 70, text: "I know when I need a break and when I am at my best for focused work" },
      ],
    },
    {
      name: "Naturalist Intelligence",
      description: "Gardner MI — Naturalist Domain",
      questions: [
        { id: 71, text: "I am genuinely curious about the natural world — ecology, biology, environment" },
        { id: 72, text: "I enjoy classifying and organising information into structured categories" },
        { id: 73, text: "I naturally connect classroom learning to real-world patterns and examples" },
        { id: 74, text: "I notice patterns in data sets, natural systems or complex environments" },
        { id: 75, text: "I am drawn to science, geography or environmental topics" },
        { id: 76, text: "I find satisfaction in identifying species, phenomena or phenomena by observation" },
        { id: 77, text: "I enjoy fieldwork, outdoor learning or science experiments in natural settings" },
        { id: 78, text: "I am attentive to environmental issues and think about causes and solutions" },
        { id: 79, text: "I enjoy working with data about the natural world — climate, biodiversity, ecosystems" },
        { id: 80, text: "I notice seasonal, ecological or biological changes in my surroundings" },
      ],
    },
    {
      name: "VARK Learning Style",
      description: "Fleming VARK Model — Learning Modality Preferences",
      questions: [
        { id: 81, text: "I learn best from reading detailed notes or textbooks", modality: "Read-Write" },
        { id: 82, text: "I retain information better when I write it out in my own words", modality: "Read-Write" },
        { id: 83, text: "I learn best by listening to clear explanations and discussions", modality: "Auditory" },
        { id: 84, text: "I use audio — recordings, podcasts, verbal recitation — to revise", modality: "Auditory" },
        { id: 85, text: "I understand concepts better through diagrams, charts and visual summaries", modality: "Visual" },
        { id: 86, text: "I create visual notes — mind maps, flowcharts, colour coding — to revise", modality: "Visual" },
        { id: 87, text: "I learn best through practicals, experiments and trying approaches out", modality: "Kinaesthetic" },
        { id: 88, text: "I remember things far better if I have done them rather than read about them", modality: "Kinaesthetic" },
        { id: 89, text: "I use a mix of methods depending on the subject or type of content", modality: "Multimodal" },
        { id: 90, text: "I consciously choose the learning channel that suits the specific task", modality: "Multimodal" },
      ],
    },
    {
      name: "Metacognition & Study Strategies",
      description: "Information Processing Theory | Flavell/Zimmerman Metacognition",
      questions: [
        { id: 91, text: "I plan my study session before I start — I know what I want to accomplish" },
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

// ─── Group D — Age 15+ (100 items, 10 dimensions × 10) ───

const GROUP_D: AgeGroupConfig = {
  ageGroup: 15,
  label: "Student (Age 15+)",
  model: "Big Five OCEAN · Holland RIASEC · DISC · VARK · Self-Determination Theory",
  respondent: "Self (independent)",
  totalQuestions: 100,
  maxScorePerDimension: 50,
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
      name: "Openness to Experience",
      description: "Big Five OCEAN — Openness Factor",
      questions: [
        { id: 1, text: "I actively seek out ideas and perspectives that challenge what I already believe" },
        { id: 2, text: "I am drawn to creative, imaginative and artistic work" },
        { id: 3, text: "I enjoy exploring unfamiliar subjects, cultures or ways of thinking" },
        { id: 4, text: "I find abstract and theoretical discussions intellectually stimulating" },
        { id: 5, text: "I become bored quickly with repetitive, routine work" },
        { id: 6, text: "I regularly consume content outside my immediate area of study or interest" },
        { id: 7, text: "I like approaching problems from unusual or unconventional angles" },
        { id: 8, text: "I am curious about philosophy, meaning and big unanswered questions" },
        { id: 9, text: "I enjoy creative writing, conceptual design or speculative thinking" },
        { id: 10, text: "I am excited by ambiguity and open questions rather than unsettled by them" },
      ],
    },
    {
      name: "Conscientiousness",
      description: "Big Five OCEAN — Conscientiousness Factor",
      questions: [
        { id: 11, text: "I plan my work systematically before I begin" },
        { id: 12, text: "I consistently meet deadlines without needing reminders" },
        { id: 13, text: "I keep my study space, notes and materials well organised" },
        { id: 14, text: "I follow through on commitments even when they become inconvenient" },
        { id: 15, text: "I review and improve my work critically before submitting it" },
        { id: 16, text: "I maintain consistent daily habits and routines" },
        { id: 17, text: "I set specific, measurable goals and track my own progress toward them" },
        { id: 18, text: "I avoid cutting corners even under time pressure" },
        { id: 19, text: "I notice and correct small errors in my own work proactively" },
        { id: 20, text: "I take responsibility for outcomes rather than attributing them to luck or others" },
      ],
    },
    {
      name: "Extraversion",
      description: "Big Five OCEAN — Extraversion Factor",
      questions: [
        { id: 21, text: "I feel energised and recharged after spending time in social groups" },
        { id: 22, text: "I am comfortable speaking up and presenting in front of an audience" },
        { id: 23, text: "I initiate conversations and introductions with new people naturally" },
        { id: 24, text: "I prefer collaborative working environments over solo work" },
        { id: 25, text: "I enjoy being at the centre of social activities and group events" },
        { id: 26, text: "I think through ideas better by talking them out with others" },
        { id: 27, text: "I volunteer to lead or present in group settings" },
        { id: 28, text: "I find social interactions easy and enjoyable rather than tiring" },
        { id: 29, text: "I seek out networking, group discussions and community involvement" },
        { id: 30, text: "I feel most motivated and productive when working alongside other people" },
      ],
    },
    {
      name: "Agreeableness",
      description: "Big Five OCEAN — Agreeableness Factor",
      questions: [
        { id: 31, text: "I consider the feelings and impact on others before I act or speak" },
        { id: 32, text: "I prefer finding common ground to winning an argument" },
        { id: 33, text: "I volunteer to help others without being asked or rewarded" },
        { id: 34, text: "I build trust with new people relatively quickly" },
        { id: 35, text: "I remain cooperative and collaborative even when I strongly disagree" },
        { id: 36, text: "I give people the benefit of the doubt in ambiguous situations" },
        { id: 37, text: "I avoid saying things that might hurt someone even when I am frustrated" },
        { id: 38, text: "I actively listen to others without interrupting or dismissing their views" },
        { id: 39, text: "I adjust my communication style to make others feel at ease" },
        { id: 40, text: "I feel uncomfortable when there is ongoing conflict in a group I belong to" },
      ],
    },
    {
      name: "Emotional Stability",
      description: "Big Five OCEAN — Neuroticism (Reversed) Factor",
      questions: [
        { id: 41, text: "I remain calm and composed under pressure, deadlines or uncertainty" },
        { id: 42, text: "I recover quickly from setbacks, criticism and disappointments" },
        { id: 43, text: "I avoid spending excessive time worrying about outcomes I cannot control" },
        { id: 44, text: "I manage my emotional responses well during high-stakes situations" },
        { id: 45, text: "I feel generally secure and confident in my own abilities" },
        { id: 46, text: "I can separate my emotional reaction from my rational response in difficult moments" },
        { id: 47, text: "I do not dwell on past mistakes beyond what is necessary to learn from them" },
        { id: 48, text: "I maintain perspective when things go wrong rather than catastrophising" },
        { id: 49, text: "I sleep and function well even when I have significant stress or responsibilities" },
        { id: 50, text: "I bounce back from failure with renewed determination rather than withdrawal" },
      ],
    },
    {
      name: "Holland RIASEC Career Types",
      description: "Holland RIASEC Model — Career Aptitude",
      questions: [
        { id: 51, text: "I enjoy practical, hands-on or technical work — building, repairing or making (Realistic)" },
        { id: 52, text: "I am good with tools, machinery, physical systems or technology (Realistic)" },
        { id: 53, text: "I enjoy investigating, researching and solving complex problems systematically (Investigative)" },
        { id: 54, text: "I am drawn to science, data analysis and evidence-based thinking (Investigative)" },
        { id: 55, text: "I enjoy creative expression — writing, art, music, film or design (Artistic)" },
        { id: 56, text: "I prefer open-ended tasks where I can express originality (Artistic)" },
        { id: 57, text: "I find deep satisfaction in helping, teaching or supporting other people (Social)" },
        { id: 58, text: "I am drawn to careers in healthcare, education, counselling or community work (Social)" },
        { id: 59, text: "I enjoy leading, persuading, negotiating and managing projects or teams (Enterprising)" },
        { id: 60, text: "I prefer structured, organised, rule-based tasks and administrative processes (Conventional)" },
      ],
    },
    {
      name: "DISC Behavioural Style",
      description: "DISC Model — Behavioural Tendencies",
      questions: [
        { id: 61, text: "In a group, I naturally step forward to take charge and set direction (Dominant)" },
        { id: 62, text: "I am direct, results-focused and decisive — I prefer action over discussion (Dominant)" },
        { id: 63, text: "I motivate others with enthusiasm, energy and an optimistic outlook (Influential)" },
        { id: 64, text: "I am persuasive, expressive and enjoy building relationships and influence (Influential)" },
        { id: 65, text: "I work steadily and reliably — patient, consistent, collaborative (Steady)" },
        { id: 66, text: "I am a trusted support to others — dependable, empathetic and loyal (Steady)" },
        { id: 67, text: "I focus intensely on accuracy, quality and getting details exactly right (Conscientious)" },
        { id: 68, text: "I analyse situations carefully before acting and hold myself to high standards (Conscientious)" },
        { id: 69, text: "I adapt my communication style significantly depending on who I am speaking to" },
        { id: 70, text: "I am aware of my own dominant behavioural style and its effect on others" },
      ],
    },
    {
      name: "VARK Learning Preference",
      description: "Fleming VARK Model — Learning Modality Preferences",
      questions: [
        { id: 71, text: "I understand new material best through careful reading and detailed note-taking", modality: "Read-Write" },
        { id: 72, text: "I produce written summaries, outlines or reformatted notes as my primary revision tool", modality: "Read-Write" },
        { id: 73, text: "I understand new material best by listening to explanations, lectures or podcasts", modality: "Auditory" },
        { id: 74, text: "I revise by talking through content aloud — alone or in a study group", modality: "Auditory" },
        { id: 75, text: "I understand new material best through diagrams, charts, concept maps and visuals", modality: "Visual" },
        { id: 76, text: "I create visual representations of information — colour-coded, mapped, illustrated", modality: "Visual" },
        { id: 77, text: "I understand new material best by doing — projects, experiments or real-world application", modality: "Kinaesthetic" },
        { id: 78, text: "I need concrete examples and practical experience before abstract theory makes sense", modality: "Kinaesthetic" },
        { id: 79, text: "I naturally draw on multiple channels depending on the subject or complexity", modality: "Multimodal" },
        { id: 80, text: "I consciously select the learning mode most suited to a specific task or subject", modality: "Multimodal" },
      ],
    },
    {
      name: "Academic & Career Orientation",
      description: "Career Aptitude — Academic Direction",
      questions: [
        { id: 81, text: "I am drawn to STEM subjects — science, technology, engineering, mathematics" },
        { id: 82, text: "I enjoy working with data, systems, code or technical problem-solving" },
        { id: 83, text: "I am drawn to humanities — literature, history, philosophy, languages" },
        { id: 84, text: "I find meaning in studying how societies, cultures and ideas have developed" },
        { id: 85, text: "I am drawn to creative fields — art, design, media, performing arts" },
        { id: 86, text: "I want a career that allows me to express originality and imagination daily" },
        { id: 87, text: "I am drawn to people-centred professions — medicine, teaching, counselling, law" },
        { id: 88, text: "I find meaning in careers that directly improve lives or serve communities" },
        { id: 89, text: "I am drawn to business, entrepreneurship and organisational leadership" },
        { id: 90, text: "I want to build, lead or scale something — a team, a company or a movement" },
      ],
    },
    {
      name: "Self-Regulation & Metacognition",
      description: "Self-Determination Theory | Metacognitive Awareness",
      questions: [
        { id: 91, text: "I identify my own learning gaps without needing a teacher to point them out" },
        { id: 92, text: "I actively seek feedback on my work and use it deliberately to improve" },
        { id: 93, text: "I can explain clearly why a specific strategy worked or failed for me" },
        { id: 94, text: "I set long-term academic goals and adjust short-term plans to stay on track" },
        { id: 95, text: "I take full ownership of my academic progress rather than depending on others" },
        { id: 96, text: "I regularly evaluate the effectiveness of my own study methods" },
        { id: 97, text: "I can sustain deep focus on difficult material without external accountability" },
        { id: 98, text: "I know which conditions — time of day, environment, approach — optimise my learning" },
        { id: 99, text: "I pursue topics beyond the curriculum because I am genuinely curious" },
        { id: 100, text: "I see academic setbacks as information and opportunities rather than as failures" },
      ],
    },
  ],
  get questions() {
    return this.dimensions.flatMap((d) => d.questions);
  },
};

// ─── Exports ───

export const AGE_GROUPS: AgeGroupConfig[] = [GROUP_A, GROUP_B, GROUP_C, GROUP_D];

export function getAgeGroupConfig(ageGroupOrAge: number): AgeGroupConfig | undefined {
  // Direct match by ageGroup value
  const direct = AGE_GROUPS.find((g) => g.ageGroup === ageGroupOrAge);
  if (direct) return direct;

  // Fallback: interpret as actual age
  if (ageGroupOrAge >= 3 && ageGroupOrAge < 5) return AGE_GROUPS.find((g) => g.ageGroup === 3);
  if (ageGroupOrAge >= 5 && ageGroupOrAge < 10) return AGE_GROUPS.find((g) => g.ageGroup === 5);
  if (ageGroupOrAge >= 10 && ageGroupOrAge < 15) return AGE_GROUPS.find((g) => g.ageGroup === 10);
  return AGE_GROUPS.find((g) => g.ageGroup === 15);
}

/** Helper to get the dimension a question belongs to */
export function getDimensionForQuestion(config: AgeGroupConfig, questionId: number): Dimension | undefined {
  return config.dimensions.find((d) => d.questions.some((q) => q.id === questionId));
}

/** Get the flat index of the first question in a dimension */
export function getDimensionStartIndex(config: AgeGroupConfig, dimensionIndex: number): number {
  let start = 0;
  for (let i = 0; i < dimensionIndex; i++) {
    start += config.dimensions[i].questions.length;
  }
  return start;
}
