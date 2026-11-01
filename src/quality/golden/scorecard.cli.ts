/**
 * Prints the golden-suite scorecard as Markdown.
 *   npm run quality:scorecard
 * CI appends this to the GitHub run summary on every push.
 */
import { scorecardMarkdown } from './scorecard';

process.stdout.write(scorecardMarkdown() + '\n');
