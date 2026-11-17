import { ValidationPipe } from '@nestjs/common';
import { AnswersDto, CreateWorksheetDto, UpdateFiguresDto } from './worksheet.dto';

// The same settings as main.ts: unknown fields are refused, so every field the
// browser sends (including each question's crop) must be declared here.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const run = (metatype: any, value: unknown) => pipe.transform(value, { type: 'body', metatype });

describe('worksheet DTOs under the live validation settings', () => {
  const q = { context: 'Story', stem: 'Q1', table: { headers: ['a'], rows: [['1']] }, figureImage: 'data:image/png;base64,AA==', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, feedback: { A: 'x' }, crop: { page: 1, x: 0.1, y: 0.2, w: 0.4, h: 0.2 } };

  it('accepts a question with a crop (what the check screen sends)', async () => {
    const out = await run(CreateWorksheetDto, { title: 'T', pageImages: ['data:image/jpeg;base64,AA=='], questions: [q], key: ['C'] });
    expect(out.questions[0].crop).toEqual(q.crop);
    expect(out.questions[0].table).toEqual(q.table);
    expect(out.questions[0].figureImage).toBe(q.figureImage);
  });

  it('still refuses unknown fields', async () => {
    await expect(run(CreateWorksheetDto, { title: 'T', pageImages: ['x'], questions: [{ ...q, n: 1 }], key: ['C'] })).rejects.toBeTruthy();
    await expect(run(CreateWorksheetDto, { title: 'T', pageImages: ['x'], questions: [q], key: ['C'], score: 15 })).rejects.toBeTruthy();
  });

  it('answers: a client cannot send a score alongside its letters', async () => {
    await expect(run(AnswersDto, { answers: ['A'], score: 15 })).rejects.toBeTruthy();
    expect((await run(AnswersDto, { answers: ['A', null] })).answers).toEqual(['A', null]);
  });

  it('fix graphs (17 Nov): replace with a picture or remove with null; nothing else accepted', async () => {
    const out = await run(UpdateFiguresDto, { figures: [{ n: 3, image: 'data:image/png;base64,AA==' }, { n: 5, image: null }] });
    expect(out.figures.map((f: any) => f.n)).toEqual([3, 5]);
    await expect(run(UpdateFiguresDto, { figures: [] })).rejects.toBeTruthy();
    await expect(run(UpdateFiguresDto, { figures: [{ n: 0, image: null }] })).rejects.toBeTruthy();
    await expect(run(UpdateFiguresDto, { figures: [{ n: 1, image: null, stem: 'changed' }] })).rejects.toBeTruthy();
  });
});
