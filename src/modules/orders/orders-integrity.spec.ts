import { BadRequestException, Logger } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { Order, OrderStatus } from './entities/order.entity';
import { User } from '../users/entities/user.entity';
import { DeliveryMode } from '../delivery/delivery-mode';

describe('Orders integrity regressions', () => {
  const rewardId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const addressSnapshot = JSON.stringify({
    alias: 'QA',
    fullAddress: 'QA',
    district: 'QA',
  });
  let service: OrdersService;
  let manager: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    increment: jest.Mock;
  };
  let transaction: jest.Mock;
  let validateReward: jest.Mock;
  let markReward: jest.Mock;
  let recipients: jest.Mock;
  const product = (id: string) => ({
    id,
    name: id,
    price: 10,
    available: true,
    redeemableWithStars: true,
    sauces: [],
    beverages: [],
    extraPortions: [],
    friesTypes: [],
  });
  beforeEach(() => {
    manager = {
      create: jest.fn((_type: unknown, value: unknown) => value),
      save: jest.fn((_type: unknown, value: unknown) => Promise.resolve(value)),
      findOne: jest.fn(),
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    transaction = jest.fn((cb: (m: typeof manager) => Promise<unknown>) =>
      cb(manager),
    );
    validateReward = jest
      .fn()
      .mockImplementation((_m: unknown, p: { rewardRedemptionId: string }) =>
        Promise.resolve({ id: p.rewardRedemptionId }),
      );
    markReward = jest.fn();
    recipients = jest.fn().mockResolvedValue([]);
    service = new OrdersService(
      {} as never,
      { create: (value: unknown) => value } as never,
      { find: () => Promise.resolve([product('a'), product('b')]) } as never,
      {} as never,
      { find: recipients } as never,
      { transaction } as never,
      { checkAndGenerateForUser: () => Promise.resolve(null) } as never,
      {
        validateForOrder: validateReward,
        markUsed: markReward,
        recalculateForUser: () => Promise.resolve(undefined),
      } as never,
      { sendPushNotification: () => Promise.resolve(true) } as never,
      {
        isOpenNow: () => Promise.resolve({ open: true }),
        getDeliveryMode: () => Promise.resolve(DeliveryMode.DISTANCE),
        getWhatsappNumber: () => Promise.resolve('51999999999'),
      } as never,
      {} as never,
      {} as never,
      {
        record: jest.fn().mockResolvedValue(undefined),
        wake: jest.fn(),
      } as never,
    );
  });
  it.each([
    ['literal duplicate', rewardId, rewardId, 'a'],
    ['different casing', rewardId, rewardId.toUpperCase(), 'a'],
    ['different products', rewardId, rewardId.toUpperCase(), 'b'],
  ])(
    'rejects %s before persistence/redemption',
    async (_label, first, second, secondProduct) => {
      await expect(
        service.create('user', {
          addressSnapshot,
          items: [
            { menuItemId: 'a', quantity: 1, rewardRedemptionId: first },
            {
              menuItemId: secondProduct,
              quantity: 1,
              rewardRedemptionId: second,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(markReward).not.toHaveBeenCalled();
    },
  );
  it('accepts distinct rewards and validates canonical IDs', async () => {
    await service.create('user', {
      addressSnapshot,
      items: [
        {
          menuItemId: 'a',
          quantity: 1,
          rewardRedemptionId: rewardId.toUpperCase(),
        },
        {
          menuItemId: 'b',
          quantity: 1,
          rewardRedemptionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      ],
    });
    expect(validateReward).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ rewardRedemptionId: rewardId }),
    );
    expect(markReward).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])(
    'locks canonical rewards in ascending order (reversed=%s) without moving items',
    async (reversed) => {
      const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const items = [
        {
          menuItemId: 'a',
          quantity: 1,
          rewardRedemptionId: rewardId.toUpperCase(),
        },
        { menuItemId: 'b', quantity: 1, rewardRedemptionId: secondId },
      ];
      if (reversed) items.reverse();
      const result = await service.create('user', { addressSnapshot, items });
      expect(
        validateReward.mock.calls.map(
          (
            call: [unknown, { rewardRedemptionId: string; menuItemId: string }],
          ) => call[1],
        ),
      ).toEqual([
        expect.objectContaining({
          rewardRedemptionId: rewardId,
          menuItemId: 'a',
        }),
        expect.objectContaining({
          rewardRedemptionId: secondId,
          menuItemId: 'b',
        }),
      ]);
      expect(result.items.map((item) => item.menuItemId)).toEqual(
        items.map((item) => item.menuItemId),
      );
      expect(markReward).toHaveBeenCalledTimes(2);
    },
  );
  it('defends the transaction if duplicate claims bypass item validation', async () => {
    const builder = service as unknown as {
      buildItems: () => Promise<unknown>;
    };
    jest.spyOn(builder, 'buildItems').mockResolvedValue({
      items: [],
      rewardClaims: [
        { rewardRedemptionId: rewardId, menuItemId: 'a' },
        { rewardRedemptionId: rewardId.toUpperCase(), menuItemId: 'b' },
      ],
    });
    await expect(
      service.create('user', {
        addressSnapshot,
        items: [{ menuItemId: 'a', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
    expect(markReward).not.toHaveBeenCalled();
  });
  it('returns the committed order when recipient lookup fails', async () => {
    recipients.mockRejectedValue(new Error('recipient lookup failed'));
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      const result = await service.create('user', {
        addressSnapshot,
        items: [{ menuItemId: 'a', quantity: 1 }],
      });
      expect(manager.save).toHaveBeenCalledWith(
        Order,
        expect.objectContaining({ id: result.id }),
      );
      expect(logger).toHaveBeenCalled();
    } finally {
      logger.mockRestore();
    }
  });
  it('increments only totalSpent inside the transition transaction', async () => {
    manager.findOne
      .mockResolvedValueOnce({
        id: 'order',
        userId: 'user',
        status: OrderStatus.EN_CAMINO,
        total: 59.7,
      })
      .mockResolvedValueOnce({ id: 'user', totalSpent: 0 });
    await service.updateStatus('order', { status: OrderStatus.ENTREGADO });
    expect(manager.increment).toHaveBeenCalledWith(
      User,
      { id: 'user' },
      'totalSpent',
      59.7,
    );
    expect(manager.save).not.toHaveBeenCalledWith(User, expect.anything());
  });
  it('does not increment an already delivered order', async () => {
    manager.findOne.mockResolvedValue({
      id: 'order',
      userId: 'user',
      status: OrderStatus.ENTREGADO,
      total: 59.7,
    });
    await expect(
      service.updateStatus('order', { status: OrderStatus.ENTREGADO }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.increment).not.toHaveBeenCalled();
  });
});
