import { ApiProperty } from '@nestjs/swagger';
import { MAX_RING_POSITIONS } from '../polygon.util';
import type { DeliveryPolygon, Position } from '../polygon.util';

/** Shape for Swagger; the custom validator also validates topology and rejects extra keys. */
export class DeliveryPolygonDto implements DeliveryPolygon {
  @ApiProperty({ enum: ['Polygon'] })
  type: 'Polygon';

  @ApiProperty({
    type: 'array',
    minItems: 1,
    maxItems: 1,
    description:
      'Un anillo exterior cerrado, sin huecos. Posiciones [longitude, latitude]',
    items: {
      type: 'array',
      minItems: 4,
      maxItems: MAX_RING_POSITIONS,
      items: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: { type: 'number' },
      },
    },
  })
  coordinates: Position[][];
}
