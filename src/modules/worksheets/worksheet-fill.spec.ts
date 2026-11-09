import { fillOptionsFromPdfText, normalizeQuestions } from './worksheet-logic';

// Text exactly as pdf.js extracts it from the real Proportional_or_Not_Homework_AD.pdf.
const PDF_TEXT = "H O M E W O R K   ·   F R O N T   ·   G R A D E   7   U N I T   3   ·   7 . P A R . 4 . 3  Proportional or Not? Homework   A–D VERSION  Name   Date   Period  F O R E V E RY P R O B L E M  1   Read it two times.  2   Underline the numbers and units.  3   Look for the word   plus   or a starting fee.  4   Work it out, then choose A, B, C or D.  4 T E S T S F O R P R O P O R T I O N A L  1. Same multiplier   every time  2. Zero test:   0   →   0  3. Double test:   double one, the other doubles  4. Graph test:   straight line through (0, 0) If one test fails, it is   not   proportional.  15 questions.   Choose one answer for each question in EdKairos. Use scrap paper to work it out.  Practice   R E I N F O R C E   T O D A Y ’ S   L E S S O N  E L L I E · C A R D S  Greeting cards cost $0.80 each. Ellie buys 13 cards. Let   n  = the number of cards. Let   c   = the cost in dollars.  1   How much do 13 cards cost?  A   $1.04   B   $8.00   C   $10.40   D   $13.80  2   Which equation shows Ellie’s cost?  A   c   =   n   + 0.80   B   c   = 13 n  C   n   = 0.80 c   D   c   = 0.80 n  C H E R I E · TA X I  The taxi charges $4   plus   $1.50 per mile. Cherie rides 7 miles.  3   How much does the 7-mile ride cost?  A   $5.50   B   $10.50   C   $14.50   D   $38.50  4   Is the taxi cost proportional? Why?  A   Proportional: each mile adds the same $1.50  B   Proportional: a 0-mile ride costs $0  C   Not proportional: 1 mile costs $4  D   Not proportional: a 0-mile ride costs $4  G R A P H T E S T  0  Graph 1  0  Graph 2  0  Graph 3  5   Which graph shows Cherie’s taxi ($4 plus $1.50 per mile)?  A   Graph 1   B   Graph 2   C   Graph 3   D   None of these  6   Which graph is proportional? Why?  A   Graph 1: it is a straight line   B   Graph 3: it starts at (0, 0)  C   Graph 3: it is the steepest line   D   Graph 2: it is a straight line through (0, 0)  I N T E R N E T  The first 5 GB each month are free. Each extra GB costs $2.  7   How much does 10 GB cost?  A   $5   B   $10   C   $12   D   $20  8   Use the double test: 5 GB   →   10 GB. Is it proportional?  A   Proportional: each extra GB costs the same $2  B   Proportional: double the GB, double the cost  C   Not proportional: $0 doubled is not $10  D   Not proportional: the cost is never $0  D E X T E R · S C A L E D R AW I N G  1 inch on Dexter’s drawing = 2 feet in his room. The room is 10 feet wide and 14 feet long.  Width on drawing: 10 ÷ 2 = 5 inches  9   How long is the room on the drawing?  A   7 inches   B   12 inches  C   16 inches   D   28 inches  Adapted from GaDOE Grade 7 Unit 3 “Classifying Proportion and Non-proportion Situations” and MARS, Shell Center (CC BY-NC-SA 4.0)   Redan Middle School · Side 1 of 2\nH O M E W O R K   ·   B A C K  Practice   T A B L E S   A N D   E Q U A T I O N S  G A S  Let   g   = the number of gallons. Let   c   = the cost in dollars. Use the same multiplier test.  Gallons ( g )   Cost ( c )   Cost ÷ gallons  2   $7   7 ÷ 2 = 3.50 4   $14 6   $21  10   Which equation fits the table?  A   c   = 2 g   B   c   = 3.50 g  C   c   = 7 g   D   c   =   g   + 5  M O V I E T I C K E T S  Each ticket costs $8,   plus   a $3 fee for the whole order.  1 ticket: 8 + 3 = $11  11   How much do 2 tickets cost?  A   $11   B   $16   C   $19   D   $22  12   Use the double test. Is it proportional?  A   Not proportional: 2 tickets cost $19, not double $11  B   Not proportional: the $3 fee is charged for each ticket  C   Proportional: 2 tickets cost twice as much as 1  D   Proportional: 2 tickets cost $16, which is double $8  E Q U AT I O N S  A proportional equation looks like   y   =   k   ·   x , with nothing added. Let   x   = how many. Let   y   = the total.  y   = 4 x   y   =   x   + 4   y   = 4 x   + 1   y   =   1 2   x  13   Which equations are proportional?  A   y   = 4 x   only   B   y   = 4 x   and   y   =   1 2   x  C   y   = 4 x   and   y   = 4 x   + 1   D   All four  Challenge   E X T E N D   T H E   L E S S O N  O R H A N ’ S PA I N T, H A R D E R N U M B E R S  Orhan uses 3 pints of blue for every 5 pints of red. He has 17   1 2   pints of red.  Red (pints)   5   10   15   2   1 2   17   1 2  Blue (pints)   3   6   9  Hint: 2   1  2   is half of 5, so blue is half of 3. Then 15 + 2   1  2   = 17   1  2   .  14   How much blue does Orhan need?  A   9 pints   B   10   1 2   pints   C   15   1 2   pints   D   29   1 6   pints  M A K E I T P R O P O R T I O N A L  A new taxi company has   no   $4 starting fee. It only charges $1.50 per mile.  7 miles: 7 × 1.50 = $______   Zero test: 0 miles costs $______  15   Is the new taxi proportional? Why?  A   Not proportional: it still charges for every mile   B   Proportional: 7 miles costs $14.50  C   Not proportional: 0 miles still costs $4   D   Proportional: 0 miles costs $0, and every mile costs $1.50  Talk at home:   Ask someone, “What do we buy that costs the same for each one?” Their answer:  Adapted from GaDOE Grade 7 Unit 3 “Classifying Proportion and Non-proportion Situations” and MARS, Shell Center (CC BY-NC-SA 4.0)   Redan Middle School · Side 2 of 2\n";
const STEMS = ['How much do 13 cards cost?', 'Which equation shows Ellie’s cost?', 'How much does the 7-mile ride cost?', 'Is the taxi cost proportional? Why?', 'Which graph shows Cherie’s taxi ($4 plus $1.50 per mile)?', 'Which graph is proportional? Why?', 'How much does 10 GB cost?', 'Use the double test: 5 GB → 10 GB. Is it proportional?', 'How long is the room on the drawing?', 'Which equation fits the table?', 'How much do 2 tickets cost?', 'Use the double test. Is it proportional?', 'Which equations are proportional?', 'How much blue does Orhan need?', 'Is the new taxi proportional? Why?'];
const blank = () => normalizeQuestions(STEMS.map((stem) => ({ stem, options: { A: '', B: '', C: '', D: '' } })));

describe('fillOptionsFromPdfText (real homework PDF text)', () => {
  it('fills every question that the AI left blank, in order', () => {
    const qs = blank();
    expect(fillOptionsFromPdfText(qs, PDF_TEXT)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(qs[0].options).toEqual({ A: '$1.04', B: '$8.00', C: '$10.40', D: '$13.80' });
    expect(qs[1].options).toEqual({ A: 'c = n + 0.80', B: 'c = 13n', C: 'n = 0.80c', D: 'c = 0.80n' });
    expect(qs[3].options.D).toBe('Not proportional: a 0-mile ride costs $4');
    expect(qs[8].options).toEqual({ A: '7 inches', B: '12 inches', C: '16 inches', D: '28 inches' });
    expect(qs[9].options).toEqual({ A: 'c = 2g', B: 'c = 3.50g', C: 'c = 7g', D: 'c = g + 5' });
    expect(qs[11].options.A).toBe('Not proportional: 2 tickets cost $19, not double $11');
    expect(qs[11].options.D).toBe('Proportional: 2 tickets cost $16, which is double $8');
    expect(qs[12].options).toEqual({ A: 'y = 4x only', B: 'y = 4x and y = 1/2x', C: 'y = 4x and y = 4x + 1', D: 'All four' });
    expect(qs[13].options).toEqual({ A: '9 pints', B: '10 1/2 pints', C: '15 1/2 pints', D: '29 1/6 pints' });
    expect(qs[14].options.D).toBe('Proportional: 0 miles costs $0, and every mile costs $1.50');
  });
  it('never touches choices the AI already gave', () => {
    const qs = blank();
    qs[0].options = { A: 'w', B: 'x', C: 'y', D: 'z' };
    expect(fillOptionsFromPdfText(qs, PDF_TEXT)).not.toContain(1);
    expect(qs[0].options.A).toBe('w');
  });
  it('does nothing without a text layer or without four lettered choices', () => {
    expect(fillOptionsFromPdfText(blank(), '')).toEqual([]);
    const qs = normalizeQuestions([{ stem: 'Is it proportional?', options: {} }]);
    expect(fillOptionsFromPdfText(qs, '  1   Is it proportional?   Circle:  Proportional  /  Not proportional  ')).toEqual([]);
  });
  it('reads options however the AI shapes them', () => {
    const [a, b, c] = normalizeQuestions([
      { stem: 's', options: ['$1', '$2', '$3', '$4'] },
      { stem: 's', options: { a: 'A) $1', b: 'B. $2', c: '$3', d: 4 } },
      { stem: 's', options: [{ letter: 'A', text: 'one' }, { letter: 'B', text: 'two' }, { letter: 'C', text: 'three' }, { letter: 'D', text: 'four' }] },
    ]);
    expect(a.options).toEqual({ A: '$1', B: '$2', C: '$3', D: '$4' });
    expect(b.options).toEqual({ A: '$1', B: '$2', C: '$3', D: '4' });
    expect(c.options.C).toBe('three');
  });
});
