import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const service = vi.hoisted(() => ({
  isAndroid: vi.fn(() => true),
  isSideloadUpdatesSupported: vi.fn(async () => false),
  checkForUpdates: vi.fn(async () => ({
    available: true, currentVersion: '0.18.1', latestVersion: '0.19.0', notes: '', releaseUrl: '', assets: [],
  })),
}));
vi.mock('../src/services/UpdateService', () => ({ default: service }));

import { useUpdaterStore } from '../src/stores/updater.js';

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.clearAllMocks());

describe('store-managed updates', () => {
  it('never checks GitHub or shows the splash in an Android store build', async () => {
    const updater = useUpdaterStore();
    await updater.checkForUpdates({ manual: false });
    await updater.checkForUpdates({ manual: true });
    expect(service.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.showSplash).toBe(false);
    expect(updater.status).toBe('idle');
    expect(updater.storeManaged).toBe(true);
  });

  it('keeps checking in a sideloaded Android build', async () => {
    service.isSideloadUpdatesSupported.mockResolvedValue(true);
    const updater = useUpdaterStore();
    await updater.checkForUpdates({ manual: false });
    expect(service.checkForUpdates).toHaveBeenCalledOnce();
    expect(updater.status).toBe('available');
  });

  it('keeps checking on desktop', async () => {
    service.isAndroid.mockReturnValue(false);
    service.isSideloadUpdatesSupported.mockResolvedValue(false);
    const updater = useUpdaterStore();
    await updater.checkForUpdates({ manual: false });
    expect(service.checkForUpdates).toHaveBeenCalledOnce();
  });
});
