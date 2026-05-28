export interface QuizQuestion {
  question: string;
  options: string[];
  answer: string;
}

export interface ScrambleItem {
  word: string;
  hint: string;
}

export interface MatchPairItem {
  item1: string;
  item2: string;
}

export interface CategoryGroup {
  name: string;
  items: string[];
}

export interface ClassSubjectContent {
  quizzes: QuizQuestion[];
  scrambles: ScrambleItem[];
  pairs: MatchPairItem[];
  categories: CategoryGroup[];
}

export const CLASS_WISE_CONTENT_POOL: Record<string, Record<string, ClassSubjectContent>> = {
  // ═══════════════════════════════════════════════════════════
  // EARLY YEARS (NURSERY, LKG, UKG)
  // ═══════════════════════════════════════════════════════════
  nursery: {
    english: {
      quizzes: [
        { question: "Which letter is for 'Apple'?", options: ["A", "B", "C", "D"], answer: "A" },
        { question: "What sound does a cow make?", options: ["Meow", "Moo", "Bark", "Oink"], answer: "Moo" }
      ],
      scrambles: [{ word: "CAT", hint: "A small pet animal that meows" }],
      pairs: [{ item1: "A", item2: "a" }],
      categories: [{ name: "Letters", items: ["A", "B", "C"] }, { name: "Numbers", items: ["1", "2", "3"] }]
    },
    maths: {
      quizzes: [{ question: "How many fingers do you have on one hand?", options: ["2", "5", "10", "4"], answer: "5" }],
      scrambles: [{ word: "ONE", hint: "The very first number" }],
      pairs: [{ item1: "🔵", item2: "Circle" }],
      categories: [{ name: "Big", items: ["Elephant", "Bus"] }, { name: "Small", items: ["Ant", "Pin"] }]
    }
  },
  lkg: {
    english: {
      quizzes: [{ question: "What is the missing letter: A, B, __, D?", options: ["E", "C", "F", "M"], answer: "C" }],
      scrambles: [{ word: "BALL", hint: "Something round you bounce and kick" }],
      pairs: [{ item1: "Big", item2: "Small" }],
      categories: [{ name: "Animals", items: ["Lion", "Dog"] }, { name: "Fruits", items: ["Mango", "Banana"] }]
    },
    maths: {
      quizzes: [{ question: "What number comes after 2?", options: ["1", "3", "4", "5"], answer: "3" }],
      scrambles: [{ word: "TWO", hint: "Number of eyes you have" }],
      pairs: [{ item1: "🔺", item2: "Triangle" }],
      categories: [{ name: "Shapes", items: ["Square", "Circle"] }, { name: "Colors", items: ["Red", "Blue"] }]
    }
  },
  ukg: {
    english: {
      quizzes: [{ question: "Which word starts with the 'S' sound?", options: ["Apple", "Sun", "Cat", "Dog"], answer: "Sun" }],
      scrambles: [{ word: "FISH", hint: "It swims underwater in rivers" }],
      pairs: [{ item1: "Boy", item2: "Girl" }],
      categories: [{ name: "Rhyming Words", items: ["Cat/Hat", "Bat/Mat"] }, { name: "Non-Rhyming", items: ["Sun/Dog", "Pen/Car"] }]
    },
    maths: {
      quizzes: [{ question: "What is 1 + 1?", options: ["1", "2", "3", "4"], answer: "2" }],
      scrambles: [{ word: "FIVE", hint: "Number of toes on one foot" }],
      pairs: [{ item1: "⭐⭐", item2: "2 Stars" }],
      categories: [{ name: "Count 1-5", items: ["2", "4"] }, { name: "Count 6-10", items: ["7", "9"] }]
    }
  },
  "1": {
    english: {
      quizzes: [
        { question: "Which letter comes after 'C'?", options: ["B", "D", "E", "A"], answer: "D" },
        { question: "Identify the vowel in the options:", options: ["B", "X", "E", "M"], answer: "E" },
        { question: "Which word is a naming word (Noun)?", options: ["Run", "Apple", "Fast", "Under"], answer: "Apple" }
      ],
      scrambles: [
        { word: "APPLE", hint: "A sweet red or green fruit" },
        { word: "BOOK", hint: "Something you read to learn" },
        { word: "CHAIR", hint: "Something you sit on" }
      ],
      pairs: [
        { item1: "Dog", item2: "Puppy" },
        { item1: "Cat", item2: "Kitten" },
        { item1: "Cow", item2: "Calf" }
      ],
      categories: [
        { name: "Vowels", items: ["A", "E", "I", "O", "U"] },
        { name: "Consonants", items: ["B", "C", "D", "F", "G"] }
      ]
    },
    maths: {
      quizzes: [
        { question: "What is 2 + 3?", options: ["4", "5", "6", "3"], answer: "5" },
        { question: "What shape has 3 sides?", options: ["Square", "Circle", "Triangle", "Star"], answer: "Triangle" },
        { question: "What number comes before 10?", options: ["8", "9", "11", "7"], answer: "9" }
      ],
      scrambles: [
        { word: "THREE", hint: "The number after 2" },
        { word: "PLUS", hint: "Sign used for addition (+)" },
        { word: "SHAPE", hint: "Circle, Square, or Triangle" }
      ],
      pairs: [
        { item1: "1 + 1", item2: "2" },
        { item1: "2 + 2", item2: "4" },
        { item1: "5 + 0", item2: "5" }
      ],
      categories: [
        { name: "Numbers", items: ["1", "5", "12", "20"] },
        { name: "Shapes", items: ["Circle", "Square", "Triangle", "Oval"] }
      ]
    },
    science: {
      quizzes: [
        { question: "Which part of a plant grows under the ground?", options: ["Leaf", "Stem", "Root", "Flower"], answer: "Root" },
        { question: "Which animal lays eggs?", options: ["Dog", "Hen", "Cat", "Cow"], answer: "Hen" },
        { question: "What is the main source of light on Earth during the day?", options: ["Moon", "Sun", "Bulb", "Fire"], answer: "Sun" }
      ],
      scrambles: [
        { word: "PLANT", hint: "It has green leaves and roots" },
        { word: "WATER", hint: "Fish need this to swim in" },
        { word: "LIGHT", hint: "The sun gives us this" }
      ],
      pairs: [
        { item1: "Sun", item2: "Day" },
        { item1: "Moon", item2: "Night" },
        { item1: "Rain", item2: "Clouds" }
      ],
      categories: [
        { name: "Living Things", items: ["Bird", "Tree", "Fish", "Human"] },
        { name: "Non-Living", items: ["Rock", "Toy Car", "Pen", "Chair"] }
      ]
    }
  },
  "2": {
    english: {
      quizzes: [
        { question: "What is the opposite of 'Heavy'?", options: ["Big", "Light", "Hard", "Soft"], answer: "Light" },
        { question: "Choose the correct action word (Verb):", options: ["Jumping", "Beautiful", "Kakinada", "Softly"], answer: "Jumping" }
      ],
      scrambles: [
        { word: "SCHOOL", hint: "A place where kids go to learn" },
        { word: "DOCTOR", hint: "A person who helps sick people" }
      ],
      pairs: [
        { item1: "Hot", item2: "Cold" },
        { item1: "Happy", item2: "Sad" }
      ],
      categories: [
        { name: "Nouns", items: ["Tiger", "Pen", "Rahul", "Hyderabad"] },
        { name: "Verbs", items: ["Jump", "Sing", "Read", "Write"] }
      ]
    },
    maths: {
      quizzes: [
        { question: "What is 10 - 4?", options: ["5", "6", "7", "8"], answer: "6" },
        { question: "What number comes next: 2, 4, 6, 8, __?", options: ["9", "10", "11", "12"], answer: "10" }
      ],
      scrambles: [
        { word: "EIGHT", hint: "Double of four" },
        { word: "MINUS", hint: "Operation used for subtraction" }
      ],
      pairs: [
        { item1: "5 + 5", item2: "10" },
        { item1: "10 - 3", item2: "7" }
      ],
      categories: [
        { name: "Even Numbers", items: ["2", "6", "14", "22"] },
        { name: "Odd Numbers", items: ["3", "7", "11", "19"] }
      ]
    },
    science: {
      quizzes: [
        { question: "Which bird cannot fly?", options: ["Sparrow", "Ostrich", "Parrot", "Eagle"], answer: "Ostrich" },
        { question: "How many sense organs do humans have?", options: ["3", "4", "5", "6"], answer: "5" }
      ],
      scrambles: [
        { word: "OXYGEN", hint: "The gas we breathe in to live" },
        { word: "DESERT", hint: "A very dry, sandy ecosystem place" }
      ],
      pairs: [
        { item1: "Eyes", item2: "Sight" },
        { item1: "Ears", item2: "Hearing" }
      ],
      categories: [
        { name: "Herbivores", items: ["Cow", "Rabbit", "Deer", "Elephant"] },
        { name: "Carnivores", items: ["Lion", "Tiger", "Wolf", "Leopard"] }
      ]
    }
  },
  "3": {
    english: {
      quizzes: [{ question: "What is the plural form of 'Child'?", options: ["Childs", "Childrens", "Children", "Childes"], answer: "Children" }],
      scrambles: [{ word: "BEAUTIFUL", hint: "Extremely pretty or attractive" }],
      pairs: [{ item1: "Always", item2: "Never" }],
      categories: [{ name: "Synonyms", items: ["Big/Large", "Fast/Quick"] }, { name: "Antonyms", items: ["Rich/Poor", "Up/Down"] }]
    },
    maths: {
      quizzes: [{ question: "What is 5 multiplied by 6?", options: ["25", "30", "35", "40"], answer: "30" }],
      scrambles: [{ word: "FRACTION", hint: "Part of a whole number fraction structure" }],
      pairs: [{ item1: "3 x 4", item2: "12" }],
      categories: [{ name: "Multiples of 5", items: ["5", "15", "25", "50"] }, { name: "Multiples of 3", items: ["3", "9", "18", "27"] }]
    },
    science: {
      quizzes: [{ question: "Which planet is closest to the Sun?", options: ["Earth", "Mars", "Mercury", "Venus"], answer: "Mercury" }],
      scrambles: [{ word: "PHOTOSYNTHESIS", hint: "Process used by plants to convert light to food" }],
      pairs: [{ item1: "Water", item2: "Liquid" }],
      categories: [{ name: "Solids", items: ["Ice", "Wood", "Iron"] }, { name: "Gases", items: ["Steam", "Oxygen", "Helium"] }]
    },
    social: {
      quizzes: [{ question: "Which is the largest ocean on Earth?", options: ["Atlantic", "Indian", "Pacific", "Arctic"], answer: "Pacific" }],
      scrambles: [{ word: "GLOBE", hint: "A spherical miniature model of Earth" }],
      pairs: [{ item1: "India", item2: "New Delhi" }],
      categories: [{ name: "Continents", items: ["Asia", "Africa", "Europe"] }, { name: "Oceans", items: ["Pacific", "Atlantic", "Indian"] }]
    }
  },
  "4": {
    english: {
      quizzes: [{ question: "Identify the conjunction in this list:", options: ["But", "Running", "Softly", "Under"], answer: "But" }],
      scrambles: [{ word: "LANGUAGE", hint: "System of communication using spoken/written words" }],
      pairs: [{ item1: "Write", item2: "Written" }],
      categories: [{ name: "Adjectives", items: ["Tall", "Smart", "Heavy"] }, { name: "Adverbs", items: ["Quickly", "Happily", "Slowly"] }]
    },
    maths: {
      quizzes: [{ question: "What is 120 divided by 4?", options: ["20", "25", "30", "35"], answer: "30" }],
      scrambles: [{ word: "GEOMETRY", hint: "Branch of mathematics dealing with points, lines, angles" }],
      pairs: [{ item1: "100 / 5", item2: "20" }],
      categories: [{ name: "Prime Numbers", items: ["2", "3", "5", "7"] }, { name: "Composite", items: ["4", "6", "8", "9"] }]
    },
    science: {
      quizzes: [{ question: "Water boils at what temperature?", options: ["50°C", "90°C", "100°C", "120°C"], answer: "100°C" }],
      scrambles: [{ word: "EVAPORATION", hint: "Liquid phase turning into vapor gas process" }],
      pairs: [{ item1: "Force", item2: "Newton" }],
      categories: [{ name: "Invertebrates", items: ["Worm", "Spider", "Ant"] }, { name: "Vertebrates", items: ["Fish", "Frog", "Bird"] }]
    },
    social: {
      quizzes: [{ question: "Who was the first President of India?", options: ["Dr. Rajendra Prasad", "Mahatma Gandhi", "Nehru", "Ambedkar"], answer: "Dr. Rajendra Prasad" }],
      scrambles: [{ word: "HISTORY", hint: "The study of documented past events" }],
      pairs: [{ item1: "Rupee", item2: "India" }],
      categories: [{ name: "Monuments", items: ["Taj Mahal", "Red Fort"] }, { name: "Rivers", items: ["Ganga", "Yamuna"] }]
    }
  },
  "5": {
    english: {
      quizzes: [{ question: "Choose the correct pronoun: 'Rahul and ___ went to the market.'", options: ["Me", "I", "Us", "Them"], answer: "I" }],
      scrambles: [{ word: "VOCABULARY", hint: "The complete body of words used in a language" }],
      pairs: [{ item1: "Break", item2: "Broke" }],
      categories: [{ name: "Prefixes", items: ["Un-", "Dis-", "Re-"] }, { name: "Suffixes", items: ["-ful", "-less", "-ly"] }]
    },
    maths: {
      quizzes: [{ question: "What is the perimeter of a square with a side length of 5cm?", options: ["15cm", "20cm", "25cm", "30cm"], answer: "20cm" }],
      scrambles: [{ word: "PERIMETER", hint: "The outer boundary track line of a closed shape" }],
      pairs: [{ item1: "Area of 5x4 Rect", item2: "20" }],
      categories: [{ name: "Acute Angles", items: ["30°", "45°", "60°"] }, { name: "Oblique Angles", items: ["95°", "110°", "130°"] }]
    },
    science: {
      quizzes: [{ question: "Which organ pumps blood throughout the entire human body?", options: ["Lungs", "Brain", "Heart", "Liver"], answer: "Heart" }],
      scrambles: [{ word: "SATELLITE", hint: "An object placed in orbit round a celestial body" }],
      pairs: [{ item1: "Force", item2: "Push or Pull" }],
      categories: [{ name: "Renewable Energy", items: ["Solar", "Wind", "Hydro"] }, { name: "Non-Renewable", items: ["Coal", "Petroleum", "Gas"] }]
    },
    social: {
      quizzes: [{ question: "Which imaginary line separates Earth into Northern and Southern Hemispheres?", options: ["Equator", "Tropics", "Prime Meridian", "Longitude"], answer: "Equator" }],
      scrambles: [{ word: "DEMOCRACY", hint: "System of government run by elected representatives" }],
      pairs: [{ item1: "Forest", item2: "Oxygen Production" }],
      categories: [{ name: "Renewable", items: ["Water", "Forest"] }, { name: "Minerals", items: ["Gold", "Iron", "Coal"] }]
    }
  }
};

export function fetchClassWiseContent(studentClass: string, rawSubject: string): ClassSubjectContent {
  const normalizedClass = studentClass || "1";
  const normalizedSubject = (rawSubject || "english").toLowerCase().trim();

  const targetClass = CLASS_WISE_CONTENT_POOL[normalizedClass] || CLASS_WISE_CONTENT_POOL["1"];
  return targetClass[normalizedSubject] || targetClass["english"];
}