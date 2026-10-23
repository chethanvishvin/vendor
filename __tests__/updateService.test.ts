import {
  validateManifest,
  evaluateUpdateRequirement,
  checkAppUpdate,
  VersionManifest,
  InstalledAppInfo,
} from '../src/services/updateService';
import { NativeModules } from 'react-native';

describe('Mandatory Update Service', () => {
  const validManifestPayload = {
    versionCode: 2,
    versionName: '1.1',
    mandatory: true,
    releaseNotes: 'Performance improvements and bug fixes.',
    apkUrl:
      'https://github.com/chethanvishvin/vendor/releases/latest/download/vendor-release.apk',
    sha256: '80341cd234fa783badfa30f5cf3703c3cf2e835fc22049ecca0399b893973399',
  };

  describe('Manifest Validation & Security Whitelist', () => {
    it('successfully parses a valid manifest', () => {
      const parsed = validateManifest(validManifestPayload);
      expect(parsed.versionCode).toBe(2);
      expect(parsed.versionName).toBe('1.1');
      expect(parsed.mandatory).toBe(true);
      expect(parsed.releaseNotes).toBe('Performance improvements and bug fixes.');
      expect(parsed.apkUrl).toBe(validManifestPayload.apkUrl);
      expect(parsed.sha256).toBe(
        '80341cd234fa783badfa30f5cf3703c3cf2e835fc22049ecca0399b893973399'
      );
    });

    it('rejects null or non-object payload', () => {
      expect(() => validateManifest(null)).toThrow('not a valid JSON object');
      expect(() => validateManifest('string payload')).toThrow('not a valid JSON object');
      expect(() => validateManifest(123)).toThrow('not a valid JSON object');
    });

    it('rejects invalid versionCode (zero, negative, float, non-number)', () => {
      expect(() =>
        validateManifest({ ...validManifestPayload, versionCode: 0 })
      ).toThrow('Invalid manifest versionCode');

      expect(() =>
        validateManifest({ ...validManifestPayload, versionCode: -1 })
      ).toThrow('Invalid manifest versionCode');

      expect(() =>
        validateManifest({ ...validManifestPayload, versionCode: 1.5 })
      ).toThrow('Invalid manifest versionCode');

      expect(() =>
        validateManifest({ ...validManifestPayload, versionCode: '2' as any })
      ).toThrow('Invalid manifest versionCode');
    });

    it('rejects missing or empty versionName', () => {
      expect(() =>
        validateManifest({ ...validManifestPayload, versionName: '' })
      ).toThrow('Invalid manifest versionName');

      expect(() =>
        validateManifest({ ...validManifestPayload, versionName: '   ' })
      ).toThrow('Invalid manifest versionName');
    });

    it('rejects non-boolean mandatory flag', () => {
      expect(() =>
        validateManifest({ ...validManifestPayload, mandatory: 'true' as any })
      ).toThrow('Invalid manifest mandatory flag');
    });

    it('rejects insecure HTTP download URLs', () => {
      expect(() =>
        validateManifest({
          ...validManifestPayload,
          apkUrl: 'http://github.com/chethanvishvin/vendor/releases/download/v1.1/app.apk',
        })
      ).toThrow('HTTPS URL required');
    });

    it('rejects disallowed download hosts (anti-spoofing)', () => {
      expect(() =>
        validateManifest({
          ...validManifestPayload,
          apkUrl: 'https://evil-server.com/chethanvishvin/vendor/releases/download/app.apk',
        })
      ).toThrow('Disallowed APK download host: evil-server.com');
    });

    it('rejects disallowed repository paths', () => {
      expect(() =>
        validateManifest({
          ...validManifestPayload,
          apkUrl: 'https://github.com/attacker/malicious-repo/releases/download/app.apk',
        })
      ).toThrow('Disallowed repository download path');
    });

    it('rejects missing, short, or invalid SHA-256 checksums', () => {
      expect(() =>
        validateManifest({ ...validManifestPayload, sha256: undefined as any })
      ).toThrow('missing a valid 64-character hexadecimal SHA-256 checksum');

      expect(() =>
        validateManifest({
          ...validManifestPayload,
          sha256: '80341cd234fa783badfa30f5cf3703c3cf2e835f', // Too short (40 chars)
        })
      ).toThrow('missing a valid 64-character hexadecimal SHA-256 checksum');

      expect(() =>
        validateManifest({
          ...validManifestPayload,
          sha256: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', // Non-hex
        })
      ).toThrow('missing a valid 64-character hexadecimal SHA-256 checksum');
    });
  });

  describe('Version Comparison Rules', () => {
    const manifest: VersionManifest = {
      versionCode: 2,
      versionName: '1.1',
      mandatory: true,
      releaseNotes: 'Required update',
      apkUrl: 'https://github.com/chethanvishvin/vendor/releases/download/v1.1/app.apk',
      sha256: '80341cd234fa783badfa30f5cf3703c3cf2e835fc22049ecca0399b893973399',
    };

    it('requires update when installed version is lower and mandatory is true', () => {
      const status = evaluateUpdateRequirement(1, manifest);
      expect(status).toBe('UPDATE_REQUIRED');
    });

    it('allows normal startup when installed version equals published version', () => {
      const status = evaluateUpdateRequirement(2, manifest);
      expect(status).toBe('UP_TO_DATE');
    });

    it('allows normal startup when installed version exceeds published version (no downgrade)', () => {
      const status = evaluateUpdateRequirement(3, manifest);
      expect(status).toBe('UP_TO_DATE');
    });

    it('does not block app when mandatory is false (optional update)', () => {
      const optionalManifest: VersionManifest = {
        ...manifest,
        mandatory: false,
      };
      const status = evaluateUpdateRequirement(1, optionalManifest);
      expect(status).toBe('UP_TO_DATE');
    });
  });

  describe('Update Check Flow (checkAppUpdate)', () => {
    const mockAppInfo: InstalledAppInfo = {
      versionCode: 1,
      versionName: '1.0',
      packageName: 'com.vp',
    };

    beforeEach(() => {
      NativeModules.VendorUpdateModule = {
        getAppInfo: jest.fn().mockResolvedValue(mockAppInfo),
        canRequestPackageInstalls: jest.fn().mockResolvedValue(true),
        openInstallPermissionSettings: jest.fn().mockResolvedValue(true),
        downloadAndVerifyApk: jest.fn().mockResolvedValue('/cache/vendor-update.apk'),
        installApk: jest.fn().mockResolvedValue(true),
        deleteUpdateApk: jest.fn().mockResolvedValue(true),
        isApkAlreadyDownloaded: jest.fn().mockResolvedValue(false),
      };
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns UPDATE_REQUIRED when remote manifest has higher mandatory version', async () => {
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => validManifestPayload,
      } as any);

      const result = await checkAppUpdate('https://example.com/version.json');
      expect(result.status).toBe('UPDATE_REQUIRED');
      expect(result.installedInfo?.versionCode).toBe(1);
      expect(result.manifest?.versionCode).toBe(2);
      expect(result.manifest?.versionName).toBe('1.1');
    });

    it('returns UP_TO_DATE when installed version already meets or exceeds required', async () => {
      (NativeModules.VendorUpdateModule.getAppInfo as jest.Mock).mockResolvedValue({
        versionCode: 2,
        versionName: '1.1',
        packageName: 'com.vp',
      });

      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => validManifestPayload,
      } as any);

      const result = await checkAppUpdate('https://example.com/version.json');
      expect(result.status).toBe('UP_TO_DATE');
      expect(result.installedInfo?.versionCode).toBe(2);
    });

    it('returns CHECK_FAILED when network request fails (fail-closed policy)', async () => {
      (globalThis as any).fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));

      const result = await checkAppUpdate('https://example.com/version.json');
      expect(result.status).toBe('CHECK_FAILED');
      expect(result.error).toContain('Network request failed');
    });

    it('returns CHECK_FAILED when server returns non-200 HTTP status', async () => {
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as any);

      const result = await checkAppUpdate('https://example.com/version.json');
      expect(result.status).toBe('CHECK_FAILED');
      expect(result.error).toContain('HTTP 503');
    });

    it('returns CHECK_FAILED on timeout (AbortError)', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      (globalThis as any).fetch = jest.fn().mockRejectedValue(abortError);

      const result = await checkAppUpdate('https://example.com/version.json');
      expect(result.status).toBe('CHECK_FAILED');
      expect(result.error).toContain('timed out');
    });
  });
});
