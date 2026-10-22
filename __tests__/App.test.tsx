import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import * as updateService from '../src/services/updateService';

jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js')
);

jest.mock('react-native-safe-area-context', () => {
  const mock = require('react-native-safe-area-context/jest/mock');
  return mock.default || mock;
});

jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));

jest.mock('react-native-image-marker', () => ({
  markText: jest.fn(),
  markImage: jest.fn(),
}));

jest.mock('react-native-geolocation-service', () => ({
  getCurrentPosition: jest.fn(),
  requestAuthorization: jest.fn(),
}));

jest.mock('../src/db/sqliteService', () => ({
  syncAllOfflineSubmissions: jest.fn().mockResolvedValue({ synced: 0, failed: 0 }),
}));

jest.mock('../src/services/updateService', () => {
  const actual = jest.requireActual('../src/services/updateService');
  return {
    ...actual,
    checkAppUpdate: jest.fn().mockResolvedValue({
      status: 'UP_TO_DATE',
      manifest: {
        versionCode: 1,
        versionName: '1.0',
        mandatory: true,
        releaseNotes: 'None',
        apkUrl: 'https://github.com/chethanvishvin/vendor/releases/download/v1.0/app.apk',
        sha256: '80341cd234fa783badfa30f5cf3703c3cf2e835fc22049ecca0399b893973399',
      },
      installedInfo: {
        versionCode: 1,
        versionName: '1.0',
        packageName: 'com.vp',
      },
    }),
  };
});

function extractText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join(' ');
  const children = node.children || node.props?.children;
  if (children) return extractText(children);
  return '';
}

describe('App Root Component', () => {
  let root: any;

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
      root = null;
    }
    jest.clearAllMocks();
  });

  it('renders correctly when up to date', async () => {
    await act(async () => {
      root = ReactTestRenderer.create(<App />);
      await new Promise<void>(resolve => setTimeout(() => resolve(), 50));
    });
    expect(root).toBeDefined();
  });

  it('renders MandatoryUpdateScreen when update is required', async () => {
    (updateService.checkAppUpdate as jest.Mock).mockResolvedValueOnce({
      status: 'UPDATE_REQUIRED',
      manifest: {
        versionCode: 2,
        versionName: '1.1',
        mandatory: true,
        releaseNotes: 'Critical fix',
        apkUrl:
          'https://github.com/chethanvishvin/vendor/releases/latest/download/vendor-release.apk',
        sha256: '80341cd234fa783badfa30f5cf3703c3cf2e835fc22049ecca0399b893973399',
      },
      installedInfo: {
        versionCode: 1,
        versionName: '1.0',
        packageName: 'com.vp',
      },
    });

    await act(async () => {
      root = ReactTestRenderer.create(<App />);
      await new Promise<void>(resolve => setTimeout(() => resolve(), 50));
    });

    const allText = extractText(root.toJSON());
    expect(allText).toContain('Update Required');
    expect(allText).toContain('CRITICAL UPDATE REQUIRED');
  });

  it('renders Update Check Required screen when check fails', async () => {
    (updateService.checkAppUpdate as jest.Mock).mockResolvedValueOnce({
      status: 'CHECK_FAILED',
      error: 'Network connection failed',
    });

    await act(async () => {
      root = ReactTestRenderer.create(<App />);
      await new Promise<void>(resolve => setTimeout(() => resolve(), 50));
    });

    const allText = extractText(root.toJSON());
    expect(allText).toContain('Update Check Required');
    expect(allText).toContain('Retry Connection');
  });
});
