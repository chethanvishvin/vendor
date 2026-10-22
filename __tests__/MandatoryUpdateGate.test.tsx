import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { MandatoryUpdateScreen } from '../src/screens/MandatoryUpdateScreen';
import * as updateService from '../src/services/updateService';
import { BackHandler } from 'react-native';

jest.mock('../src/services/updateService', () => {
  const actual = jest.requireActual('../src/services/updateService');
  return {
    ...actual,
    canRequestPackageInstalls: jest.fn(),
    openInstallPermissionSettings: jest.fn(),
    downloadAndVerifyUpdateApk: jest.fn(),
    installUpdateApk: jest.fn(),
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

describe('MandatoryUpdateScreen UI & Gate Behavior', () => {
  const mockManifest: updateService.VersionManifest = {
    versionCode: 2,
    versionName: '1.1',
    mandatory: true,
    releaseNotes: 'Fixed critical security issue and added live telemetry.',
    apkUrl:
      'https://github.com/chethanvishvin/vendor/releases/latest/download/vendor-release.apk',
    sha256: '80341cd234fa783badfa30f5cf3703c3cf2e835fc22049ecca0399b893973399',
  };

  const mockInstalledInfo: updateService.InstalledAppInfo = {
    versionCode: 1,
    versionName: '1.0',
    packageName: 'com.vp',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (updateService.canRequestPackageInstalls as jest.Mock).mockResolvedValue(true);
    (updateService.downloadAndVerifyUpdateApk as jest.Mock).mockResolvedValue('/cache/update.apk');
    (updateService.installUpdateApk as jest.Mock).mockResolvedValue(true);
  });

  it('renders mandatory update screen with versions and release notes', () => {
    let testRenderer: any;
    act(() => {
      testRenderer = renderer.create(
        <MandatoryUpdateScreen
          manifest={mockManifest}
          installedInfo={mockInstalledInfo}
        />
      );
    });

    const allText = extractText(testRenderer.toJSON());
    expect(allText).toContain('Update Required');
    expect(allText).toContain('CRITICAL UPDATE REQUIRED');
    expect(allText).toContain('1.0');
    expect(allText).toContain('1.1');
    expect(allText).toContain('Build  1');
    expect(allText).toContain('Build  2');
    expect(allText).toContain('Fixed critical security issue and added live telemetry.');
  });

  it('registers hardware back press listener to prevent bypass', () => {
    const addEventListenerSpy = jest.spyOn(BackHandler, 'addEventListener');
    act(() => {
      renderer.create(
        <MandatoryUpdateScreen
          manifest={mockManifest}
          installedInfo={mockInstalledInfo}
        />
      );
    });

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'hardwareBackPress',
      expect.any(Function)
    );
  });

  it('executes download and install flow when user triggers update', async () => {
    let testRenderer: any;
    act(() => {
      testRenderer = renderer.create(
        <MandatoryUpdateScreen
          manifest={mockManifest}
          installedInfo={mockInstalledInfo}
        />
      );
    });

    await act(async () => {
      const allText = testRenderer.root.findAllByType('Text');
      const downloadText = allText.find((t: any) =>
        typeof t.props.children === 'string' && t.props.children.includes('Download and Install Update')
      );
      expect(downloadText).toBeDefined();

      let parent = downloadText.parent;
      while (parent && !parent.props.onPress) {
        parent = parent.parent;
      }
      if (parent && parent.props.onPress) {
        await parent.props.onPress();
      }
    });

    expect(updateService.downloadAndVerifyUpdateApk).toHaveBeenCalledWith(
      mockManifest,
      expect.any(Function)
    );
    expect(updateService.installUpdateApk).toHaveBeenCalled();
  });

  it('displays permission guidance when canRequestPackageInstalls is false', async () => {
    (updateService.canRequestPackageInstalls as jest.Mock).mockResolvedValue(false);

    let testRenderer: any;
    act(() => {
      testRenderer = renderer.create(
        <MandatoryUpdateScreen
          manifest={mockManifest}
          installedInfo={mockInstalledInfo}
        />
      );
    });

    await act(async () => {
      const allText = testRenderer.root.findAllByType('Text');
      const downloadText = allText.find((t: any) =>
        typeof t.props.children === 'string' && t.props.children.includes('Download and Install Update')
      );
      let parent = downloadText.parent;
      while (parent && !parent.props.onPress) {
        parent = parent.parent;
      }
      if (parent && parent.props.onPress) {
        await parent.props.onPress();
      }
    });

    const allTextAfter = extractText(testRenderer.toJSON());
    expect(allTextAfter).toContain('Install Permission Required');
    expect(allTextAfter).toContain('Open System Settings');
  });

  it('displays clear error message and retry button when download fails', async () => {
    (updateService.downloadAndVerifyUpdateApk as jest.Mock).mockRejectedValue(
      new Error('Checksum mismatch. Expected valid hash, got corrupted data.')
    );

    let testRenderer: any;
    act(() => {
      testRenderer = renderer.create(
        <MandatoryUpdateScreen
          manifest={mockManifest}
          installedInfo={mockInstalledInfo}
        />
      );
    });

    await act(async () => {
      const allText = testRenderer.root.findAllByType('Text');
      const downloadText = allText.find((t: any) =>
        typeof t.props.children === 'string' && t.props.children.includes('Download and Install Update')
      );
      let parent = downloadText.parent;
      while (parent && !parent.props.onPress) {
        parent = parent.parent;
      }
      if (parent && parent.props.onPress) {
        await parent.props.onPress();
      }
    });

    const allTextAfter = extractText(testRenderer.toJSON());
    expect(allTextAfter).toContain('Checksum mismatch');
    expect(allTextAfter).toContain('Retry Download & Install');
  });
});
