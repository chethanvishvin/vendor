import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Image,
  BackHandler,
  AppState,
  Platform,
  Alert,
} from 'react-native';
import {
  VersionManifest,
  InstalledAppInfo,
  DownloadProgress,
  canRequestPackageInstalls,
  openInstallPermissionSettings,
  downloadAndVerifyUpdateApk,
  installUpdateApk,
  isApkAlreadyDownloaded,
} from '../services/updateService';

interface MandatoryUpdateScreenProps {
  manifest: VersionManifest;
  installedInfo?: InstalledAppInfo;
  onUpdateCompleted?: () => void;
  onRetryCheck?: () => void;
}

type UpdateState =
  | 'IDLE'
  | 'DOWNLOADING'
  | 'VERIFYING'
  | 'READY_TO_INSTALL'
  | 'PERMISSION_REQUIRED'
  | 'ERROR';

export const MandatoryUpdateScreen: React.FC<MandatoryUpdateScreenProps> = ({
  manifest,
  installedInfo,
  onUpdateCompleted,
  onRetryCheck,
}) => {
  const [updateState, setUpdateState] = useState<UpdateState>('IDLE');
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    receivedBytes: 0,
    totalBytes: 0,
    percent: 0,
  });
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Strictly block Android back navigation to keep mandatory gate active
  useEffect(() => {
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => backSub.remove();
  }, []);

  // Format bytes to MB string
  const formatBytes = (bytes: number): string => {
    if (bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  // Check Android install permission
  const checkPermissions = useCallback(async (): Promise<boolean> => {
    try {
      return await canRequestPackageInstalls();
    } catch {
      return false;
    }
  }, []);

  // Download & install execution helper
  const executeDownloadAndInstall = useCallback(async () => {
    setErrorMessage(null);
    setUpdateState('DOWNLOADING');
    setStatusMessage('Connecting to secure download server...');
    setDownloadProgress({ receivedBytes: 0, totalBytes: 0, percent: 0 });

    try {
      setStatusMessage('Downloading update package...');
      await downloadAndVerifyUpdateApk(manifest, progress => {
        setDownloadProgress(progress);
        setStatusMessage(`Downloading update: ${progress.percent}%`);
      });

      setUpdateState('READY_TO_INSTALL');
      setStatusMessage('Launching Android installer...');
      await installUpdateApk();
    } catch (err: any) {
      setUpdateState('ERROR');
      const msg = err?.message || 'Download or verification failed. Please try again.';
      setErrorMessage(msg);
      setStatusMessage('');
    }
  }, [manifest]);

  // Proceed with installation or download once permission is confirmed
  const proceedAfterPermissionGranted = useCallback(async () => {
    setErrorMessage(null);
    try {
      const alreadyDownloaded = await isApkAlreadyDownloaded(manifest.sha256).catch(() => false);
      if (alreadyDownloaded) {
        setUpdateState('READY_TO_INSTALL');
        setStatusMessage('Launching Android installer...');
        await installUpdateApk();
      } else {
        await executeDownloadAndInstall();
      }
    } catch (err: any) {
      setUpdateState('ERROR');
      setErrorMessage(err?.message || 'Failed to proceed with installation.');
    }
  }, [manifest.sha256, executeDownloadAndInstall]);

  // Check if valid APK is already cached on disk on mount
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const isDownloaded = await isApkAlreadyDownloaded(manifest.sha256);
        if (isMounted && isDownloaded) {
          const allowed = await checkPermissions();
          if (allowed) {
            setUpdateState('READY_TO_INSTALL');
            setStatusMessage('Update package is verified and ready to install.');
          } else {
            setUpdateState('PERMISSION_REQUIRED');
            setStatusMessage('System permission required before installing update.');
          }
        }
      } catch (_) {}
    })();
    return () => {
      isMounted = false;
    };
  }, [manifest.sha256, checkPermissions]);

  // Handle returning from background (e.g. system settings or package installer)
  useEffect(() => {
    const appStateSub = AppState.addEventListener('change', async nextState => {
      if (nextState === 'active') {
        // 1. Re-check if installed version was updated
        if (onUpdateCompleted) {
          onUpdateCompleted();
        }

        // 2. If blocked by permission, check if user granted it in Settings
        if (updateState === 'PERMISSION_REQUIRED') {
          const allowed = await checkPermissions();
          if (allowed) {
            setErrorMessage(null);
            setStatusMessage('Permission granted. Proceeding with update...');
            await proceedAfterPermissionGranted();
          }
        }
      }
    });

    return () => appStateSub.remove();
  }, [checkPermissions, onUpdateCompleted, updateState, proceedAfterPermissionGranted]);

  const handleOpenSettings = async () => {
    try {
      const allowed = await checkPermissions();
      if (allowed) {
        await proceedAfterPermissionGranted();
        return;
      }
      await openInstallPermissionSettings();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Could not open settings.');
    }
  };

  // Initiate Download & Installation flow: Permission checked FIRST!
  const handleStartUpdate = async () => {
    setErrorMessage(null);

    // 1. Check install permission on Android 8+ FIRST before downloading
    const allowed = await checkPermissions();
    if (!allowed) {
      setUpdateState('PERMISSION_REQUIRED');
      setStatusMessage('Install permission required before downloading.');
      Alert.alert(
        'Install Permission Required',
        'Android requires you to grant permission before installing updates from the Vendor app. Tap "Open Settings" to enable "Allow from this source".',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => handleOpenSettings(),
          },
        ]
      );
      return;
    }

    // 2. Permission already granted -> proceed to download and install
    await proceedAfterPermissionGranted();
  };

  const handleManualInstallTrigger = async () => {
    try {
      const allowed = await checkPermissions();
      if (!allowed) {
        setUpdateState('PERMISSION_REQUIRED');
        return;
      }
      setStatusMessage('Launching Android installer...');
      await installUpdateApk();
    } catch (err: any) {
      setUpdateState('ERROR');
      setErrorMessage(err?.message || 'Installation trigger failed.');
    }
  };

  return (
    <View style={styles.rootContainer}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {/* Branding & Header */}
        <View style={styles.brandContainer}>
          <View style={styles.logoBadge}>
            <Image
              source={require('../assets/logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.mandatoryBadge}>
            <Text style={styles.mandatoryBadgeText}>CRITICAL UPDATE REQUIRED</Text>
          </View>
          <Text style={styles.title}>Update Required</Text>
          <Text style={styles.subtitle}>
            A required version of the Vendor application must be installed to continue.
          </Text>
        </View>

        {/* Version Comparison Card */}
        <View style={styles.card}>
          <Text style={styles.cardSectionLabel}>APPLICATION VERSION</Text>
          <View style={styles.versionRow}>
            <View style={styles.versionCol}>
              <Text style={styles.versionLabel}>Currently Installed</Text>
              <Text style={styles.currentVersionText}>
                v{installedInfo?.versionName || '1.0'}
                <Text style={styles.buildText}> (Build {installedInfo?.versionCode || 1})</Text>
              </Text>
            </View>

            <View style={styles.versionArrowContainer}>
              <Text style={styles.versionArrow}>➔</Text>
            </View>

            <View style={styles.versionCol}>
              <Text style={styles.versionLabel}>Required Version</Text>
              <Text style={styles.requiredVersionText}>
                v{manifest.versionName}
                <Text style={styles.buildText}> (Build {manifest.versionCode})</Text>
              </Text>
            </View>
          </View>
        </View>

        {/* Release Notes Card */}
        {manifest.releaseNotes ? (
          <View style={styles.card}>
            <Text style={styles.cardSectionLabel}>WHAT'S NEW IN THIS UPDATE</Text>
            <Text style={styles.releaseNotesText}>{manifest.releaseNotes}</Text>
          </View>
        ) : null}

        {/* Security / Verification Badge */}
        <View style={styles.securityRow}>
          <Text style={styles.securityIcon}>🔒</Text>
          <Text style={styles.securityText}>
            Official signed release verified with SHA-256 checksum.
          </Text>
        </View>

        {/* Permission Guidance Banner */}
        {updateState === 'PERMISSION_REQUIRED' && (
          <View style={styles.permissionCard}>
            <Text style={styles.permissionTitle}>⚙️ Install Permission Required</Text>
            <Text style={styles.permissionDesc}>
              Android requires you to grant permission before installing updates from the Vendor app.
              Tap below to open system settings and enable &quot;Allow from this source&quot;.
            </Text>
            <TouchableOpacity
              style={styles.settingsButton}
              onPress={handleOpenSettings}
              activeOpacity={0.8}>
              <Text style={styles.settingsButtonText}>Open System Settings</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Error Banner */}
        {errorMessage ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>⚠️ Update Failed</Text>
            <Text style={styles.errorDesc}>{errorMessage}</Text>
          </View>
        ) : null}

        {/* Download Progress Card */}
        {(updateState === 'DOWNLOADING' || updateState === 'VERIFYING') && (
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressStatusText}>{statusMessage}</Text>
              <Text style={styles.progressPercentText}>{downloadProgress.percent}%</Text>
            </View>

            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${Math.min(100, Math.max(0, downloadProgress.percent))}%` },
                ]}
              />
            </View>

            {downloadProgress.totalBytes > 0 && (
              <Text style={styles.progressBytesText}>
                {formatBytes(downloadProgress.receivedBytes)} of{' '}
                {formatBytes(downloadProgress.totalBytes)}
              </Text>
            )}

            <View style={styles.activityIndicatorRow}>
              <ActivityIndicator size="small" color="#0284C7" />
              <Text style={styles.activityText}>Do not close the application</Text>
            </View>
          </View>
        )}

        {/* Primary Action Buttons */}
        <View style={styles.actionsContainer}>
          {updateState === 'READY_TO_INSTALL' ? (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleManualInstallTrigger}
              activeOpacity={0.8}>
              <Text style={styles.primaryButtonText}>🚀 Install Update Now</Text>
            </TouchableOpacity>
          ) : updateState === 'DOWNLOADING' || updateState === 'VERIFYING' ? (
            <View style={[styles.primaryButton, styles.primaryButtonDisabled]}>
              <ActivityIndicator color="#FFFFFF" size="small" />
              <Text style={styles.primaryButtonText}>Downloading Update...</Text>
            </View>
          ) : updateState === 'PERMISSION_REQUIRED' ? (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleOpenSettings}
              activeOpacity={0.8}>
              <Text style={styles.primaryButtonText}>⚙️ Open System Settings</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleStartUpdate}
              activeOpacity={0.8}>
              <Text style={styles.primaryButtonText}>
                {updateState === 'ERROR' ? '🔄 Retry Download & Install' : '⬇️ Download and Install Update'}
              </Text>
            </TouchableOpacity>
          )}

          {onRetryCheck && updateState === 'IDLE' && (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={onRetryCheck}
              activeOpacity={0.8}>
              <Text style={styles.secondaryButtonText}>Recheck Available Updates</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 36,
    paddingBottom: 48,
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  logoImage: {
    width: 48,
    height: 48,
  },
  mandatoryBadge: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    marginBottom: 12,
  },
  mandatoryBadgeText: {
    color: '#DC2626',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  versionCol: {
    flex: 1,
  },
  versionLabel: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
  },
  currentVersionText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#475569',
  },
  requiredVersionText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0284C7',
  },
  buildText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
  versionArrowContainer: {
    paddingHorizontal: 12,
  },
  versionArrow: {
    fontSize: 18,
    color: '#94A3B8',
  },
  releaseNotesText: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 22,
  },
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 6,
  },
  securityIcon: {
    fontSize: 13,
  },
  securityText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  permissionCard: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FCD34D',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  permissionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#B45309',
    marginBottom: 6,
  },
  permissionDesc: {
    fontSize: 13,
    color: '#78350F',
    lineHeight: 18,
    marginBottom: 14,
  },
  settingsButton: {
    backgroundColor: '#D97706',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  settingsButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  errorCard: {
    backgroundColor: '#FEF2F2',
    borderColor: '#F87171',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#B91C1C',
    marginBottom: 4,
  },
  errorDesc: {
    fontSize: 13,
    color: '#7F1D1D',
    lineHeight: 18,
  },
  progressCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressStatusText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0369A1',
    flex: 1,
  },
  progressPercentText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0284C7',
    marginLeft: 8,
  },
  progressBarTrack: {
    height: 10,
    backgroundColor: '#E0F2FE',
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#0284C7',
    borderRadius: 5,
  },
  progressBytesText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'right',
    marginBottom: 12,
  },
  activityIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  activityText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  actionsContainer: {
    marginTop: 8,
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#0284C7',
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonDisabled: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  secondaryButtonText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '600',
  },
});
