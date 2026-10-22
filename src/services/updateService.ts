import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

export const MANIFEST_URL = 'https://chethanvishvin.github.io/vendor/version.json';
export const EXPECTED_REPO_PATH_PREFIX = '/chethanvishvin/vendor/';

export interface VersionManifest {
  versionCode: number;
  versionName: string;
  mandatory: boolean;
  releaseNotes: string;
  apkUrl: string;
  sha256: string;
}

export interface InstalledAppInfo {
  versionCode: number;
  versionName: string;
  packageName: string;
}

export type UpdateCheckStatus = 'UP_TO_DATE' | 'UPDATE_REQUIRED' | 'CHECK_FAILED';

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  manifest?: VersionManifest;
  installedInfo?: InstalledAppInfo;
  error?: string;
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number;
  percent: number;
}

const { VendorUpdateModule } = NativeModules;

const updateEventEmitter =
  Platform.OS === 'android' && VendorUpdateModule
    ? new NativeEventEmitter(VendorUpdateModule)
    : null;

/**
 * Validates manifest structure and required security attributes.
 * Throws an Error if manifest is invalid or malformed.
 */
export function validateManifest(data: any): VersionManifest {
  if (!data || typeof data !== 'object') {
    throw new Error('Manifest response is not a valid JSON object');
  }

  const { versionCode, versionName, mandatory, releaseNotes, apkUrl, sha256 } = data;

  if (typeof versionCode !== 'number' || !Number.isInteger(versionCode) || versionCode < 1) {
    throw new Error(`Invalid manifest versionCode: expected positive integer, got ${versionCode}`);
  }

  if (typeof versionName !== 'string' || versionName.trim().length === 0) {
    throw new Error('Invalid manifest versionName: non-empty string required');
  }

  if (typeof mandatory !== 'boolean') {
    throw new Error('Invalid manifest mandatory flag: boolean required');
  }

  if (typeof releaseNotes !== 'string') {
    throw new Error('Invalid manifest releaseNotes: string required');
  }

  if (typeof apkUrl !== 'string' || !apkUrl.startsWith('https://')) {
    throw new Error('Invalid manifest apkUrl: HTTPS URL required');
  }

  // Validate trusted download host and path
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(apkUrl);
  } catch {
    throw new Error('Malformed manifest apkUrl');
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname !== 'github.com' && !hostname.endsWith('.github.com')) {
    throw new Error(`Disallowed APK download host: ${hostname}`);
  }

  if (!parsedUrl.pathname.startsWith(EXPECTED_REPO_PATH_PREFIX)) {
    throw new Error(`Disallowed repository download path: ${parsedUrl.pathname}`);
  }

  // SHA-256 validation (must be 64-char hex)
  if (typeof sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(sha256.trim())) {
    throw new Error(
      'Manifest is missing a valid 64-character hexadecimal SHA-256 checksum'
    );
  }

  return {
    versionCode,
    versionName: versionName.trim(),
    mandatory,
    releaseNotes: releaseNotes.trim(),
    apkUrl: apkUrl.trim(),
    sha256: sha256.trim().toLowerCase(),
  };
}

/**
 * Pure evaluation function for deciding whether an update is required.
 */
export function evaluateUpdateRequirement(
  installedVersionCode: number,
  manifest: VersionManifest
): UpdateCheckStatus {
  // If installed version is lower and update is marked mandatory -> UPDATE_REQUIRED
  if (installedVersionCode < manifest.versionCode && manifest.mandatory) {
    return 'UPDATE_REQUIRED';
  }
  // If installed version meets or exceeds required version -> UP_TO_DATE (no downgrade forced)
  return 'UP_TO_DATE';
}

/**
 * Native bridge wrapper for package info.
 */
export async function getInstalledAppInfo(): Promise<InstalledAppInfo> {
  if (NativeModules.VendorUpdateModule?.getAppInfo) {
    return await NativeModules.VendorUpdateModule.getAppInfo();
  }
  return {
    versionCode: 1,
    versionName: '1.0',
    packageName: 'com.vp',
  };
}

/**
 * Check whether app has permission to request package installations.
 */
export async function canRequestPackageInstalls(): Promise<boolean> {
  if (NativeModules.VendorUpdateModule?.canRequestPackageInstalls) {
    return await NativeModules.VendorUpdateModule.canRequestPackageInstalls();
  }
  return true;
}

/**
 * Open Android system settings to grant unknown app install permission.
 */
export async function openInstallPermissionSettings(): Promise<boolean> {
  if (NativeModules.VendorUpdateModule?.openInstallPermissionSettings) {
    return await NativeModules.VendorUpdateModule.openInstallPermissionSettings();
  }
  return true;
}

/**
 * Fetches and validates the remote version manifest.
 */
export async function fetchRemoteManifest(
  url = MANIFEST_URL,
  timeoutMs = 10000
): Promise<VersionManifest> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    return validateManifest(json);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Performs complete update check:
 * 1. Reads installed app version from Android Package Manager.
 * 2. Fetches and validates remote manifest over HTTPS.
 * 3. Compares versions and returns status.
 * Follows fail-closed policy: returns CHECK_FAILED if manifest is unavailable.
 */
export async function checkAppUpdate(
  manifestUrl = MANIFEST_URL,
  timeoutMs = 10000
): Promise<UpdateCheckResult> {
  try {
    const installedInfo = await getInstalledAppInfo();
    const manifest = await fetchRemoteManifest(manifestUrl, timeoutMs);
    const status = evaluateUpdateRequirement(installedInfo.versionCode, manifest);

    return {
      status,
      manifest,
      installedInfo,
    };
  } catch (err: any) {
    const message =
      err?.name === 'AbortError'
        ? 'Update check timed out after 10 seconds. Check network connection.'
        : err?.message || 'Failed to verify required application version.';

    return {
      status: 'CHECK_FAILED',
      error: message,
    };
  }
}

/**
 * Downloads the APK, streams progress, verifies SHA-256 against manifest checksum.
 */
export async function downloadAndVerifyUpdateApk(
  manifest: VersionManifest,
  onProgress?: (progress: DownloadProgress) => void
): Promise<string> {
  const module = NativeModules.VendorUpdateModule;
  if (!module?.downloadAndVerifyApk) {
    throw new Error('APK download is only supported on Android');
  }

  let subscription: any = null;
  if (onProgress && updateEventEmitter) {
    subscription = updateEventEmitter.addListener(
      'onDownloadProgress',
      (data: any) => {
        onProgress(data as DownloadProgress);
      }
    );
  }

  try {
    const filePath = await module.downloadAndVerifyApk(
      manifest.apkUrl,
      manifest.sha256
    );
    return filePath;
  } finally {
    subscription?.remove();
  }
}

/**
 * Triggers Android package installer via FileProvider.
 */
export async function installUpdateApk(): Promise<boolean> {
  const module = NativeModules.VendorUpdateModule;
  if (!module?.installApk) {
    throw new Error('APK install is only supported on Android');
  }
  return await module.installApk();
}

/**
 * Cleans up update APK file from cache.
 */
export async function deleteUpdateApk(): Promise<boolean> {
  const module = NativeModules.VendorUpdateModule;
  if (!module?.deleteUpdateApk) {
    return true;
  }
  return await module.deleteUpdateApk();
}
