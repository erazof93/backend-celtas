import { UsersService } from './users.service';
import { UserRole } from './entities/user.entity';

describe('Users partial update regressions', () => {
  it.each(['profile', 'token', 'role', 'clearToken'] as const)(
    '%s preserves fields changed after its initial read',
    async (operation) => {
      const current = {
        id: 'user',
        fullName: 'Before',
        fcmToken: 'before',
        role: UserRole.CLIENTE,
      };
      let firstRead = true;
      const repo = {
        findOne: jest.fn(() => {
          const snapshot = { ...current };
          if (firstRead) {
            firstRead = false;
            if (operation === 'profile') current.fcmToken = 'concurrent-token';
            else current.fullName = 'Concurrent profile';
          }
          return Promise.resolve(snapshot);
        }),
        save: jest.fn((value: typeof current) => {
          Object.assign(current, value);
          return Promise.resolve({ ...current });
        }),
        update: jest.fn((_id: string, patch: Partial<typeof current>) => {
          Object.assign(current, patch);
          return Promise.resolve({ affected: 1 });
        }),
      };
      const service = new UsersService(repo as never);
      const result =
        operation === 'profile'
          ? await service.updateProfile('user', { fullName: 'New name' })
          : operation === 'token'
            ? await service.updateFcmToken('user', 'new-token')
            : operation === 'clearToken'
              ? await service.clearFcmToken('user')
              : await service.updateRole('admin', 'user', UserRole.ADMIN);
      if (operation === 'profile')
        expect(result.fcmToken).toBe('concurrent-token');
      else expect(result.fullName).toBe('Concurrent profile');
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(
        'user',
        operation === 'profile'
          ? { fullName: 'New name' }
          : operation === 'role'
            ? { role: UserRole.ADMIN }
            : { fcmToken: operation === 'token' ? 'new-token' : null },
      );
    },
  );
});
