import {
  deliveryPolygonError,
  deliveryPolygonsOverlap,
  pointInDeliveryPolygon,
} from './polygon.util';
import type { DeliveryPolygon, Position } from './polygon.util';

const square = (x = 0, y = 0, size = 2): DeliveryPolygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y],
    ],
  ],
});

describe('delivery polygons', () => {
  it.each<[Position, boolean]>([
    [[1, 1], true],
    [[3, 1], false],
    [[0, 1], true],
    [[2, 2], true],
    [[NaN, 1], false],
    [[1, Infinity], false],
    [[181, 1], false],
    [[1, 91], false],
  ])('point %j → %s (including borders and vertices)', (point, expected) => {
    expect(pointInDeliveryPolygon(point, square())).toBe(expected);
  });

  it('uses longitude first, accepts both windings and concave polygons', () => {
    const polygon: DeliveryPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-77, -12],
          [-76, -12],
          [-76.5, -11.5],
          [-76, -11],
          [-77, -11],
          [-77, -12],
        ],
      ],
    };
    expect(deliveryPolygonError(polygon)).toBeNull();
    expect(pointInDeliveryPolygon([-76.9, -11.5], polygon)).toBe(true);
    expect(pointInDeliveryPolygon([-76.1, -11.5], polygon)).toBe(false);
    expect(
      pointInDeliveryPolygon([-76.9, -11.5], {
        ...polygon,
        coordinates: [polygon.coordinates[0].slice().reverse()],
      }),
    ).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    { type: 'MultiPolygon', coordinates: [] },
    { type: 'Polygon', coordinates: [] },
    {
      ...square(),
      coordinates: [square().coordinates[0], square().coordinates[0]],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [0, 0],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [2, 0],
          [0, 0],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [2, 2],
          [0, 2],
          [2, 0],
          [0, 0],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 0],
          [0, 0],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [0, 0],
          [0, 1],
          [0, 0],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [181, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 91],
          [1, 1],
          [0, 0],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [Infinity, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          ['1', 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0, 0],
          [1, 0],
          [1, 1],
          [0, 0, 0],
        ],
      ],
    },
    { ...square(), extra: true },
    {
      type: 'Polygon',
      coordinates: [
        [
          [-179, 0],
          [179, 0],
          [179, 1],
          [-179, 0],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [Array.from({ length: 501 }, () => [0, 0])],
    },
  ])('rejects invalid geometry %j', (value) =>
    expect(deliveryPolygonError(value)).not.toBeNull(),
  );

  it.each([
    [square(), square(1, 1), true],
    [square(), square(0.5, 0.5, 0.5), true],
    [square(), square(), true],
    [square(), square(1, 0), true],
    [square(), square(2, 0), false],
    [square(), square(2, 2), false],
    [square(), square(3, 0), false],
  ])(
    'detects interior overlap, allowing shared edges/vertices',
    (a, b, expected) => {
      expect(deliveryPolygonsOverlap(a, b)).toBe(expected);
      expect(deliveryPolygonsOverlap(b, a)).toBe(expected);
      expect(
        deliveryPolygonsOverlap(a, {
          ...b,
          coordinates: [b.coordinates[0].slice().reverse()],
        }),
      ).toBe(expected);
    },
  );

  it('detects crossing strips whose vertices are all outside the other polygon', () => {
    const horizontal: DeliveryPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 1],
          [4, 1],
          [4, 2],
          [0, 2],
          [0, 1],
        ],
      ],
    };
    const vertical: DeliveryPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [1, 0],
          [2, 0],
          [2, 4],
          [1, 4],
          [1, 0],
        ],
      ],
    };
    expect(deliveryPolygonsOverlap(horizontal, vertical)).toBe(true);
  });

  it('does not confuse intersecting bounding boxes with a concave interior', () => {
    const concave: DeliveryPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [3, 0],
          [3, 1],
          [1, 1],
          [1, 3],
          [0, 3],
          [0, 0],
        ],
      ],
    };
    expect(deliveryPolygonError(concave)).toBeNull();
    expect(deliveryPolygonsOverlap(concave, square(1.5, 1.5, 1))).toBe(false);
    expect(deliveryPolygonsOverlap(concave, square(0.5, 0.5, 1))).toBe(true);
    expect(deliveryPolygonsOverlap(square(0.5, 0.5, 1), concave)).toBe(true);
  });

  it('matches analytical rectangle coverage over a grid including shared borders and containments', () => {
    for (const x of [-1, 0, 0.5, 1, 2, 3]) {
      for (const y of [-1, 0, 0.5, 1, 2, 3]) {
        for (const size of [0.5, 1, 2, 3]) {
          const expected =
            Math.max(0, x) < Math.min(2, x + size) &&
            Math.max(0, y) < Math.min(2, y + size);
          expect(deliveryPolygonsOverlap(square(), square(x, y, size))).toBe(
            expected,
          );
          expect(deliveryPolygonsOverlap(square(x, y, size), square())).toBe(
            expected,
          );
        }
      }
    }
  });
});
