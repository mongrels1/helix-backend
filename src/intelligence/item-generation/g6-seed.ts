/**
 * EdKairos · item-generation · Grade-6 seed library (curated)
 *
 * Abstracted misconception patterns + DOK-gap targets derived from the
 * Illuminate DnA (Inspect Premium) G6 item banks. REFERENCE-ONLY: no stems are
 * copied; these patterns seed generation of ORIGINAL EdKairos items so new
 * distractors inherit real, documented student errors and fill the DOK-3/4 gap.
 */

export interface G6SeedDomain {
  strand: string;
  dokPresent: { 1: number; 2: number; 3: number; 4: number };
  /** how many DOK-3 / DOK-4 items to generate to fill the rigor gap */
  dokGap: { dok3: number; dok4: number };
  /** documented misconception rationales — seed distractors from these */
  misconceptions: string[];
}

export const G6_SEED: Record<string, G6SeedDomain> = {
  '6.RP': {
    strand: 'RP',
    dokPresent: { 1: 4, 2: 6, 3: 0, 4: 0 },
    dokGap: { dok3: 3, dok4: 1 },
    misconceptions: [
      'Thought that 4 was the x– intercept and that a negative slope decreases from right to left.',
      'Also thought that the inequality value means greater than or equal to.',
      'Thought that the inequality value means greater than or equal to.',
      'Mixed up the sign of the y– coordinate of a point in the third quadrant that is a solution to the equation.',
      'Mixed up the x– and y– coordinates of a point in the third quadrant that is a solution to the equation.',
      'Mixed up the x– and y– coordinates of a point in the first quadrant that is a solution to the equation.',
      'Added all of the like terms giving them 8y = 18, and then divided by the coefficient.',
      'Added all of the like terms giving them 8y = 12, and then divided by the coefficient.',
      'Added the like terms on one side of the equation, subtracted 3 to both sides, and divided by the coefficient.',
      'Used 3 as the numerator when moved to the right side of the equation, which resulted in this fraction.',
      'Added the 6 to 21 instead of subtracting it.',
      'Assumed since there was a negative number on the left side of the equation that the result would indicate a negative number.',
      'Doubled the 15 and 12 rather than squaring them but remembered to take the root of the difference.',
      'Incorrectly applied the Pythagorean Theorem and only subtracted 12 from 15, or doubled and halved all the values rather than squaring and taking the root of the numbers.',
      'Forgotten to take the square root of the sum of the squares.',
      'Focused too much on the word "feet" and divided by 12 instead of 10.',
      'Multiplied 180 by 10 instead of dividing.',
    ],
  },
  '6.NS': {
    strand: 'NS',
    dokPresent: { 1: 8, 2: 7, 3: 0, 4: 0 },
    dokGap: { dok3: 5, dok4: 1 },
    misconceptions: [
      'Subtracted as if both temperatures were positives.',
      'Subtracted as if both numbers were positives and forgot to borrow.',
      'Tried to subtract 23 from 6 and added a zero to make it 60 minus 23.',
      'Counted that N was 2 tick marks to the right of –2, known that each tick mark represented a 1/3 increment, and subtracted the 2/3 from –2 instead of added 2/3 to –2.',
      'Counted –1 1/3 to N, but saw the –2 on the number line and accidentally chose – 2 1/3.',
      'Miscounted and added an extra tick mark to the left of zero.',
      'Understood that in dividing fractions, the reciprocal of one fraction is multiplied by the other; however, the student(s) may have missed part of the improper fraction.',
      'Forgotten to carry on the last step of multiplication thus producing an answer that is 3 less than the actual answer.',
      'Forgotten to carry in the first step of the multiplication thus producing an answer that was a tenth off.',
      'Thought that the positive numbers were increasing to the right and they were getting closer to 2.',
      'Incorrectly assumed that 416 divided by 13 would result in each friend receiving 22 crayons.',
      'Realized that the value of the tens place was 3 but may have made a computational error when trying to find the value of the ones place.',
      'Made a calculation error finding the number of crayons each friend would get.',
      'Incorrectly calculated the value of the tens place.',
      'Made a mistake by multiplying the whole number and unit fraction together instead of dividing.',
    ],
  },
  '6.EE': {
    strand: 'EE',
    dokPresent: { 1: 6, 2: 10, 3: 0, 4: 0 },
    dokGap: { dok3: 5, dok4: 2 },
    misconceptions: [
      'Subtracted the quantity then added the 4, then multiplied by 3.',
      'Multiplied the 6 in the quantity by 3, but not the two in the quantity.',
      'Thought that the B was in the tens place and the 6, then the 2 were in the ones place.',
      'Mistakenly added the coefficients of the two terms in the expression, not multiplying the variables.',
      'Correctly multiplied the variables in the expression, but they may have mistakenly added the coefficients of the two terms in the expression.',
      'Correctly multiplied the coefficients of the two terms in the expression, but they may have not multiplied the variables.',
      'Subtracted 12 from 60, rather than dividing to find the value of y.',
      'Noticed that the numbers shown are mulitples of 6, and may have assumed 6 was the correct answer.',
      'Thought the rule was to divide by 6, rather than to divide by 12.',
      'Added 22 + 4 instead of multiplying, and disregarded the negative sign when the outcome was –43.',
      'Added 22 + 4 instead of multiplying, and added 69 instead of subtracting 69.',
      'Added 6 + 4, rather than multiplied 6 X 4.',
      'Subtracted 6x−5, rather than added 5 + 6x.',
      'Multiplied 6 x 4 incorrectly, resulting in y = 5 + 18, rather than y = 5 + 24.',
      'Completed the equation inside the parentheses, but then did not multiply that answer by 7 to complete the problem.',
      'Disregarded the parentheses and simply added from left to right.',
      'Multiplied 6 and 7 together to get 42, and then added 4, without realizing that 4 needed to be added to 6 BEFORE it was multiplied to 7 in order to get the correct answer.',
      'Made multiple errors: forgetting to multiply by x and representing 8% with the incorrect decimal.',
      'Recognized these were the operations involved, multiplication by 6 and addition of the 30, but not realized the use of parentheses changes the order in which they are applied.',
      'Misidentified which value should be constant and which should be the coefficient of a variable term.',
      'Multiplied 2×3 for the numerator and 3×3 for the denominator, and then reduced the fraction.',
      'Cubed the numerator, but may have multiplied 3×3 for the denominator.',
    ],
  },
  '6.G': {
    strand: 'G',
    dokPresent: { 1: 10, 2: 16, 3: 0, 4: 0 },
    dokGap: { dok3: 8, dok4: 3 },
    misconceptions: [
      'Thought the area of the parallelogram was 18 square meters and looked to find the area of triangle ABC.',
      'Thought the question in the stem asked to find the area of the other triangle (ADC) in the figure.',
      'Thought to add the area of one triangle plus 1/2 the area of the other triangle to get the area of the parallelogram.',
      'Focused on part of the formula for finding the area of a triangle.',
      'Multiplied the length of the parallelogram by the length of the side of the parralleogram and assumed that this would give them the area.',
      'Forgotten to take half of 3×4 when finding the area of the triangle.',
      'Thought that (4×5)+(3×4) was the same as 2 (3×4) (4×5)+ .',
      'Incorrectly believed the hypotenuse of 5 to be the height of the triangle.',
      'Calculated the area of the triangle rather than the area of the parallelogram.',
      'Calculated the product of 11 and 12 as 121 rather than 132 when finding the area of the parallelogram.',
      'Multiplied 5 (length of each edge) by 6 (number of squares).',
      'Chosen this because of the rectangles in the pattern and because they identified the shape as a prism.',
      'Chosen this because of the rectangles in the pattern.',
      'Thought this was a pyramid because of the triangles which are usually present in pyramids.',
      'Realized that the shape would be triangular, but may have forgotten that a pyramid would only have one triangle.',
      'Multiplied the left side length (16 + 6) by the top width (18 + 6 + 18 + 6).',
      'Chosen this option because it is the volume of the figure.',
      'Used a rectangle of 16 ft by 4 ft yielding 64 square feet, but then forgot to account for the fact that the triangle has half the area of the rectangle.',
      'Thought that the area of a parallelogram was found by the formula A = bh/2.',
      'Confused a square pyramid with a triangular prism because both contain triangles and quadrilaterals to form a solid.',
      'Been unfamiliar with how to fold a net to make a solid and assumed that this was correct because it has three triangles.',
      'Multiplied by 2, instead of dividing by 2.',
      'Multiplied 8 with 4 and forgot to square the inches.',
    ],
  },
  '6.SP': {
    strand: 'SP',
    dokPresent: { 1: 3, 2: 10, 3: 2, 4: 0 },
    dokGap: { dok3: 5, dok4: 1 },
    misconceptions: [
      'Selected a data set whose median is equal to its mean.',
      'Selected a data set whose median is slightly more than its mean.',
      'Selected a data set whose median is slightly less than its mean.',
      'Misrepresented the data by misplacing the outlier.',
      'Believed this was the best option because this is the age group directly affected by this issue not realizing this could result in biased data.',
      'Believed this option was best because senior citizens were least affected by the change in the law, not realizing that a representative sample should include a proportional amount of individuals affected by the law.',
      'Been influenced by the fact this group deals with traffic accidents on a daily basis and would be better informed on the issue, not realizing that the lack of 16–18 year olds in this sample still makes option A more representative of the entire city population.',
      'Believed this removed any bias, not realizing that by eliminating many potential Craig supporters this sample is now biased in the other direction.',
      'Felt restricting the size of the sample improved its quality but in this scenario a sample of 6 students is too small.',
      'Considered teachers a stabilizing influence in the sample, forgetting that teachers will not have a vote and thus are not part of an appropriate sample.',
      'Incorrectly identified the smallest number of the data set as the range.',
      'Mistakenly identified the number of observations as the range.',
      'Incorrectly identified the largest number of the data set as the range.',
      'Incorrectly assumed that 20 was the highest number sold because 20 is the highest number marked on the number line.',
      'Been confused because the section of the box plot greater than six bars is larger than the section representing fewer than six bars.',
      'Confused interquartile range with the third quartile.',
      'Forgotten to reorder the data before finding the median.',
      'Incorrectly determined the mode believing it to be greatest value not the most often occurring data item.',
      'Misunderstood how to find one or more of the measures and believed this to be true.',
      'Selected this option after having found the Mode and Median of the 5 employee salaries was $6 per hour.',
      'Thought that the average is now less than 1, or did not understand that when a number less than the average is added to a set, the average decreases.',
      'Thought that the average of the four numbers is 1, or did not understand that when a number less than the average is added to a set, the average decreases.',
      'Mistakenly added 31 to the "upper end" of the number list, instead of putting it before the 33.',
      'Chosen this option because the mode moves farther up the list of numbers: from the 4th and 5th numbers in the list to the 5th and 6th.',
      'Incorrectly subtracted 7 from 15 (by subtracting the ones place in the wrong order) to yield 12.',
      'Thought that a list of values that are all 12 would have a range of 12.',
      'Thought any list of 12 values would have a range of 12.',
      'Chosen this option because the mean would be computed by dividing by 6 instead of 5.',
      'Known the middle of the data set would shift to a position farther "up" the list of numbers, but not realized the median still has the same value: the average of 8 and 8.',
      'Chosen this answer after having determined the first three options were incorrect, not realizing that the median actually stays the same.',
    ],
  },
};

/** Look up the curated G6 seed for a standard code (e.g. "6.RP", "MGSE6.RP.3", "6.RP.A.1", "6.NR.4"). */
export function g6SeedForStandard(standard: string): G6SeedDomain | null {
  const s = (standard || '').toUpperCase();
  if (!s.includes('6')) return null;
  for (const key of Object.keys(G6_SEED)) {
    const dom = key.split('.')[1]; // RP, NS, EE, G, SP
    if (new RegExp('6\\.?' + dom + '(\\b|\\.|$)').test(s)) return G6_SEED[key];
  }
  return null;
}
