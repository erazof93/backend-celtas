import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GEOAPIFY_SEARCH_URL = 'https://api.geoapify.com/v1/geocode/search';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Confianza mínima (`rank.confidence`, 0..1) para aceptar un resultado. Por debajo,
 * Geoapify devuelve coincidencias sin relación con el texto (verificado: "Av. Los
 * Héroes 500" sin distrito → "Avenida Alfredo Benavides 5540" con confidence 0.09),
 * y es preferible un "no encontrada" a unas coordenadas equivocadas.
 */
const MIN_CONFIDENCE = 0.5;

interface GeoapifySearchResponse {
  results?: {
    lat: number;
    lon: number;
    rank?: { confidence?: number };
  }[];
}

/**
 * Cliente de Geoapify (Geocoding API, `GET /v1/geocode/search`), mismo proveedor y
 * mismos parámetros (`lang=es`, `filter=countrycode:pe`) que usa la app cliente.
 * Sin SDK: es un endpoint REST simple, se usa el `fetch` nativo de Node.
 *
 * El rate limit del plan gratis (5 req/seg) es compartido con la app — por eso el
 * endpoint que lo expone exige JWT.
 */
@Injectable()
export class GeoapifyService {
  private readonly logger = new Logger(GeoapifyService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Texto → `[latitude, longitude]`, o `null` si no hay un resultado confiable.
   * Lanza 503 si falta la API key o si Geoapify falla (429, 5xx, red, timeout):
   * es un problema del servicio, no de la dirección enviada.
   */
  async geocode(text: string): Promise<[number, number] | null> {
    const apiKey = this.configService.get<string>('geoapify.apiKey');
    if (!apiKey) {
      this.logger.error('GEOAPIFY_API_KEY no está configurada');
      throw new ServiceUnavailableException(
        'El servicio de geocodificación no está configurado',
      );
    }

    const url = new URL(GEOAPIFY_SEARCH_URL);
    url.search = new URLSearchParams({
      text,
      apiKey,
      lang: 'es',
      filter: 'countrycode:pe',
      limit: '1',
      format: 'json',
    }).toString();

    let body: GeoapifySearchResponse;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Geoapify respondió ${response.status}`);
      }
      body = (await response.json()) as GeoapifySearchResponse;
    } catch (error) {
      this.logger.warn(
        `Fallo al geocodificar: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(
        'El servicio de geocodificación no está disponible, intenta de nuevo en unos segundos',
      );
    }

    const result = body.results?.[0];
    if (!result || (result.rank?.confidence ?? 0) < MIN_CONFIDENCE) {
      return null;
    }
    return [result.lat, result.lon];
  }
}
