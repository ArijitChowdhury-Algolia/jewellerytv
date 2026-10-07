import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { evaluateGraduationReview } from './graduationReview';

const [summaryPath, reviewPath] = process.argv.slice(2);
if (!summaryPath || !reviewPath) {
  throw new Error('Usage: tsx graduation-review.ts <summary.json> <independent-review.json>');
}
const raw = fs.readFileSync(summaryPath);
const summarySha256 = createHash('sha256').update(raw).digest('hex');
const summary = JSON.parse(raw.toString('utf8'));
const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
if (review.summarySha256 !== summarySha256)
  throw new Error('Independent review does not match this immutable run summary');
const result = evaluateGraduationReview(summary, review);
const output = path.join(path.dirname(summaryPath), 'acceptance-review.json');
if (fs.existsSync(output))
  throw new Error('Acceptance review already exists; preserve the earlier judgment');
fs.writeFileSync(
  output,
  JSON.stringify({ summarySha256, reviewPath: path.resolve(reviewPath), ...result }, null, 2),
);
process.stdout.write(`${JSON.stringify({ output, ...result })}\n`);
if (!result.accepted) process.exitCode = 1;
