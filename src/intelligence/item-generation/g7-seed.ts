/**
 * EdKairos · item-generation · Grade-7 seed library (curated)
 *
 * Abstracted misconception patterns + DOK-gap targets from Illuminate DnA (Inspect
 * Premium) G7 item banks. REFERENCE-ONLY: no stems copied; seeds ORIGINAL item
 * generation. 7.SP is intentionally thin (few written rationales) — supplement by
 * generating from the standard.
 */

import type { G6SeedDomain } from './g6-seed';

export const G7_SEED: Record<string, G6SeedDomain> = {
  '7.RP': {
    strand: 'RP',
    dokPresent: { 1: 5, 2: 14, 3: 1, 4: 0 },
    dokGap: { dok3: 6, dok4: 2 },
    misconceptions: [
      'Incorrectly set up the equation and divided 1/4 by 2 1/2.',
      'Multiplied 2 1/2 by 1/4 instead of multiplying by the reciprocal of 1/4.',
      'Found the total cost of the haircut and tip.',
      'Focused on the only point mentioned in the graph.',
      'Chosen this option because it is the amount of money Horace will save.',
      'Subtracted 25 cents instead of 25 percent.',
      'Added the value of the coupon instead of subtracting it.',
      'Selected this response without considering all choices or may have switched x and 9.',
      'Mixed up the drawings and switched x and 6.',
      'Misunderstood the drawing and switched x and 9 in the drawing.',
      'Thought the cost is equal to the rate plus the distance traveled.',
      'Thought the cost is equal to the rate divided by the distance.',
      'Thought the cost is equal to the distance minus the rate.',
      'Calculated the decimal number of increase, but converted the decimal to percentage incorrectly.',
    ],
  },
  '7.NS': {
    strand: 'NS',
    dokPresent: { 1: 12, 2: 13, 3: 0, 4: 0 },
    dokGap: { dok3: 8, dok4: 3 },
    misconceptions: [
      'Added the 2 numbers together and dropped the negative signs.',
      'Added correctly but may have kept the wrong sign.',
      'Subtracted instead of adding the opposite.',
      'Calculated 5 – 2 but may have made a mistake with the negative sign.',
      'Found 5 – 2, either having missed the negative sign, or student(s) may have misunderstood the question.',
      'Multiplied the numerators together and divided it by the denominator.',
      'Multiplied and then rounded the product to the nearest whole number to find the answer.',
      'Subtracted and then rounded the difference to the nearest whole number to find the answer.',
      'Divided 3/4 and 1/4, and may have added 4 to their answer.',
      'Believed that because the negative signs are completely removed, this equation is not correct.',
    ],
  },
  '7.EE': {
    strand: 'EE',
    dokPresent: { 1: 6, 2: 17, 3: 5, 4: 0 },
    dokGap: { dok3: 9, dok4: 3 },
    misconceptions: [
      'Used 0 instead of 1 as the coefficient for –x when combining like terms.',
      'Incorrectly believed 5x – x removed the x from the 5x term.',
      'Combined the x and 3x terms before subtracting.',
      'May only found the first part of the answer and forgot to add in the last x.',
      'Multiplied the 3 and 2x together, but forgot to distribute and multiply the 3 and −6 together as well.',
      'Thought that the 3 and 2 should be added together, and also did not reduce by combining all like terms.',
      'Ignored the function rule and mirrored the "+4" change in the first three rows of the table.',
      'Reversed the function rule and evaluated 2 + 5(7) instead of 5 + 2(7).',
      'Only distributed the 3 and the −5 to the first term of each parentheses.',
      'Confused the rules of adding like terms and combined the terms in the parentheses first getting 8x + 3(5x) − 5(−4x).',
      'Multiplied, getting 8x + 15x + 20x, and adding them.',
      'Disregarded the 7x on the left hand side of the equation, and incorrectly subtracted 15x from −9x, instead of adding it.',
      'Multiplied everything on the left side of the inequality, including the 7x, prior to combining like terms.',
      'Multiplied the first term but did not use the distributive property properly.',
      'Swapped the negative signs when solving this expression.',
      'Combined –8 and 2 to make the equation 16x – 6x = 100.',
      'Combined all the terms as if the constant term was a coefficient: simplifying as if all the terms on the left side were like terms.',
      'Simplified as if the subtraction affected all the terms which followed the operator as if the equation were 16x – (8 + 2x) = 100.',
      'Combined the 10 and 2 before distributing and only distributed the 12 to the first term in the parentheses.',
      'Combined the 10 and 2 before distributing.',
      'Only distributed the 2 to the first term of the parentheses.',
      'Combined the unlike terms within the parentheses prior to multiplication and combining like terms.',
      'Misinterpreted the "3 more than" and added 3 to the wrong term.',
      'Misinterpreted the "that was" phrase and applied all the operations to the 25 instead of the variable.',
      'Applied the "twice" operation to the number of points Lee scored instead of the points Alex scored.',
      'Added 1000 to 2000, rather than subtract 1000 from 2000, resulting in 250x ≥ 3000, which led to x ≥ 12.',
      'Divided the two terms on the left side of the equation to get x ≥ 1200 ÷ 10, or x ≥12.',
    ],
  },
  '7.G': {
    strand: 'G',
    dokPresent: { 1: 10, 2: 17, 3: 1, 4: 0 },
    dokGap: { dok3: 9, dok4: 3 },
    misconceptions: [
      'Added all of the shown numbers together and may not have known how to solve for the area that Phillip was mowing.',
      'Mistakenly added the area of the circle to the area of the rectangle instead of subtracting.',
      'Used the diameter instead of the radius when finding the area of the circle.',
      'Added pi, r, and r instead of multiplying those values together.',
      'Found the product π × d and divided that by 2 instead of dividing d by 2 and then squaring and multiplying that product by pi.',
      'Forgotten to take ½ the area of the base dimensions.',
      'Added the height of the prism instead of multiplying.',
      'Found the volume, pi(r) h, instead of the surface area.',
      'Assumed that 180 degrees was the total instead of using 90 degrees.',
      'Set the equation equal to 90° and then solved for x, i.',
      'Set the equation equal to 100° and then solved for x, i.',
      'Set the equation equal to 180° and then solved for x, i.',
      'Set the equation 2x – 12 equal to 90° and then solved for x.',
      'Set the equation equal to 180°, subtracted 32° from 180° (148°), and then solved for x.',
      'Set the equation 2x – 12 equal to 180° and then solved for x.',
      'Mistakenly used the equation for finding the circumference and thought the radius was the diameter and divided by 2.',
      'Found the circumference of the circle instead of the area.',
      'Mistakenly thought the radius was the diameter and divided by 2.',
      'Incorrectly converted feet to inches by dividing the product of 8, 3, and 2 by 12 twice instead of multiplying by 12 twice.',
      'Computed the volume without changing the units.',
      'Only multiplied by 12 one time to change the units.',
    ],
  },
  '7.SP': {
    strand: 'SP',
    dokPresent: { 1: 2, 2: 14, 3: 2, 4: 0 },
    dokGap: { dok3: 6, dok4: 2 },
    misconceptions: [
      'Been influenced by the 30% and believed that meant 30 brass players should have been surveyed.',
      'Recognized that brass players constituted a minority portion of the band and mistakenly believed that meant they should be excluded.',
      'Thought that asking an equal number of boys and girls meant that the sample is a representative sample.',
      'Thought that the girl sample size had to have 25 more than the boy sample size since the population of girls is 25 more than boys.',
    ],
  },
};

export function g7SeedForStandard(standard: string): G6SeedDomain | null {
  const s = (standard || '').toUpperCase();
  if (!s.includes('7')) return null;
  for (const key of Object.keys(G7_SEED)) {
    const dom = key.split('.')[1];
    if (new RegExp('7\\.?' + dom + '(\\b|\\.|$)').test(s)) return G7_SEED[key];
  }
  return null;
}
