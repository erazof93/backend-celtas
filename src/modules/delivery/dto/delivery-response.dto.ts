import { ApiProperty } from '@nestjs/swagger';
import { DeliveryMode } from '../delivery-mode';
import type { DeliveryPolygon } from '../polygon.util';
import { DeliveryPolygonDto } from './delivery-polygon.dto';

export class DeliveryZoneSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  name: string;
}

export class DeliveryEstimateDto {
  @ApiProperty({
    description:
      'Soles; 0 sin cobertura es un marcador, no una cotización gratuita',
  })
  deliveryFee: number;
  @ApiProperty({
    description:
      'Distancia exacta mayor que delivery_alert_radius_meters; nunca representa cobertura',
  })
  isFarOrder: boolean;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Distancia Haversine redondeada a 50 m; null sin coordenadas',
  })
  distanceMeters: number | null;
  @ApiProperty({
    description:
      'DISTANCE permite pedidos incluso sin coordenadas; ZONES requiere una zona activa',
  })
  isCovered: boolean;
  @ApiProperty({ enum: DeliveryMode })
  deliveryMode: DeliveryMode;
  @ApiProperty({ type: DeliveryZoneSummaryDto, nullable: true })
  zone: DeliveryZoneSummaryDto | null;
}

export class DeliveryZoneResponseDto extends DeliveryZoneSummaryDto {
  @ApiProperty({
    type: DeliveryPolygonDto,
    description: 'GeoJSON Polygon sin huecos, [longitude, latitude]',
  })
  polygon: DeliveryPolygon;
  @ApiProperty()
  fee: number;
  @ApiProperty()
  active: boolean;
  @ApiProperty({ format: 'date-time', type: String })
  createdAt: Date;
  @ApiProperty({ format: 'date-time', type: String })
  updatedAt: Date;
}

/** Swagger documents the same envelope applied by TransformInterceptor. */
export class DeliveryEstimateResponseDto {
  @ApiProperty({ example: true })
  success: boolean;
  @ApiProperty({ type: DeliveryEstimateDto })
  data: DeliveryEstimateDto;
}

export class DeliveryZoneEnvelopeDto {
  @ApiProperty({ example: true })
  success: boolean;
  @ApiProperty({ type: DeliveryZoneResponseDto })
  data: DeliveryZoneResponseDto;
}

export class DeliveryZoneListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;
  @ApiProperty({ type: [DeliveryZoneResponseDto] })
  data: DeliveryZoneResponseDto[];
}

/** No FK: deleting or editing a zone must never rewrite order history. */
export interface DeliverySnapshot {
  deliveryMode: DeliveryMode;
  zone: DeliveryZoneSummaryDto | null;
  /** Legacy admin exception, retained only to read historical snapshots. New orders never set it. */
  fallbackFromZones?: boolean;
}
