import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../users/entities/user.entity';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy current identity', () => {
  const findById = jest.fn();
  let strategy: JwtStrategy;
  beforeEach(() => {
    findById.mockReset();
    strategy = new JwtStrategy(
      { get: () => 'local-test-secret' } as unknown as ConfigService,
      { findById } as unknown as UsersService,
    );
  });
  it.each([
    [UserRole.ADMIN, UserRole.CLIENTE],
    [UserRole.ADMIN, UserRole.ADMIN],
    [UserRole.CLIENTE, UserRole.ADMIN],
  ])(
    'uses current %s -> %s role and email from one lookup',
    async (tokenRole, currentRole) => {
      findById.mockResolvedValue({
        id: 'user',
        email: 'current@test.local',
        role: currentRole,
      });
      await expect(
        strategy.validate({
          sub: 'user',
          email: 'old@test.local',
          role: tokenRole,
        }),
      ).resolves.toEqual({
        userId: 'user',
        email: 'current@test.local',
        role: currentRole,
      });
      expect(findById).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects a deleted user', async () => {
    findById.mockResolvedValue(null);
    await expect(
      strategy.validate({
        sub: 'missing',
        email: 'old@test.local',
        role: UserRole.ADMIN,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
