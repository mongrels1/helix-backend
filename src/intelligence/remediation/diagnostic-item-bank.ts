// AUTO-GENERATED from helix-frontend/src/pages/diagnostic/DiagnosticPage.tsx (BANK).
// Single source of truth in the backend for CALIBRATED re-check items (89 items).
// If the diagnostic item bank changes, regenerate this file (see autonomous_loop notes).

export interface CalibratedItem {
  id: string;
  grade: number;
  strand: string;
  kc: string;
  b: number;
  stem: string;
  options: string[];
  correct: number;
}

export const DIAGNOSTIC_ITEM_BANK: CalibratedItem[] = [
  {
    "id": "NS01",
    "grade": 4,
    "strand": "NS",
    "kc": "Place value (whole numbers)",
    "b": -2,
    "stem": "What is the value of the 7 in 374?",
    "options": [
      "70",
      "7",
      "700",
      "74"
    ],
    "correct": 0
  },
  {
    "id": "NS02",
    "grade": 4,
    "strand": "NS",
    "kc": "Equivalent fractions",
    "b": -2,
    "stem": "Which fraction is equivalent to 1/2?",
    "options": [
      "2/4",
      "1/3",
      "2/3",
      "3/8"
    ],
    "correct": 0
  },
  {
    "id": "NS03",
    "grade": 4,
    "strand": "NS",
    "kc": "Compare fractions",
    "b": -1.5,
    "stem": "Which is greater: 3/4 or 2/3?",
    "options": [
      "3/4",
      "2/3",
      "They are equal",
      "Cannot tell"
    ],
    "correct": 0
  },
  {
    "id": "G01",
    "grade": 5,
    "strand": "G",
    "kc": "Area of a rectangle",
    "b": -1.2,
    "stem": "What is the area of a rectangle that is 6 units by 4 units?",
    "options": [
      "24 sq units",
      "20 sq units",
      "10 sq units",
      "12 sq units"
    ],
    "correct": 0
  },
  {
    "id": "NS04",
    "grade": 5,
    "strand": "NS",
    "kc": "Round decimals",
    "b": -1.1,
    "stem": "Round 3.47 to the nearest tenth.",
    "options": [
      "3.5",
      "3.4",
      "3.0",
      "4.0"
    ],
    "correct": 0
  },
  {
    "id": "NS05",
    "grade": 5,
    "strand": "NS",
    "kc": "Add fractions, unlike denominators",
    "b": -0.7,
    "stem": "1/2 + 1/3 = ?",
    "options": [
      "5/6",
      "2/5",
      "1/5",
      "2/6"
    ],
    "correct": 0
  },
  {
    "id": "RP01",
    "grade": 6,
    "strand": "RP",
    "kc": "Write a ratio",
    "b": -0.7,
    "stem": "A recipe uses 2 cups of flour to 3 cups of sugar. What is the ratio of flour to sugar?",
    "options": [
      "2 : 3",
      "3 : 2",
      "2 : 5",
      "5 : 2"
    ],
    "correct": 0
  },
  {
    "id": "NS06",
    "grade": 6,
    "strand": "NS",
    "kc": "Add/subtract decimals",
    "b": -0.5,
    "stem": "0.70 + 0.25 = ?",
    "options": [
      "0.95",
      "0.32",
      "0.50",
      "9.5"
    ],
    "correct": 0
  },
  {
    "id": "EE01",
    "grade": 6,
    "strand": "EE",
    "kc": "Evaluate an expression",
    "b": -0.4,
    "stem": "Evaluate 3x + 2 when x = 4.",
    "options": [
      "14",
      "9",
      "24",
      "20"
    ],
    "correct": 0
  },
  {
    "id": "NS07",
    "grade": 6,
    "strand": "NS",
    "kc": "Add integers (negatives)",
    "b": -0.2,
    "stem": "(-5) + 3 = ?",
    "options": [
      "-2",
      "2",
      "-8",
      "8"
    ],
    "correct": 0
  },
  {
    "id": "SP01",
    "grade": 6,
    "strand": "SP",
    "kc": "Mean (average)",
    "b": -0.2,
    "stem": "What is the mean of 4, 8, and 6?",
    "options": [
      "6",
      "18",
      "8",
      "4"
    ],
    "correct": 0
  },
  {
    "id": "EE02",
    "grade": 6,
    "strand": "EE",
    "kc": "Order of operations",
    "b": -0.1,
    "stem": "Compute 2 + 3 × 4.",
    "options": [
      "14",
      "20",
      "24",
      "9"
    ],
    "correct": 0
  },
  {
    "id": "NS08",
    "grade": 6,
    "strand": "NS",
    "kc": "Multiply fractions",
    "b": 0,
    "stem": "2/3 × 3/4 = ?",
    "options": [
      "1/2",
      "6/7",
      "5/7",
      "2/4"
    ],
    "correct": 0
  },
  {
    "id": "RP02",
    "grade": 6,
    "strand": "RP",
    "kc": "Unit rate",
    "b": 0,
    "stem": "If 4 apples cost $2.00, what is the cost per apple?",
    "options": [
      "$0.50",
      "$2.00",
      "$8.00",
      "$0.25"
    ],
    "correct": 0
  },
  {
    "id": "G02",
    "grade": 6,
    "strand": "G",
    "kc": "Area of a triangle",
    "b": 0.1,
    "stem": "What is the area of a triangle with base 8 and height 5?",
    "options": [
      "20",
      "40",
      "13",
      "26"
    ],
    "correct": 0
  },
  {
    "id": "EE03",
    "grade": 6,
    "strand": "EE",
    "kc": "Write an algebraic expression",
    "b": 0.1,
    "stem": "Which expression means “5 less than a number n”?",
    "options": [
      "n − 5",
      "5 − n",
      "5n",
      "n + 5"
    ],
    "correct": 0
  },
  {
    "id": "SP02",
    "grade": 6,
    "strand": "SP",
    "kc": "Median",
    "b": 0.2,
    "stem": "What is the median of 3, 9, 5, 7, 1?",
    "options": [
      "5",
      "7",
      "9",
      "4"
    ],
    "correct": 0
  },
  {
    "id": "EE04",
    "grade": 7,
    "strand": "EE",
    "kc": "One-step equation",
    "b": 0.2,
    "stem": "Solve for x:  x + 7 = 12.",
    "options": [
      "5",
      "19",
      "84",
      "-5"
    ],
    "correct": 0
  },
  {
    "id": "RP03",
    "grade": 7,
    "strand": "RP",
    "kc": "Percent of a number",
    "b": 0.3,
    "stem": "What is 20% of 150?",
    "options": [
      "30",
      "3",
      "300",
      "130"
    ],
    "correct": 0
  },
  {
    "id": "G03",
    "grade": 6,
    "strand": "G",
    "kc": "Volume of a rectangular prism",
    "b": 0.4,
    "stem": "What is the volume of a box that is 2 × 3 × 4 units?",
    "options": [
      "24",
      "9",
      "26",
      "12"
    ],
    "correct": 0
  },
  {
    "id": "NS09",
    "grade": 7,
    "strand": "NS",
    "kc": "Multiply integers",
    "b": 0.4,
    "stem": "(-6) × (-4) = ?",
    "options": [
      "24",
      "-24",
      "-10",
      "10"
    ],
    "correct": 0
  },
  {
    "id": "SP03",
    "grade": 7,
    "strand": "SP",
    "kc": "Simple probability",
    "b": 0.5,
    "stem": "A bag has 2 red and 3 blue marbles. What is P(red)?",
    "options": [
      "2/5",
      "2/3",
      "3/5",
      "1/2"
    ],
    "correct": 0
  },
  {
    "id": "NS10",
    "grade": 7,
    "strand": "NS",
    "kc": "Subtract integers",
    "b": 0.6,
    "stem": "(-4) − (-7) = ?",
    "options": [
      "3",
      "-11",
      "-3",
      "11"
    ],
    "correct": 0
  },
  {
    "id": "G04",
    "grade": 7,
    "strand": "G",
    "kc": "Circumference of a circle",
    "b": 0.6,
    "stem": "Circumference of a circle with diameter 10? (use π ≈ 3.14)",
    "options": [
      "31.4",
      "78.5",
      "15.7",
      "314"
    ],
    "correct": 0
  },
  {
    "id": "NS11",
    "grade": 6,
    "strand": "NS",
    "kc": "Divide fractions",
    "b": 0.5,
    "stem": "3/4 ÷ 1/2 = ?",
    "options": [
      "3/2",
      "3/8",
      "2/3",
      "4/6"
    ],
    "correct": 0
  },
  {
    "id": "F01",
    "grade": 8,
    "strand": "F",
    "kc": "Evaluate a function",
    "b": 0.7,
    "stem": "If f(x) = 2x − 1, what is f(3)?",
    "options": [
      "5",
      "6",
      "1",
      "7"
    ],
    "correct": 0
  },
  {
    "id": "RP04",
    "grade": 7,
    "strand": "RP",
    "kc": "Solve a proportion",
    "b": 0.7,
    "stem": "If 3/4 = x/12, what is x?",
    "options": [
      "9",
      "16",
      "4",
      "48"
    ],
    "correct": 0
  },
  {
    "id": "EE05",
    "grade": 7,
    "strand": "EE",
    "kc": "Two-step equation",
    "b": 0.8,
    "stem": "Solve for x:  2x + 3 = 11.",
    "options": [
      "4",
      "7",
      "5.5",
      "8"
    ],
    "correct": 0
  },
  {
    "id": "RP05",
    "grade": 7,
    "strand": "RP",
    "kc": "Scale / proportional reasoning",
    "b": 0.9,
    "stem": "A map scale is 1 inch = 50 miles. How many miles is 3.5 inches?",
    "options": [
      "175",
      "53.5",
      "14.3",
      "150"
    ],
    "correct": 0
  },
  {
    "id": "EE06",
    "grade": 7,
    "strand": "EE",
    "kc": "Distributive property",
    "b": 0.9,
    "stem": "Expand 3(x + 4).",
    "options": [
      "3x + 12",
      "3x + 4",
      "x + 12",
      "3x + 7"
    ],
    "correct": 0
  },
  {
    "id": "RP06",
    "grade": 7,
    "strand": "RP",
    "kc": "Percent increase",
    "b": 1,
    "stem": "A $40 shirt is marked up 25%. What is the new price?",
    "options": [
      "$50",
      "$45",
      "$65",
      "$10"
    ],
    "correct": 0
  },
  {
    "id": "F02",
    "grade": 8,
    "strand": "F",
    "kc": "Interpret y = mx + b",
    "b": 1,
    "stem": "In the equation y = 3x − 2, what is the y-intercept?",
    "options": [
      "-2",
      "3",
      "2",
      "0"
    ],
    "correct": 0
  },
  {
    "id": "EE07",
    "grade": 8,
    "strand": "EE",
    "kc": "Laws of exponents",
    "b": 1.1,
    "stem": "Simplify 2³ × 2².",
    "options": [
      "32",
      "64",
      "20",
      "16"
    ],
    "correct": 0
  },
  {
    "id": "G05",
    "grade": 7,
    "strand": "G",
    "kc": "Area of a circle",
    "b": 1.1,
    "stem": "Area of a circle with radius 3? (use π ≈ 3.14)",
    "options": [
      "28.26",
      "18.84",
      "9.42",
      "6.28"
    ],
    "correct": 0
  },
  {
    "id": "F03",
    "grade": 8,
    "strand": "F",
    "kc": "Slope from two points",
    "b": 1.2,
    "stem": "A line passes through (0, 1) and (2, 5). What is the slope?",
    "options": [
      "2",
      "4",
      "1/2",
      "3"
    ],
    "correct": 0
  },
  {
    "id": "SP04",
    "grade": 8,
    "strand": "SP",
    "kc": "Interpret association (scatter)",
    "b": 1.2,
    "stem": "In a scatter plot, as x increases, y decreases. The association is:",
    "options": [
      "Negative",
      "Positive",
      "No association",
      "Constant"
    ],
    "correct": 0
  },
  {
    "id": "EE08",
    "grade": 8,
    "strand": "EE",
    "kc": "Variables on both sides",
    "b": 1.3,
    "stem": "Solve for x:  5x − 2 = 3x + 8.",
    "options": [
      "5",
      "3",
      "1.5",
      "10"
    ],
    "correct": 0
  },
  {
    "id": "F04",
    "grade": 8,
    "strand": "F",
    "kc": "Identify proportional relationship",
    "b": 1.4,
    "stem": "Which equation represents a proportional relationship?",
    "options": [
      "y = 4x",
      "y = 4x + 2",
      "y = x²",
      "y = 2/x"
    ],
    "correct": 0
  },
  {
    "id": "G06",
    "grade": 8,
    "strand": "G",
    "kc": "Pythagorean theorem",
    "b": 1.5,
    "stem": "A right triangle has legs 3 and 4. What is the hypotenuse?",
    "options": [
      "5",
      "7",
      "25",
      "12"
    ],
    "correct": 0
  },
  {
    "id": "F05",
    "grade": 8,
    "strand": "F",
    "kc": "Reason about parallel lines",
    "b": 2,
    "stem": "How many solutions does the system y = 2x + 1 and y = 2x + 5 have?",
    "options": [
      "None (parallel lines)",
      "One",
      "Infinitely many",
      "Two"
    ],
    "correct": 0
  },
  {
    "id": "NS12",
    "grade": 4,
    "strand": "NS",
    "kc": "Compare decimals",
    "b": -1.8,
    "stem": "Which number is larger: 0.5 or 0.45?",
    "options": [
      "0.5",
      "0.45",
      "They are equal",
      "0.045"
    ],
    "correct": 0
  },
  {
    "id": "G07",
    "grade": 5,
    "strand": "G",
    "kc": "Perimeter of a rectangle",
    "b": -1.3,
    "stem": "What is the perimeter of a rectangle that is 6 by 4?",
    "options": [
      "20",
      "24",
      "10",
      "48"
    ],
    "correct": 0
  },
  {
    "id": "NS13",
    "grade": 5,
    "strand": "NS",
    "kc": "Fraction to decimal",
    "b": -1,
    "stem": "What is 3/5 written as a decimal?",
    "options": [
      "0.6",
      "0.35",
      "0.53",
      "1.67"
    ],
    "correct": 0
  },
  {
    "id": "NS18",
    "grade": 6,
    "strand": "NS",
    "kc": "Absolute value",
    "b": -1,
    "stem": "What is |−9| (the absolute value of −9)?",
    "options": [
      "9",
      "-9",
      "0",
      "18"
    ],
    "correct": 0
  },
  {
    "id": "NS14",
    "grade": 5,
    "strand": "NS",
    "kc": "Subtract fractions, like denominators",
    "b": -0.6,
    "stem": "7/8 − 3/8 = ?",
    "options": [
      "1/2",
      "4/16",
      "10/8",
      "4/0"
    ],
    "correct": 0
  },
  {
    "id": "G08",
    "grade": 6,
    "strand": "G",
    "kc": "Angle facts (right angle)",
    "b": -0.5,
    "stem": "How many degrees are in a right angle?",
    "options": [
      "90",
      "180",
      "45",
      "360"
    ],
    "correct": 0
  },
  {
    "id": "RP07",
    "grade": 6,
    "strand": "RP",
    "kc": "Ratio reasoning (scale up)",
    "b": -0.4,
    "stem": "There are 3 cats for every 2 dogs. If there are 9 cats, how many dogs are there?",
    "options": [
      "6",
      "4",
      "18",
      "5"
    ],
    "correct": 0
  },
  {
    "id": "NS15",
    "grade": 6,
    "strand": "NS",
    "kc": "Greatest common factor",
    "b": -0.3,
    "stem": "What is the greatest common factor (GCF) of 12 and 18?",
    "options": [
      "6",
      "2",
      "3",
      "36"
    ],
    "correct": 0
  },
  {
    "id": "EE10",
    "grade": 6,
    "strand": "EE",
    "kc": "Evaluate an expression",
    "b": -0.2,
    "stem": "Evaluate 2x − 5 when x = 6.",
    "options": [
      "7",
      "17",
      "13",
      "-7"
    ],
    "correct": 0
  },
  {
    "id": "G09",
    "grade": 6,
    "strand": "G",
    "kc": "Area of a square",
    "b": -0.2,
    "stem": "What is the area of a square with side length 5?",
    "options": [
      "25",
      "20",
      "10",
      "55"
    ],
    "correct": 0
  },
  {
    "id": "NS23",
    "grade": 6,
    "strand": "NS",
    "kc": "Add fractions, like denominators",
    "b": -0.1,
    "stem": "5/8 + 1/8 = ?",
    "options": [
      "3/4",
      "6/16",
      "1/2",
      "5/16"
    ],
    "correct": 0
  },
  {
    "id": "NS16",
    "grade": 6,
    "strand": "NS",
    "kc": "Least common multiple",
    "b": 0,
    "stem": "What is the least common multiple (LCM) of 4 and 6?",
    "options": [
      "12",
      "24",
      "2",
      "10"
    ],
    "correct": 0
  },
  {
    "id": "SP05",
    "grade": 6,
    "strand": "SP",
    "kc": "Range of a data set",
    "b": -0.4,
    "stem": "What is the range of 3, 7, 2, 9?",
    "options": [
      "7",
      "9",
      "2",
      "21"
    ],
    "correct": 0
  },
  {
    "id": "SP06",
    "grade": 6,
    "strand": "SP",
    "kc": "Mode of a data set",
    "b": 0,
    "stem": "What is the mode of 2, 3, 3, 5, 7?",
    "options": [
      "3",
      "5",
      "4",
      "7"
    ],
    "correct": 0
  },
  {
    "id": "EE11",
    "grade": 6,
    "strand": "EE",
    "kc": "Equivalent expressions",
    "b": 0,
    "stem": "Which expression is equivalent to x + x + x?",
    "options": [
      "3x",
      "x³",
      "x + 3",
      "2x"
    ],
    "correct": 0
  },
  {
    "id": "RP14",
    "grade": 6,
    "strand": "RP",
    "kc": "Fraction to percent",
    "b": 0,
    "stem": "Convert 3/4 to a percent.",
    "options": [
      "75%",
      "34%",
      "43%",
      "0.75%"
    ],
    "correct": 0
  },
  {
    "id": "NS17",
    "grade": 6,
    "strand": "NS",
    "kc": "Divide integers",
    "b": 0.2,
    "stem": "−8 ÷ 2 = ?",
    "options": [
      "-4",
      "4",
      "-16",
      "-6"
    ],
    "correct": 0
  },
  {
    "id": "RP08",
    "grade": 6,
    "strand": "RP",
    "kc": "Rate (distance/time)",
    "b": 0.2,
    "stem": "A car travels 120 miles in 2 hours. What is its speed?",
    "options": [
      "60 mph",
      "240 mph",
      "122 mph",
      "30 mph"
    ],
    "correct": 0
  },
  {
    "id": "SP07",
    "grade": 7,
    "strand": "SP",
    "kc": "Probability of an event",
    "b": 0.3,
    "stem": "A standard die is rolled. What is P(even number)?",
    "options": [
      "1/2",
      "1/6",
      "1/3",
      "2/3"
    ],
    "correct": 0
  },
  {
    "id": "EE12",
    "grade": 6,
    "strand": "EE",
    "kc": "Exponents in expressions",
    "b": 0.3,
    "stem": "Compute (8 − 2)².",
    "options": [
      "36",
      "12",
      "64",
      "6"
    ],
    "correct": 0
  },
  {
    "id": "RP09",
    "grade": 7,
    "strand": "RP",
    "kc": "Percent of a number",
    "b": 0.4,
    "stem": "What is 15% of 200?",
    "options": [
      "30",
      "15",
      "300",
      "45"
    ],
    "correct": 0
  },
  {
    "id": "EE13",
    "grade": 7,
    "strand": "EE",
    "kc": "One-step equation (subtraction)",
    "b": 0.5,
    "stem": "Solve for x:  x − 4 = 9.",
    "options": [
      "13",
      "5",
      "-13",
      "36"
    ],
    "correct": 0
  },
  {
    "id": "NS19",
    "grade": 7,
    "strand": "NS",
    "kc": "Add/subtract integers (multi-step)",
    "b": 0.5,
    "stem": "−3 + (−5) − (−2) = ?",
    "options": [
      "-6",
      "-10",
      "0",
      "-4"
    ],
    "correct": 0
  },
  {
    "id": "G10",
    "grade": 7,
    "strand": "G",
    "kc": "Angle sum of a triangle",
    "b": 0.5,
    "stem": "The interior angles of a triangle add up to:",
    "options": [
      "180°",
      "360°",
      "90°",
      "270°"
    ],
    "correct": 0
  },
  {
    "id": "EE14",
    "grade": 7,
    "strand": "EE",
    "kc": "One-step equation (division)",
    "b": 0.6,
    "stem": "Solve for x:  3x = 21.",
    "options": [
      "7",
      "18",
      "63",
      "24"
    ],
    "correct": 0
  },
  {
    "id": "RP10",
    "grade": 7,
    "strand": "RP",
    "kc": "Percent decrease (discount)",
    "b": 0.6,
    "stem": "A shirt costs $20. With 10% off, what is the sale price?",
    "options": [
      "$18",
      "$10",
      "$22",
      "$19"
    ],
    "correct": 0
  },
  {
    "id": "SP08",
    "grade": 7,
    "strand": "SP",
    "kc": "Mean (average)",
    "b": 0.6,
    "stem": "What is the mean of 10, 20, 30, and 40?",
    "options": [
      "25",
      "30",
      "100",
      "20"
    ],
    "correct": 0
  },
  {
    "id": "NS20",
    "grade": 7,
    "strand": "NS",
    "kc": "Powers of negative numbers",
    "b": 0.7,
    "stem": "Evaluate (−2)³.",
    "options": [
      "-8",
      "8",
      "-6",
      "6"
    ],
    "correct": 0
  },
  {
    "id": "F06",
    "grade": 8,
    "strand": "F",
    "kc": "Evaluate a nonlinear function",
    "b": 0.8,
    "stem": "If f(x) = x² + 1, what is f(2)?",
    "options": [
      "5",
      "7",
      "9",
      "4"
    ],
    "correct": 0
  },
  {
    "id": "RP11",
    "grade": 7,
    "strand": "RP",
    "kc": "Unit rate (scale to new total)",
    "b": 0.8,
    "stem": "If 5 pencils cost $1.25, how much do 8 pencils cost?",
    "options": [
      "$2.00",
      "$1.60",
      "$2.50",
      "$10.00"
    ],
    "correct": 0
  },
  {
    "id": "G11",
    "grade": 7,
    "strand": "G",
    "kc": "Complementary angles",
    "b": 0.8,
    "stem": "Two angles are complementary. One measures 30°. What is the other?",
    "options": [
      "60°",
      "150°",
      "30°",
      "90°"
    ],
    "correct": 0
  },
  {
    "id": "F07",
    "grade": 8,
    "strand": "F",
    "kc": "Slope from an equation",
    "b": 0.9,
    "stem": "What is the slope of the line y = −2x + 4?",
    "options": [
      "-2",
      "4",
      "2",
      "-4"
    ],
    "correct": 0
  },
  {
    "id": "SP09",
    "grade": 7,
    "strand": "SP",
    "kc": "Complement of an event",
    "b": 0.9,
    "stem": "A spinner has 4 equal sections: red, blue, green, yellow. What is P(not red)?",
    "options": [
      "3/4",
      "1/4",
      "1/2",
      "4/3"
    ],
    "correct": 0
  },
  {
    "id": "EE15",
    "grade": 7,
    "strand": "EE",
    "kc": "Combine like terms",
    "b": 0.9,
    "stem": "Simplify: 4x + 3 − 2x + 5.",
    "options": [
      "2x + 8",
      "6x + 8",
      "2x + 2",
      "2x − 2"
    ],
    "correct": 0
  },
  {
    "id": "RP12",
    "grade": 7,
    "strand": "RP",
    "kc": "Solve a proportion",
    "b": 1,
    "stem": "Solve the proportion: 6/9 = 8/x.",
    "options": [
      "12",
      "11",
      "5.3",
      "16"
    ],
    "correct": 0
  },
  {
    "id": "G12",
    "grade": 7,
    "strand": "G",
    "kc": "Surface area of a prism",
    "b": 1,
    "stem": "A rectangular prism is 5 × 2 × 3. What is its surface area?",
    "options": [
      "62",
      "30",
      "31",
      "124"
    ],
    "correct": 0
  },
  {
    "id": "F08",
    "grade": 8,
    "strand": "F",
    "kc": "Use slope to find a value",
    "b": 1.1,
    "stem": "A line has slope 3 and passes through (0, 0). What is y when x = 2?",
    "options": [
      "6",
      "3",
      "5",
      "2"
    ],
    "correct": 0
  },
  {
    "id": "RP13",
    "grade": 7,
    "strand": "RP",
    "kc": "Percent increase",
    "b": 1.1,
    "stem": "A population grows from 200 to 250. What is the percent increase?",
    "options": [
      "25%",
      "50%",
      "20%",
      "125%"
    ],
    "correct": 0
  },
  {
    "id": "SP10",
    "grade": 8,
    "strand": "SP",
    "kc": "Probability of independent events",
    "b": 1.2,
    "stem": "Two fair coins are flipped. What is P(both heads)?",
    "options": [
      "1/4",
      "1/2",
      "1/3",
      "3/4"
    ],
    "correct": 0
  },
  {
    "id": "EE16",
    "grade": 8,
    "strand": "EE",
    "kc": "Equation with distribution",
    "b": 1.2,
    "stem": "Solve for x:  4(x − 1) = 12.",
    "options": [
      "4",
      "2",
      "3.25",
      "13"
    ],
    "correct": 0
  },
  {
    "id": "F09",
    "grade": 8,
    "strand": "F",
    "kc": "Slope from two points",
    "b": 1.3,
    "stem": "Find the slope of the line through (1, 2) and (4, 11).",
    "options": [
      "3",
      "9",
      "1/3",
      "13"
    ],
    "correct": 0
  },
  {
    "id": "G13",
    "grade": 8,
    "strand": "G",
    "kc": "Pythagorean theorem",
    "b": 1.4,
    "stem": "A right triangle has legs 6 and 8. What is the hypotenuse?",
    "options": [
      "10",
      "14",
      "48",
      "100"
    ],
    "correct": 0
  },
  {
    "id": "EE17",
    "grade": 8,
    "strand": "EE",
    "kc": "Multiply powers",
    "b": 1.5,
    "stem": "Simplify (3x²)(2x³).",
    "options": [
      "6x⁵",
      "6x⁶",
      "5x⁵",
      "6x"
    ],
    "correct": 0
  },
  {
    "id": "F10",
    "grade": 8,
    "strand": "F",
    "kc": "Write a linear equation",
    "b": 1.5,
    "stem": "A line crosses the y-axis at 5 with slope −1. What is its equation?",
    "options": [
      "y = −x + 5",
      "y = 5x − 1",
      "y = x + 5",
      "y = −x − 5"
    ],
    "correct": 0
  },
  {
    "id": "NS22",
    "grade": 8,
    "strand": "NS",
    "kc": "Estimate a square root",
    "b": 1.6,
    "stem": "Estimate √50 to the nearest whole number.",
    "options": [
      "7",
      "8",
      "25",
      "6"
    ],
    "correct": 0
  },
  {
    "id": "G14",
    "grade": 8,
    "strand": "G",
    "kc": "Volume of a cylinder",
    "b": 1.7,
    "stem": "Volume of a cylinder with radius 2 and height 5? (use π ≈ 3.14)",
    "options": [
      "62.8",
      "31.4",
      "20",
      "125.6"
    ],
    "correct": 0
  },
  {
    "id": "EE18",
    "grade": 8,
    "strand": "EE",
    "kc": "Variables on both sides (distribution)",
    "b": 1.7,
    "stem": "Solve for x:  2(x + 3) = 3x − 1.",
    "options": [
      "7",
      "5",
      "1",
      "-7"
    ],
    "correct": 0
  },
  {
    "id": "F11",
    "grade": 8,
    "strand": "F",
    "kc": "Rate of change of a function",
    "b": 1.8,
    "stem": "A linear function has f(0) = 3 and f(2) = 11. What is its rate of change?",
    "options": [
      "4",
      "8",
      "11",
      "2"
    ],
    "correct": 0
  },
  {
    "id": "NS21",
    "grade": 8,
    "strand": "NS",
    "kc": "Rational vs. irrational numbers",
    "b": 1.2,
    "stem": "Which of these is an irrational number?",
    "options": [
      "√2",
      "0.75",
      "4/9",
      "√16"
    ],
    "correct": 0
  }
];

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Return up to `limit` CALIBRATED items whose KC matches `kc` (case/format-insensitive).
 * Used for the measurement-valid re-check; empty array => caller falls back to AI-generated.
 */
export function findCalibratedItemsForKc(kc: string, limit = 3): CalibratedItem[] {
  const target = norm(kc);
  if (!target) return [];
  return DIAGNOSTIC_ITEM_BANK.filter((i) => norm(i.kc) === target).slice(0, limit);
}

/** True if the calibrated bank covers this KC at all. */
export function bankCoversKc(kc: string): boolean {
  return findCalibratedItemsForKc(kc, 1).length > 0;
}
