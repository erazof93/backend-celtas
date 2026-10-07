import { validate } from 'class-validator';
import { MAX_MONEY } from './money.util';
import { CreateMenuItemDto } from '../../modules/menu/dto/create-menu-item.dto';
import { CreateBeverageDto } from '../../modules/beverages/dto/create-beverage.dto';
import { CreateExtraPortionDto } from '../../modules/extra-portions/dto/create-extra-portion.dto';
import { GenerateCouponDto } from '../../modules/coupons/dto/generate-coupon.dto';

describe('Monetary input capacity', () => {
  it.each([CreateMenuItemDto, CreateBeverageDto, CreateExtraPortionDto])(
    '%p price accepts maximum and rejects overflow/nonfinite',
    async (Dto) => {
      for (const price of [MAX_MONEY, MAX_MONEY + 0.01, Infinity, NaN, -1]) {
        const dto = new Dto();
        dto.price = price;
        const errors = (await validate(dto)).filter(
          (error) => error.property === 'price',
        );
        expect(errors.length === 0).toBe(price === MAX_MONEY);
      }
    },
  );
  it('fixed coupons and minimum purchase obey numeric capacity', async () => {
    for (const amount of [MAX_MONEY, MAX_MONEY + 0.01]) {
      const dto = new GenerateCouponDto();
      dto.discountValue = amount;
      dto.minPurchaseAmount = amount;
      const errors = (await validate(dto)).filter((error) =>
        ['discountValue', 'minPurchaseAmount'].includes(error.property),
      );
      expect(errors.length === 0).toBe(amount === MAX_MONEY);
    }
  });
});
