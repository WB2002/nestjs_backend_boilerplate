import { BadRequestException } from '@nestjs/common';
import { SanitizationPipe } from '../pipes';
import { SkipSanitization } from '../decorators';

class SampleDto {
  @SkipSanitization()
  declare password: string;

  declare name: string;
}

describe('SanitizationPipe', () => {
  const pipe = new SanitizationPipe();

  it('strips HTML on body fields and skips decorated password', async () => {
    const result = (await pipe.transform(
      { name: '<b>Ada</b>', password: '<script>x</script>' },
      { type: 'body', metatype: SampleDto },
    )) as SampleDto;

    expect(result.name).toBe('Ada');
    expect(result.password).toBe('<script>x</script>');
  });

  it('rejects SQL injection in query strings', async () => {
    await expect(
      pipe.transform({ q: "' OR 1=1 --" }, { type: 'query', metatype: Object }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns custom args (e.g. @Req) unchanged without walking them', async () => {
    const cyclic: { self?: unknown; name: string } = {
      name: '<b>req</b>',
    };
    cyclic.self = cyclic;

    const result = await pipe.transform(cyclic, {
      type: 'custom',
      metatype: Object,
    });

    expect(result).toBe(cyclic);
    expect((result as { name: string }).name).toBe('<b>req</b>');
  });
});
