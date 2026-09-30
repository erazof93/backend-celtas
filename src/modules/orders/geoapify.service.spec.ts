import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { GeoapifyService } from './geoapify.service';

describe('GeoapifyService', () => {
  let service: GeoapifyService;
  let configService: { get: jest.Mock };
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  const jsonResponse = (body: unknown, status = 200) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }) as Response;

  // Forma real de /v1/geocode/search?format=json (verificada contra la API).
  const carabayaResult = {
    lat: -12.0466994,
    lon: -77.03041,
    formatted:
      'Jirón Carabaya 250, Urbanización Cercado de Lima, Lima 15001, Perú',
    rank: { confidence: 0.9 },
  };

  beforeEach(async () => {
    configService = {
      get: jest.fn((key: string) =>
        key === 'geoapify.apiKey' ? 'test-key' : undefined,
      ),
    };
    // Nunca red real en tests unitarios.
    fetchMock = jest.spyOn(global, 'fetch');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeoapifyService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(GeoapifyService);
  });

  afterEach(() => fetchMock.mockRestore());

  it('resultado confiable → [lat, lon]', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [carabayaResult] }));

    await expect(service.geocode('Jr. Carabaya 250, Lima')).resolves.toEqual([
      -12.0466994, -77.03041,
    ]);
  });

  it('envía text, apiKey, lang=es, filter=countrycode:pe, limit=1, format=json', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [carabayaResult] }));

    await service.geocode('Jr. Carabaya 250, Lima');

    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.origin + url.pathname).toBe(
      'https://api.geoapify.com/v1/geocode/search',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      text: 'Jr. Carabaya 250, Lima',
      apiKey: 'test-key',
      lang: 'es',
      filter: 'countrycode:pe',
      limit: '1',
      format: 'json',
    });
  });

  it('sin resultados → null', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));

    await expect(service.geocode('xyzabc123notreal')).resolves.toBeNull();
  });

  it('confianza < 0.5 → null (evita coordenadas de otra calle)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [{ ...carabayaResult, rank: { confidence: 0.09375 } }],
      }),
    );

    await expect(service.geocode('Av. Los Héroes 500')).resolves.toBeNull();
  });

  it('confianza exactamente 0.5 → se acepta', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [{ ...carabayaResult, rank: { confidence: 0.5 } }],
      }),
    );

    await expect(service.geocode('x')).resolves.toEqual([
      -12.0466994, -77.03041,
    ]);
  });

  it('Geoapify responde 429 (rate limit) → 503', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Too Many' }, 429));

    await expect(service.geocode('x')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('error de red / timeout → 503', async () => {
    fetchMock.mockRejectedValue(new Error('The operation was aborted'));

    await expect(service.geocode('x')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  describe('QA — seguridad y robustez', () => {
    it('texto con &, #, ?, = y tildes va URL-encoded: no inyecta params ni pisa apiKey', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ results: [carabayaResult] }));
      const evil =
        'Av. Perú #12 & Jr. Ñandú?apiKey=robada&limit=50&filter=countrycode:us';

      await service.geocode(evil);

      const url = fetchMock.mock.calls[0][0] as URL;
      expect(url.searchParams.getAll('text')).toEqual([evil]);
      expect(url.searchParams.getAll('apiKey')).toEqual(['test-key']);
      expect(url.searchParams.getAll('limit')).toEqual(['1']);
      expect(url.searchParams.getAll('filter')).toEqual(['countrycode:pe']);
      expect(url.hash).toBe('');
    });

    it.each([
      ['429', () => fetchMock.mockResolvedValue(jsonResponse({}, 429))],
      ['500', () => fetchMock.mockResolvedValue(jsonResponse({}, 500))],
      ['red', () => fetchMock.mockRejectedValue(new TypeError('fetch failed'))],
      [
        'JSON inválido',
        () =>
          fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.reject(new SyntaxError('Unexpected token <')),
          } as unknown as Response),
      ],
    ])(
      'falla %s → 503 en español; ni el log ni la respuesta contienen la apiKey',
      async (_label, arrange) => {
        arrange();
        const warnSpy = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);
        const errorSpy = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);

        const err = await service.geocode('x').catch((e: unknown) => e);

        expect(err).toBeInstanceOf(ServiceUnavailableException);
        const exc = err as ServiceUnavailableException;
        expect(exc.message).toMatch(/geocodificación no está disponible/);
        expect(JSON.stringify(exc.getResponse())).not.toContain('test-key');
        expect(warnSpy).toHaveBeenCalled();
        expect(
          JSON.stringify([...warnSpy.mock.calls, ...errorSpy.mock.calls]),
        ).not.toContain('test-key');
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      },
    );

    it('body sin `results` → null (no revienta)', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));

      await expect(service.geocode('x')).resolves.toBeNull();
    });

    it('resultado sin `rank` → null (confianza desconocida = baja)', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ results: [{ lat: -12, lon: -77 }] }),
      );

      await expect(service.geocode('x')).resolves.toBeNull();
    });
  });

  it('sin GEOAPIFY_API_KEY → 503 sin llamar a la red', async () => {
    configService.get.mockReturnValue(undefined);

    await expect(service.geocode('x')).rejects.toThrow(
      new ServiceUnavailableException(
        'El servicio de geocodificación no está configurado',
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
