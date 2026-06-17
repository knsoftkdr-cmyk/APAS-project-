export interface VarkOption {
  label: string;
  text: string;
  modality: "V" | "A" | "R" | "K" | "N";
}

export interface VarkQuestion {
  id: number;
  text: string;
  options: VarkOption[];
}

export interface VarkAgeGroupConfig {
  ageGroup: number;
  label: string;
  questions: VarkQuestion[];
}

export const VARK_AGE_GROUPS: VarkAgeGroupConfig[] = [
  {
    ageGroup: 3,
    label: "Child (Age 3–4)",
    questions: [
      {
        id: 1,
        text: "How do you like to learn a new game?",
        options: [
          { label: "A", text: "Watching someone else play it first", modality: "V" },
          { label: "B", text: "Listening to the instructions", modality: "A" },
          { label: "C", text: "Looking at the pictures on the box", modality: "R" },
          { label: "D", text: "Just grabbing the pieces and trying it", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 2,
        text: "When we read a book, what do you look at?",
        options: [
          { label: "A", text: "The colorful drawings", modality: "V" },
          { label: "B", text: "Your face while you speak", modality: "A" },
          { label: "C", text: "The letters and words", modality: "R" },
          { label: "D", text: "I like to turn the pages myself", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 3,
        text: "What is your favorite toy?",
        options: [
          { label: "A", text: "Picture puzzles or blocks", modality: "V" },
          { label: "B", text: "A toy phone or musical instrument", modality: "A" },
          { label: "C", text: "Alphabet blocks or letter magnets", modality: "R" },
          { label: "D", text: "A ball or a bike", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 4,
        text: "How do you show you are happy?",
        options: [
          { label: "A", text: "Drawing a happy face", modality: "V" },
          { label: "B", text: "Laughing or shouting", modality: "A" },
          { label: "C", text: 'Asking how to spell "Happy"', modality: "R" },
          { label: "D", text: "Jumping up and down", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 5,
        text: "When you see a dog, what do you do?",
        options: [
          { label: "A", text: "Look at its fur and color", modality: "V" },
          { label: "B", text: "Listen to it bark", modality: "A" },
          { label: "C", text: 'Point to the "D" on its collar', modality: "R" },
          { label: "D", text: "Try to pet it immediately", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 6,
        text: "In the car, what do you enjoy most?",
        options: [
          { label: "A", text: "Looking out the window", modality: "V" },
          { label: "B", text: "Listening to the radio", modality: "A" },
          { label: "C", text: "Looking at a book", modality: "R" },
          { label: "D", text: "Wiggling in your seat", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 7,
        text: "What is your favorite kind of TV show?",
        options: [
          { label: "A", text: "Bright cartoons", modality: "V" },
          { label: "B", text: "Shows with lots of singing", modality: "A" },
          { label: "C", text: "Shows that teach letters", modality: "R" },
          { label: "D", text: "Shows where people dance", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 8,
        text: "How do you remember a friend?",
        options: [
          { label: "A", text: "By what their face looks like", modality: "V" },
          { label: "B", text: "By the sound of their voice", modality: "A" },
          { label: "C", text: "By their name written on a cubby", modality: "R" },
          { label: "D", text: "By how they play with you", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 9,
        text: "When you are bored, you like to:",
        options: [
          { label: "A", text: "Look at a picture book", modality: "V" },
          { label: "B", text: "Talk to your toys", modality: "A" },
          { label: "C", text: 'Scribble "notes"', modality: "R" },
          { label: "D", text: "Run around the room", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 10,
        text: "How do you learn a new song?",
        options: [
          { label: "A", text: "Watching the singer's mouth", modality: "V" },
          { label: "B", text: "Listening to the tune", modality: "A" },
          { label: "C", text: "Looking at the lyrics in a book", modality: "R" },
          { label: "D", text: "Doing the hand motions", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 11,
        text: "When you go to the park, you go to:",
        options: [
          { label: "A", text: "The colorful playhouse", modality: "V" },
          { label: "B", text: "The noisy musical bells", modality: "A" },
          { label: "C", text: "The sign that has the rules", modality: "R" },
          { label: "D", text: "The slide or swings", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 12,
        text: "Which gift would you pick?",
        options: [
          { label: "A", text: "A box of crayons", modality: "V" },
          { label: "B", text: "A toy drum", modality: "A" },
          { label: "C", text: "A new storybook", modality: "R" },
          { label: "D", text: "A soft teddy bear to hug", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 13,
        text: "When you eat, you like:",
        options: [
          { label: "A", text: "Food that looks pretty", modality: "V" },
          { label: "B", text: 'Hearing the "crunch"', modality: "A" },
          { label: "C", text: "Reading the cereal box", modality: "R" },
          { label: "D", text: "Using your hands to eat", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 14,
        text: "How do you help clean up?",
        options: [
          { label: "A", text: "Watching where things go", modality: "V" },
          { label: "B", text: "Listening to directions", modality: "A" },
          { label: "C", text: "Finding labels on bins", modality: "R" },
          { label: "D", text: "Picking everything up", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 15,
        text: "What do you do with play-dough?",
        options: [
          { label: "A", text: "Make shapes that look like things", modality: "V" },
          { label: "B", text: "Talk about what you are making", modality: "A" },
          { label: "C", text: "Try to poke letters into it", modality: "R" },
          { label: "D", text: "Squish and roll it", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 16,
        text: "Favorite school activity?",
        options: [
          { label: "A", text: "Art and painting", modality: "V" },
          { label: "B", text: "Circle time/talking", modality: "A" },
          { label: "C", text: "Tracing letters", modality: "R" },
          { label: "D", text: "Playing outside", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 17,
        text: "If you see a bug, you:",
        options: [
          { label: "A", text: "Stare at it closely", modality: "V" },
          { label: "B", text: 'Ask "What is that noise?"', modality: "A" },
          { label: "C", text: "Ask what it is called", modality: "R" },
          { label: "D", text: "Try to catch it", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 18,
        text: "How do you choose a snack?",
        options: [
          { label: "A", text: "By the color of the package", modality: "V" },
          { label: "B", text: "By the sound of the crinkle", modality: "A" },
          { label: "C", text: "By the name on the box", modality: "R" },
          { label: "D", text: "By reaching for it", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 19,
        text: "When you are tired, you:",
        options: [
          { label: "A", text: "Watch a movie", modality: "V" },
          { label: "B", text: "Listen to a lullaby", modality: "A" },
          { label: "C", text: "Look at a book", modality: "R" },
          { label: "D", text: "Cuddle a blanket", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 20,
        text: "Your favorite game is:",
        options: [
          { label: "A", text: '"I Spy"', modality: "V" },
          { label: "B", text: '"Simon Says"', modality: "A" },
          { label: "C", text: '"The Alphabet Song"', modality: "R" },
          { label: "D", text: '"Hide and Seek"', modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
    ],
  },
  {
    ageGroup: 5,
    label: "Child (Age 5–9)",
    questions: [
      {
        id: 1,
        text: "How do you remember a phone number?",
        options: [
          { label: "A", text: "I see the numbers in my head", modality: "V" },
          { label: "B", text: "I say the numbers out loud", modality: "A" },
          { label: "C", text: "I write it down on paper", modality: "R" },
          { label: "D", text: "I remember the pattern of my fingers", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 2,
        text: "In class, you learn best when:",
        options: [
          { label: "A", text: "The teacher uses the board", modality: "V" },
          { label: "B", text: "The teacher tells a story", modality: "A" },
          { label: "C", text: "You read from a textbook", modality: "R" },
          { label: "D", text: "You do a science project", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 3,
        text: "For a birthday, you want:",
        options: [
          { label: "A", text: "A movie ticket", modality: "V" },
          { label: "B", text: "A new music speaker", modality: "A" },
          { label: "C", text: "A set of books", modality: "R" },
          { label: "D", text: "A sports ball or kit", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 4,
        text: "When you are happy, you:",
        options: [
          { label: "A", text: "Smile and look around", modality: "V" },
          { label: "B", text: "Hum or whistle", modality: "A" },
          { label: "C", text: "Write a note to someone", modality: "R" },
          { label: "D", text: "Clap your hands or dance", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 5,
        text: "How do you spell a hard word?",
        options: [
          { label: "A", text: "I try to see the word", modality: "V" },
          { label: "B", text: "I sound it out loud", modality: "A" },
          { label: "C", text: "I write it out to see if it's right", modality: "R" },
          { label: "D", text: "I trace the letters in the air", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 6,
        text: "During free time you enjoy:",
        options: [
          { label: "A", text: "Watching a video", modality: "V" },
          { label: "B", text: "Talking to friends", modality: "A" },
          { label: "C", text: "Reading a comic", modality: "R" },
          { label: "D", text: "Playing tag", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 7,
        text: "If you go to the zoo, you like:",
        options: [
          { label: "A", text: "Looking at the animals", modality: "V" },
          { label: "B", text: "Hearing the lions roar", modality: "A" },
          { label: "C", text: "Reading the info signs", modality: "R" },
          { label: "D", text: "Petting the goats", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 8,
        text: "When you are bored in class, you:",
        options: [
          { label: "A", text: "Doodle or draw", modality: "V" },
          { label: "B", text: "Whisper to a neighbor", modality: "A" },
          { label: "C", text: "Read ahead in the book", modality: "R" },
          { label: "D", text: "Fidget with your pencil", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 9,
        text: "To learn a new dance, you:",
        options: [
          { label: "A", text: "Watch the teacher", modality: "V" },
          { label: "B", text: "Listen to the beat", modality: "A" },
          { label: "C", text: "Read the step names", modality: "R" },
          { label: "D", text: "Just start moving", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 10,
        text: "Your favorite part of school is:",
        options: [
          { label: "A", text: "Art class", modality: "V" },
          { label: "B", text: "Music class", modality: "A" },
          { label: "C", text: "Library time", modality: "R" },
          { label: "D", text: "Gym class", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 11,
        text: "When you meet someone new, you remember:",
        options: [
          { label: "A", text: "What they wore", modality: "V" },
          { label: "B", text: "Their voice", modality: "A" },
          { label: "C", text: "Their name", modality: "R" },
          { label: "D", text: "Their handshake/hug", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 12,
        text: "How do you help bake a cake?",
        options: [
          { label: "A", text: "Watching the colors change", modality: "V" },
          { label: "B", text: "Listening for the timer", modality: "A" },
          { label: "C", text: "Reading the recipe", modality: "R" },
          { label: "D", text: "Stirring the bowl", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 13,
        text: "In a museum, you like:",
        options: [
          { label: "A", text: "The paintings", modality: "V" },
          { label: "B", text: "The audio guides", modality: "A" },
          { label: "C", text: "The labels on the walls", modality: "R" },
          { label: "D", text: 'The "Touch and Feel" area', modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 14,
        text: "If you have a problem, you:",
        options: [
          { label: "A", text: "Look for a solution", modality: "V" },
          { label: "B", text: "Talk it over", modality: "A" },
          { label: "C", text: "Write a list of ideas", modality: "R" },
          { label: "D", text: "Walk around to think", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 15,
        text: "To memorize a poem, you:",
        options: [
          { label: "A", text: "Look at the lines", modality: "V" },
          { label: "B", text: "Say it over and over", modality: "A" },
          { label: "C", text: "Write it out", modality: "R" },
          { label: "D", text: "Walk while reciting it", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 16,
        text: "Favorite kind of puzzle?",
        options: [
          { label: "A", text: "Jigsaw puzzles", modality: "V" },
          { label: "B", text: "Musical puzzles", modality: "A" },
          { label: "C", text: "Word searches", modality: "R" },
          { label: "D", text: "Rubik's cube", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 17,
        text: "When you get a new LEGO set, you:",
        options: [
          { label: "A", text: "Look at the pictures", modality: "V" },
          { label: "B", text: "Ask someone how to do it", modality: "A" },
          { label: "C", text: "Read the instructions", modality: "R" },
          { label: "D", text: "Start building", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 18,
        text: "To tell a secret, you:",
        options: [
          { label: "A", text: "Show a picture", modality: "V" },
          { label: "B", text: "Whisper it", modality: "A" },
          { label: "C", text: "Write a note", modality: "R" },
          { label: "D", text: "Pull them into a corner", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 19,
        text: "You like teachers who:",
        options: [
          { label: "A", text: "Use lots of pictures", modality: "V" },
          { label: "B", text: "Tell funny stories", modality: "A" },
          { label: "C", text: "Give lots of handouts", modality: "R" },
          { label: "D", text: "Let you move around", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 20,
        text: "When you go to sleep, you like:",
        options: [
          { label: "A", text: "A nightlight", modality: "V" },
          { label: "B", text: "A white noise machine", modality: "A" },
          { label: "C", text: "A bedtime story", modality: "R" },
          { label: "D", text: "A heavy blanket", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
    ],
  },
  {
    ageGroup: 10,
    label: "Student (Age 10–14)",
    questions: [
      {
        id: 1,
        text: "How do you learn how to play a video game?",
        options: [
          { label: "A", text: "Watching a YouTube walk-through", modality: "V" },
          { label: "B", text: "Listening to a friend's advice", modality: "A" },
          { label: "C", text: "Reading the tutorial text", modality: "R" },
          { label: "D", text: "Just playing and failing until I get it", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 2,
        text: "When studying, you use:",
        options: [
          { label: "A", text: "Highlighters and colors", modality: "V" },
          { label: "B", text: "A recording of the lesson", modality: "A" },
          { label: "C", text: "Printed study guides", modality: "R" },
          { label: "D", text: "Flashcards I can move", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 3,
        text: "In a group project, you are the one who:",
        options: [
          { label: "A", text: "Makes the poster/slides", modality: "V" },
          { label: "B", text: "Does the talking/presenting", modality: "A" },
          { label: "C", text: "Writes the report", modality: "R" },
          { label: "D", text: "Builds the model", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 4,
        text: "When you are confused in class, you:",
        options: [
          { label: "A", text: "Look at the textbook pictures", modality: "V" },
          { label: "B", text: "Ask the teacher to repeat it", modality: "A" },
          { label: "C", text: "Read your notes again", modality: "R" },
          { label: "D", text: "Try to do an example", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 5,
        text: "How do you spend your weekend?",
        options: [
          { label: "A", text: "Watching movies", modality: "V" },
          { label: "B", text: "Listening to music", modality: "A" },
          { label: "C", text: "Reading a book or blog", modality: "R" },
          { label: "D", text: "Playing sports/DIY", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 6,
        text: "To remember a task, you:",
        options: [
          { label: "A", text: "Imagine yourself doing it", modality: "V" },
          { label: "B", text: "Tell yourself out loud", modality: "A" },
          { label: "C", text: "Write it in a planner", modality: "R" },
          { label: "D", text: "Put an object in your way to remind you", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 7,
        text: "Your favorite subject is:",
        options: [
          { label: "A", text: "Geometry/Art", modality: "V" },
          { label: "B", text: "Languages/Debate", modality: "A" },
          { label: "C", text: "English/History", modality: "R" },
          { label: "D", text: "PE/Science Lab", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 8,
        text: "When you get a new phone, you:",
        options: [
          { label: "A", text: "Look at the screen icons", modality: "V" },
          { label: "B", text: "Listen to the ringtones", modality: "A" },
          { label: "C", text: "Read the digital manual", modality: "R" },
          { label: "D", text: "Just start clicking things", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 9,
        text: "In a library, you look for:",
        options: [
          { label: "A", text: "Graphic novels", modality: "V" },
          { label: "B", text: "Audiobooks", modality: "A" },
          { label: "C", text: "Non-fiction/Novels", modality: "R" },
          { label: "D", text: "Science experiment books", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 10,
        text: "To relax, you prefer:",
        options: [
          { label: "A", text: "Scrolling social media", modality: "V" },
          { label: "B", text: "Calling a friend", modality: "A" },
          { label: "C", text: "Writing in a journal", modality: "R" },
          { label: "D", text: "Going for a walk", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 11,
        text: "When you follow directions, you prefer:",
        options: [
          { label: "A", text: "A map", modality: "V" },
          { label: "B", text: "Someone telling you", modality: "A" },
          { label: "C", text: "Written steps", modality: "R" },
          { label: "D", text: "Being shown the way", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 12,
        text: "In a movie, you notice:",
        options: [
          { label: "A", text: "The costumes and scenery", modality: "V" },
          { label: "B", text: "The music and sound", modality: "A" },
          { label: "C", text: "The plot and dialogue", modality: "R" },
          { label: "D", text: "The action scenes", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 13,
        text: "How do you study vocabulary?",
        options: [
          { label: "A", text: "Seeing the word in a sentence", modality: "V" },
          { label: "B", text: "Saying the word out loud", modality: "A" },
          { label: "C", text: "Writing the word 5 times", modality: "R" },
          { label: "D", text: "Using hand signs for the word", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 14,
        text: "When you describe a trip, you talk about:",
        options: [
          { label: "A", text: "The beautiful sights", modality: "V" },
          { label: "B", text: "The interesting sounds/music", modality: "A" },
          { label: "C", text: "The things you read/learned", modality: "R" },
          { label: "D", text: "The things you did/activities", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 15,
        text: "In class, you get distracted by:",
        options: [
          { label: "A", text: "Things moving outside", modality: "V" },
          { label: "B", text: "Noises in the hallway", modality: "A" },
          { label: "C", text: "Other people's notes", modality: "R" },
          { label: "D", text: "Feeling uncomfortable in your chair", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 16,
        text: "You prefer teachers who:",
        options: [
          { label: "A", text: "Use diagrams", modality: "V" },
          { label: "B", text: "Use clear speech", modality: "A" },
          { label: "C", text: "Give long reading lists", modality: "R" },
          { label: "D", text: "Give hands-on work", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 17,
        text: "If you are angry, you:",
        options: [
          { label: "A", text: "Scowl or look away", modality: "V" },
          { label: "B", text: "Argue or shout", modality: "A" },
          { label: "C", text: "Write an angry text", modality: "R" },
          { label: "D", text: "Slam a door or walk off", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 18,
        text: "To choose a meal, you:",
        options: [
          { label: "A", text: "Look at the photo", modality: "V" },
          { label: "B", text: "Ask the waiter for ideas", modality: "A" },
          { label: "C", text: "Read the menu description", modality: "R" },
          { label: "D", text: "Think about the texture", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 19,
        text: "How do you feel about tests?",
        options: [
          { label: "A", text: "I like visual questions", modality: "V" },
          { label: "B", text: "I like oral exams", modality: "A" },
          { label: "C", text: "I like essay questions", modality: "R" },
          { label: "D", text: "I like practical tests", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 20,
        text: "Your room is full of:",
        options: [
          { label: "A", text: "Posters and pictures", modality: "V" },
          { label: "B", text: "Speakers and instruments", modality: "A" },
          { label: "C", text: "Books and magazines", modality: "R" },
          { label: "D", text: "Sports gear and tools", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
    ],
  },
  {
    ageGroup: 15,
    label: "Student (Age 15+)",
    questions: [
      {
        id: 1,
        text: "You are learning a new software program. You:",
        options: [
          { label: "A", text: "Look at screenshots", modality: "V" },
          { label: "B", text: "Join a live webinar", modality: "A" },
          { label: "C", text: "Read the documentation", modality: "R" },
          { label: "D", text: 'Use the "Trial" version', modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 2,
        text: "In a presentation, you hate it when:",
        options: [
          { label: "A", text: "There are no visuals", modality: "V" },
          { label: "B", text: "The speaker's voice is boring", modality: "A" },
          { label: "C", text: "There is no handout", modality: "R" },
          { label: "D", text: "You have to sit still too long", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 3,
        text: "When you are lost, you:",
        options: [
          { label: "A", text: "Open Google Maps", modality: "V" },
          { label: "B", text: "Call someone for help", modality: "A" },
          { label: "C", text: "Look for a street index", modality: "R" },
          { label: "D", text: "Drive around until it looks familiar", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 4,
        text: "To remember a meeting, you:",
        options: [
          { label: "A", text: "See the calendar invite", modality: "V" },
          { label: "B", text: "Set an audio alarm", modality: "A" },
          { label: "C", text: "Write it in a diary", modality: "R" },
          { label: "D", text: "Associate it with a physical place", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 5,
        text: "You prefer a boss who:",
        options: [
          { label: "A", text: "Shows you what to do", modality: "V" },
          { label: "B", text: "Discusses things with you", modality: "A" },
          { label: "C", text: "Sends clear emails", modality: "R" },
          { label: "D", text: "Lets you do it yourself", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 6,
        text: "When you buy a gift, you look at:",
        options: [
          { label: "A", text: "How it is wrapped", modality: "V" },
          { label: "B", text: "What the salesperson says", modality: "A" },
          { label: "C", text: "The reviews/specs", modality: "R" },
          { label: "D", text: "How heavy/sturdy it feels", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 7,
        text: "To learn a new language, you:",
        options: [
          { label: "A", text: "Watch movies in that language", modality: "V" },
          { label: "B", text: "Listen to audio tapes", modality: "A" },
          { label: "C", text: "Use a textbook", modality: "R" },
          { label: "D", text: "Go to the country and speak it", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 8,
        text: "In a museum, you spend time:",
        options: [
          { label: "A", text: "Looking at the exhibits", modality: "V" },
          { label: "B", text: "Listening to the tour guide", modality: "A" },
          { label: "C", text: "Reading every plaque", modality: "R" },
          { label: "D", text: "Doing the interactive parts", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 9,
        text: "When you are stressed, you:",
        options: [
          { label: "A", text: "Watch a show", modality: "V" },
          { label: "B", text: "Listen to music", modality: "A" },
          { label: "C", text: "Read a book", modality: "R" },
          { label: "D", text: "Go to the gym", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 10,
        text: "In a meeting, you usually:",
        options: [
          { label: "A", text: "Watch the speaker", modality: "V" },
          { label: "B", text: "Take part in the debate", modality: "A" },
          { label: "C", text: "Take lots of notes", modality: "R" },
          { label: "D", text: "Tap your pen or move", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 11,
        text: "To follow a recipe, you:",
        options: [
          { label: "A", text: "Look at the photo", modality: "V" },
          { label: "B", text: "Watch a cooking video", modality: "A" },
          { label: "C", text: "Read the steps", modality: "R" },
          { label: "D", text: "Taste as you go", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 12,
        text: "Your favorite way to shop is:",
        options: [
          { label: "A", text: "Browsing for ideas", modality: "V" },
          { label: "B", text: "Hearing recommendations", modality: "A" },
          { label: "C", text: "Comparing prices/labels", modality: "R" },
          { label: "D", text: "Trying things on", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 13,
        text: "To solve a tech problem, you:",
        options: [
          { label: "A", text: "Look for a diagram", modality: "V" },
          { label: "B", text: "Call tech support", modality: "A" },
          { label: "C", text: "Search for a forum thread", modality: "R" },
          { label: "D", text: "Pull it apart to see", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 14,
        text: "In a long talk, you remember:",
        options: [
          { label: "A", text: "The slides", modality: "V" },
          { label: "B", text: "The jokes/stories", modality: "A" },
          { label: "C", text: "The data/stats", modality: "R" },
          { label: "D", text: 'The "vibe" of the talk', modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 15,
        text: "To explain a concept, you:",
        options: [
          { label: "A", text: "Draw a picture", modality: "V" },
          { label: "B", text: "Give a verbal analogy", modality: "A" },
          { label: "C", text: "Write a summary", modality: "R" },
          { label: "D", text: "Use an object to demonstrate", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 16,
        text: "You enjoy social media for:",
        options: [
          { label: "A", text: "The photos/videos", modality: "V" },
          { label: "B", text: "The audio/podcasts", modality: "A" },
          { label: "C", text: "The articles/comments", modality: "R" },
          { label: "D", text: "The interactive polls", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 17,
        text: "If you are a student, you like:",
        options: [
          { label: "A", text: "Charts and graphs", modality: "V" },
          { label: "B", text: "Lectures and seminars", modality: "A" },
          { label: "C", text: "Essays and research", modality: "R" },
          { label: "D", text: "Workshops and labs", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 18,
        text: "When planning a trip, you:",
        options: [
          { label: "A", text: "Look at Instagram photos", modality: "V" },
          { label: "B", text: "Ask friends for stories", modality: "A" },
          { label: "C", text: "Read travel blogs/guides", modality: "R" },
          { label: "D", text: "Check out activities/tours", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 19,
        text: "How do you remember a person?",
        options: [
          { label: "A", text: "Their face", modality: "V" },
          { label: "B", text: "Their voice", modality: "A" },
          { label: "C", text: "Their business card", modality: "R" },
          { label: "D", text: "Their energy/presence", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
      {
        id: 20,
        text: "To get motivated, you:",
        options: [
          { label: "A", text: "Look at a vision board", modality: "V" },
          { label: "B", text: "Listen to a speech", modality: "A" },
          { label: "C", text: "Write down goals", modality: "R" },
          { label: "D", text: "Get up and move", modality: "K" },
          { label: "E", text: "Not sure", modality: "N" },
        ],
      },
    ],
  },
];

export function getVarkAgeGroupConfig(ageGroup: number): VarkAgeGroupConfig | undefined {
  return VARK_AGE_GROUPS.find((g) => g.ageGroup === ageGroup);
}
