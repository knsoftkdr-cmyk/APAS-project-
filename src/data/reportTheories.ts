// Theory-based question-to-dimension mappings for each age group
// Group 1 (Age 3): Piaget's Preoperational + Erikson's Psychosocial
// Group 2 (Age 5): Gardner's MI + School Readiness
// Group 3 (Age 10): Advanced MI + Information Processing
// Group 4 (Age 15): Big Five (OCEAN) + Holland's RIASEC + DISC

export interface DimensionMapping {
  dimension: string;
  theory: string;
  questionIds: number[];
  description: string;
  highDescription: string;
  lowDescription: string;
}

export interface AgeGroupReport {
  ageGroup: number;
  title: string;
  theories: string[];
  dimensions: DimensionMapping[];
}

export const AGE_GROUP_REPORTS: AgeGroupReport[] = [
  {
    ageGroup: 3,
    title: "Developmental Psychology Report",
    theories: ["Piaget's Preoperational Stage", "Erikson's Initiative vs. Guilt"],
    dimensions: [
      {
        dimension: "Language Development",
        theory: "Piaget — Symbolic Function",
        questionIds: [2, 11, 22, 23, 24],
        description: "Ability to use and understand language, a core feature of Piaget's Preoperational Stage.",
        highDescription: "Strong symbolic language development. The child actively uses words, repeats language, asks questions, and engages with stories — indicators of advanced preoperational thinking.",
        lowDescription: "Language development needs support. Encourage more verbal interaction, storytelling, and naming activities to strengthen symbolic representation.",
      },
      {
        dimension: "Cognitive Development",
        theory: "Piaget — Schema Building",
        questionIds: [3, 4, 10, 25, 26],
        description: "Cognitive abilities including following instructions, identifying concepts, and showing curiosity — key schema-building activities.",
        highDescription: "Active schema construction observed. The child demonstrates strong cognitive engagement through curiosity, recognition, and ability to follow instructions.",
        lowDescription: "Cognitive engagement is developing. Provide more hands-on exploration, sorting activities, and guided discovery to support schema building.",
      },
      {
        dimension: "Symbolic & Pretend Play",
        theory: "Piaget — Representational Thought",
        questionIds: [8, 9, 14, 27],
        description: "Ability to use symbols, imitate, and engage in pretend play — hallmarks of the Preoperational Stage.",
        highDescription: "Strong symbolic thinking and representational play. The child actively imitates, builds, draws, and engages in pretend games — key indicators of cognitive advancement.",
        lowDescription: "Symbolic play is emerging. Encourage more pretend play, drawing, block-building, and imitation games to develop representational thought.",
      },
      {
        dimension: "Social-Emotional Development",
        theory: "Erikson — Initiative vs. Guilt",
        questionIds: [1, 5, 7, 13, 28, 30],
        description: "Social awareness, emotional expression, and interpersonal connection — core to Erikson's psychosocial stage.",
        highDescription: "Healthy psychosocial development. The child shows initiative in social interactions, expresses emotions clearly, and forms positive attachments — resolving the Initiative vs. Guilt crisis positively.",
        lowDescription: "Social-emotional support needed. Create safe environments for emotional expression and social interaction to prevent guilt and encourage healthy initiative.",
      },
      {
        dimension: "Autonomy & Independence",
        theory: "Erikson — Autonomy vs. Shame",
        questionIds: [6, 12, 15, 29],
        description: "Self-directed behaviour and independence — reflecting resolution of Erikson's Autonomy vs. Shame & Doubt stage.",
        highDescription: "Strong sense of autonomy. The child demonstrates self-directed play, self-care attempts, and confident expression — positive resolution of the autonomy crisis.",
        lowDescription: "Autonomy is developing. Provide safe opportunities for independent choice and self-care to build confidence without shame or doubt.",
      },
      {
        dimension: "Motor & Physical Development",
        theory: "Piaget — Sensorimotor Integration",
        questionIds: [16, 17, 18, 19, 20, 21],
        description: "Gross and fine motor skills, physical confidence, and rhythmic movement.",
        highDescription: "Excellent motor development. The child shows physical confidence, coordination, and engagement with music and movement — strong sensorimotor integration.",
        lowDescription: "Motor development needs attention. Provide more physical activities, dance, outdoor play, and fine motor exercises to strengthen coordination.",
      },
    ],
  },
  {
    ageGroup: 5,
    title: "Multiple Intelligences & School Readiness Report",
    theories: ["Gardner's Multiple Intelligences", "School Readiness Framework"],
    dimensions: [
      {
        dimension: "Linguistic Intelligence",
        theory: "Gardner — Word Smart",
        questionIds: [1, 2, 3, 4],
        description: "Capacity to use language effectively — reading, writing, storytelling, and verbal comprehension.",
        highDescription: "Strong linguistic intelligence. The child enjoys stories, tries to read, recognizes letters, and engages with language — excellent foundation for literacy.",
        lowDescription: "Linguistic intelligence needs nurturing. Increase exposure to stories, word games, letter recognition activities, and verbal expression opportunities.",
      },
      {
        dimension: "Logical-Mathematical Intelligence",
        theory: "Gardner — Number Smart",
        questionIds: [5, 6, 17, 18, 30],
        description: "Ability to reason logically, recognize patterns, and work with numbers.",
        highDescription: "Strong logical-mathematical intelligence. The child enjoys counting, solves puzzles, recognizes patterns, builds with blocks, and identifies shapes with ease.",
        lowDescription: "Logical reasoning is developing. Provide more counting games, simple puzzles, pattern activities, and shape sorting exercises.",
      },
      {
        dimension: "Spatial Intelligence",
        theory: "Gardner — Picture Smart",
        questionIds: [7, 8],
        description: "Ability to think visually, create images, and perceive spatial relationships.",
        highDescription: "Strong spatial intelligence. The child enjoys drawing and can color with increasing precision — indicating good visual-spatial processing.",
        lowDescription: "Spatial intelligence is emerging. Encourage more drawing, visual puzzles, building activities, and art exploration.",
      },
      {
        dimension: "Musical Intelligence",
        theory: "Gardner — Music Smart",
        questionIds: [9, 10, 11, 28],
        description: "Sensitivity to rhythm, melody, and musical patterns.",
        highDescription: "Strong musical intelligence. The child enjoys music, remembers lyrics, and responds to rhythmic patterns — a key early-developing intelligence.",
        lowDescription: "Musical intelligence is developing. Increase exposure to music, singing, rhythmic clapping, and musical instruments.",
      },
      {
        dimension: "Bodily-Kinesthetic Intelligence",
        theory: "Gardner — Body Smart",
        questionIds: [12, 13],
        description: "Physical coordination, balance, and bodily control.",
        highDescription: "Strong bodily-kinesthetic intelligence. The child shows good balance and enjoys outdoor physical activities.",
        lowDescription: "Physical confidence is developing. Provide more movement-based activities, outdoor play, and balance exercises.",
      },
      {
        dimension: "Interpersonal Intelligence",
        theory: "Gardner — People Smart",
        questionIds: [14, 15, 29],
        description: "Ability to understand and interact effectively with others.",
        highDescription: "Strong interpersonal intelligence. The child shares with friends, enjoys group activities, and helps classmates — excellent social development.",
        lowDescription: "Social skills are developing. Create more opportunities for cooperative play, group activities, and peer interaction.",
      },
      {
        dimension: "Intrapersonal Intelligence",
        theory: "Gardner — Self Smart",
        questionIds: [21, 23, 24],
        description: "Self-awareness, emotional understanding, and personal goal-setting.",
        highDescription: "Strong intrapersonal intelligence. The child expresses feelings clearly, finishes tasks, and tries new activities — indicating good self-awareness.",
        lowDescription: "Self-awareness is developing. Encourage emotional expression, task completion, and exploring new activities to build internal confidence.",
      },
      {
        dimension: "Naturalist Intelligence",
        theory: "Gardner — Nature Smart",
        questionIds: [19, 20],
        description: "Connection to nature, observation of living things, and environmental awareness.",
        highDescription: "Strong naturalist intelligence. The child enjoys nature and observes insects or plants with curiosity.",
        lowDescription: "Nature connection is developing. Provide more outdoor exploration, nature walks, and observation activities.",
      },
      {
        dimension: "School Readiness",
        theory: "School Readiness Framework",
        questionIds: [16, 22, 25, 26, 27],
        description: "Overall readiness for formal schooling — questioning, pretend play, riddle-solving, following instructions, and memory.",
        highDescription: "Strong school readiness. The child asks questions, follows rules, enjoys problem-solving, remembers instructions, and engages in creative play.",
        lowDescription: "School readiness is building. Focus on following classroom routines, memory games, and structured play to prepare for formal learning.",
      },
    ],
  },
  {
    ageGroup: 10,
    title: "Advanced MI & Information Processing Report",
    theories: ["Gardner's MI (Advanced Application)", "Information Processing Theory"],
    dimensions: [
      {
        dimension: "Linguistic Intelligence",
        theory: "Gardner — Advanced Linguistic",
        questionIds: [1, 6, 17, 22],
        description: "Reading, writing, debating, and explaining concepts to others.",
        highDescription: "Advanced linguistic capability. The student reads extensively, writes essays, enjoys debates, and can explain concepts — strong verbal-analytical profile.",
        lowDescription: "Linguistic skills need development. Encourage more reading, journaling, discussion-based activities, and peer teaching.",
      },
      {
        dimension: "Logical-Mathematical Intelligence",
        theory: "Gardner — Advanced Logical",
        questionIds: [3, 5, 13, 26, 27],
        description: "Mathematical confidence, scientific reasoning, logical puzzles, and data analysis.",
        highDescription: "Strong logical-mathematical intelligence. The student solves problems confidently, enjoys science, and analyzes deeply — excellent analytical reasoning.",
        lowDescription: "Logical reasoning is developing. Provide more problem-solving challenges, science experiments, and logic-based activities.",
      },
      {
        dimension: "Spatial Intelligence",
        theory: "Gardner — Advanced Spatial",
        questionIds: [7, 21, 27],
        description: "Visual learning preference, diagram comprehension, and graph understanding.",
        highDescription: "Strong spatial-visual processing. The student learns effectively from diagrams, prefers visual learning, and understands graphs well.",
        lowDescription: "Visual-spatial skills are developing. Use more diagrams, mind maps, and visual aids in instruction.",
      },
      {
        dimension: "Musical Intelligence",
        theory: "Gardner — Musical",
        questionIds: [12],
        description: "Engagement with music practice and appreciation.",
        highDescription: "Musical intelligence is evident. The student actively engages with music practice.",
        lowDescription: "Musical engagement is limited. Consider introducing music-based learning and rhythmic memory techniques.",
      },
      {
        dimension: "Bodily-Kinesthetic Intelligence",
        theory: "Gardner — Bodily-Kinesthetic",
        questionIds: [11],
        description: "Physical activity participation and sports engagement.",
        highDescription: "Active bodily-kinesthetic learner. The student participates in sports and physical activities.",
        lowDescription: "Physical engagement is limited. Incorporate more hands-on, movement-based learning activities.",
      },
      {
        dimension: "Interpersonal Intelligence",
        theory: "Gardner — Interpersonal",
        questionIds: [8, 14, 24, 30],
        description: "Teamwork, classroom participation, group projects, and leadership.",
        highDescription: "Strong interpersonal skills. The student works well in teams, asks questions, enjoys group projects, and shows leadership.",
        lowDescription: "Social learning skills are developing. Encourage more collaborative work, group discussions, and peer interaction.",
      },
      {
        dimension: "Intrapersonal Intelligence",
        theory: "Gardner — Intrapersonal",
        questionIds: [10, 15, 19, 25, 29],
        description: "Study management, focus, self-motivation, learning from mistakes, and personal responsibility.",
        highDescription: "Strong intrapersonal intelligence. The student manages study time, stays focused, learns from mistakes, and takes responsibility — excellent self-regulation.",
        lowDescription: "Self-regulation is developing. Support with study planning, goal-setting exercises, and reflective journaling.",
      },
      {
        dimension: "Information Processing",
        theory: "Atkinson-Shiffrin / Baddeley",
        questionIds: [2, 4, 9, 16, 18, 23, 28],
        description: "Speed of understanding, memory retention, task completion, revision habits, and sequential memory — core information processing capacities.",
        highDescription: "Strong information processing. The student understands quickly, remembers content, completes work on time, revises regularly, and retains sequences — effective encoding and retrieval.",
        lowDescription: "Information processing needs support. Use chunking strategies, spaced repetition, elaborative rehearsal, and reduce cognitive load in learning tasks.",
      },
      {
        dimension: "ZPD Readiness",
        theory: "Vygotsky — Zone of Proximal Development",
        questionIds: [20],
        description: "Confidence in assessments — indicating proximity to mastery vs. need for scaffolding.",
        highDescription: "High assessment confidence suggests the student is performing within or above their current ZPD. Ready for more challenging material with minimal scaffolding.",
        lowDescription: "Low assessment confidence suggests the student may need more scaffolding, guided practice, and supportive instruction to reach their potential.",
      },
    ],
  },
  {
    ageGroup: 15,
    title: "Personality, Career Aptitude & Behavioural Profile Report",
    theories: ["Big Five (OCEAN)", "Holland's RIASEC", "DISC Assessment"],
    dimensions: [
      {
        dimension: "Openness to Experience",
        theory: "Big Five — OCEAN (O)",
        questionIds: [4, 11, 22, 27],
        description: "Curiosity, creativity, openness to new ideas and artistic activities.",
        highDescription: "High Openness. The student is curious, creative, enjoys artistic activities, and embraces new experiences and research — suited for creative, academic, and entrepreneurial paths.",
        lowDescription: "Lower Openness. The student prefers familiar routines and practical tasks. Channel strengths toward structured, procedure-driven activities.",
      },
      {
        dimension: "Conscientiousness",
        theory: "Big Five — OCEAN (C)",
        questionIds: [1, 7, 12, 15, 24, 30],
        description: "Organisation, responsibility, discipline, goal focus, and time management.",
        highDescription: "High Conscientiousness. The student is organised, disciplined, responsible, and goal-focused — the strongest predictor of academic and career success.",
        lowDescription: "Conscientiousness is developing. Support with planning tools, structured routines, deadline management, and accountability systems.",
      },
      {
        dimension: "Extraversion",
        theory: "Big Five — OCEAN (E)",
        questionIds: [2, 8, 13, 23, 29],
        description: "Social energy, confidence in expression, teamwork, and discussion leadership.",
        highDescription: "High Extraversion. The student is socially energised, expresses ideas confidently, enjoys teamwork and leading discussions — suited for leadership and social roles.",
        lowDescription: "Introversion tendency. The student may prefer independent work and quieter environments — strengths in research, writing, and analytical tasks.",
      },
      {
        dimension: "Agreeableness",
        theory: "Big Five — OCEAN (A)",
        questionIds: [5, 16, 28],
        description: "Helpfulness, empathy, and concern for others' feelings.",
        highDescription: "High Agreeableness. The student is helpful, empathetic, and considerate — suited for healthcare, counselling, teaching, and team-based roles.",
        lowDescription: "Lower Agreeableness. The student may be more competitive and direct — strengths in negotiation, leadership, and decision-making roles.",
      },
      {
        dimension: "Emotional Stability",
        theory: "Big Five — OCEAN (N — inverse)",
        questionIds: [3, 9, 25, 26],
        description: "Stress management, adaptability, confidence in decisions, and calmness under pressure.",
        highDescription: "High Emotional Stability. The student handles stress calmly, adapts to change, and feels confident in decisions — strong resilience and self-regulation.",
        lowDescription: "Emotional regulation is developing. Provide stress management strategies, mindfulness techniques, and supportive environments for building resilience.",
      },
      {
        dimension: "Holland RIASEC Profile",
        theory: "Holland's Career Typology",
        questionIds: [6, 10, 17, 19, 20, 21],
        description: "Career orientation: leadership (Enterprising), analytical depth (Investigative), technical preference (Realistic), practical work (Realistic), ambition (Enterprising).",
        highDescription: "Strong Enterprising-Investigative-Realistic profile. The student shows leadership, deep analytical thinking, calculated risk-taking, ambition, and preference for technical/practical work — suited for STEM, business, and leadership careers.",
        lowDescription: "Career orientation is still forming. Expose the student to diverse career experiences, job shadowing, and exploratory activities across different Holland types.",
      },
      {
        dimension: "DISC Behavioural Profile",
        theory: "DISC Assessment",
        questionIds: [14, 18],
        description: "Independence (D-Dominance) and reflective thinking (S-Steadiness/C-Conscientiousness).",
        highDescription: "Balanced D-S/C profile. The student works independently and reflects before acting — combining decisiveness with thoughtful analysis.",
        lowDescription: "Behavioural style is developing. Encourage both independent decision-making and reflective thinking to build a balanced behavioural profile.",
      },
    ],
  },
];

export function getReportConfig(ageGroup: number): AgeGroupReport | undefined {
  return AGE_GROUP_REPORTS.find((r) => r.ageGroup === ageGroup);
}

export interface DimensionScore {
  dimension: string;
  theory: string;
  score: number;
  maxScore: number;
  percentage: number;
  level: "High" | "Moderate" | "Developing";
  description: string;
  interpretation: string;
  notSureCount: number;
  totalQuestions: number;
}

export function analyzeResponses(
  ageGroup: number,
  responses: Record<string, number>
): DimensionScore[] | null {
  const config = getReportConfig(ageGroup);
  if (!config) return null;

  const maxPerQuestion = ageGroup <= 5 ? 4 : 5;

  return config.dimensions.map((dim) => {
    const rawScores = dim.questionIds.map((qId) => responses[String(qId)]);
    const notSureCount = rawScores.filter((v) => v === 0).length;
    const scores = rawScores.map((v) => v || 0);
    const totalScore = scores.reduce((sum, s) => sum + s, 0);
    const maxScore = dim.questionIds.length * maxPerQuestion;
    const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

    let level: "High" | "Moderate" | "Developing";
    let interpretation: string;

    if (percentage >= 70) {
      level = "High";
      interpretation = dim.highDescription;
    } else if (percentage >= 40) {
      level = "Moderate";
      interpretation = `Moderate level observed. ${dim.highDescription.split(".").slice(1).join(".").trim() || dim.description}`;
    } else {
      level = "Developing";
      interpretation = dim.lowDescription;
    }

    return {
      dimension: dim.dimension,
      theory: dim.theory,
      score: totalScore,
      maxScore,
      percentage,
      level,
      description: dim.description,
      interpretation,
      notSureCount,
      totalQuestions: dim.questionIds.length,
    };
  });
}
