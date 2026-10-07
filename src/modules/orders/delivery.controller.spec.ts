import { Test, TestingModule } from '@nestjs/testing';
import { DeliveryController } from './delivery.controller';
import { OrdersService } from './orders.service';
import { DeliveryMode } from '../delivery/delivery-mode';

describe('DeliveryController', () => {
  let controller: DeliveryController;
  let ordersService: { estimateDeliveryByCoords: jest.Mock };

  beforeEach(async () => {
    ordersService = { estimateDeliveryByCoords: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeliveryController],
      providers: [{ provide: OrdersService, useValue: ordersService }],
    }).compile();

    controller = module.get(DeliveryController);
  });

  it('delega en OrdersService.estimateDeliveryByCoords y devuelve su resultado tal cual', async () => {
    const estimate = {
      deliveryFee: 4,
      isFarOrder: false,
      distanceMeters: 300,
      isCovered: true,
      deliveryMode: DeliveryMode.DISTANCE,
      zone: null,
    };
    ordersService.estimateDeliveryByCoords.mockResolvedValue(estimate);

    const result = await controller.estimate({
      latitude: -12.1658,
      longitude: -76.97,
    });

    expect(result).toEqual(estimate);
    expect(ordersService.estimateDeliveryByCoords).toHaveBeenCalledWith({
      latitude: -12.1658,
      longitude: -76.97,
    });
  });
});
