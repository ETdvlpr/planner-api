import { ValidationPipe } from '@nestjs/common';
import { TaskQueryDto } from './tasks.dto';

// Mirrors the global pipe in main.ts so the DTO is exercised the way a
// real request would be.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const meta = { type: 'query' as const, metatype: TaskQueryDto, data: '' };

describe('TaskQueryDto', () => {
  it('accepts a single status, which the query parser hands over as a string', async () => {
    const dto = (await pipe.transform(
      { status: 'next' },
      meta,
    )) as TaskQueryDto;
    expect(dto.status).toEqual(['next']);
  });

  it('accepts a repeated status as an array', async () => {
    const dto = (await pipe.transform(
      { status: ['next', 'waiting'] },
      meta,
    )) as TaskQueryDto;
    expect(dto.status).toEqual(['next', 'waiting']);
  });

  it('leaves status undefined when not sent', async () => {
    const dto = (await pipe.transform({}, meta)) as TaskQueryDto;
    expect(dto.status).toBeUndefined();
  });

  it('still rejects a value outside the enum', async () => {
    await expect(pipe.transform({ status: 'bogus' }, meta)).rejects.toThrow();
  });
});
