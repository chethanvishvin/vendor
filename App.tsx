import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  AppState,
  Platform,
  ToastAndroid,
  Image,
  TouchableOpacity,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { MandatoryUpdateScreen } from './src/screens/MandatoryUpdateScreen';
import { NetworkStatusBar } from './src/components/NetworkStatusBar';
import { VendorProfile } from './src/types';
import { syncAllOfflineSubmissions } from './src/db/sqliteService';
import {
  checkAppUpdate,
  UpdateCheckResult,
} from './src/services/updateService';

const SESSION_KEY = '@vendor_session';
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export default function App() {
  const [currentVendor, setCurrentVendor] = useState<VendorProfile | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [isJustLoggedIn, setIsJustLoggedIn] = useState(false);

  // Mandatory Update Gate State
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult>({
    status: 'UP_TO_DATE',
  });
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  // Core update check function: Only checks when internet connection is available
  const runUpdateCheck = useCallback(async (showSplash = false) => {
    try {
      const netState = await NetInfo.fetch();
      const isOnline = Boolean(
        netState.isConnected && netState.isInternetReachable !== false
      );

      // When there is no internet, skip update check and allow offline usage immediately
      if (!isOnline) {
        if (showSplash) {
          setIsCheckingUpdate(false);
        }
        return;
      }

      if (showSplash) {
        setIsCheckingUpdate(true);
      }

      const res = await checkAppUpdate();

      // Only enforce gate if a mandatory update is explicitly required
      if (res.status === 'UPDATE_REQUIRED') {
        setUpdateResult(res);
      } else if (res.status === 'UP_TO_DATE') {
        setUpdateResult(res);
      } else {
        // If check failed over network, continue in offline mode without blocking
        console.warn('Update check failed over network, continuing in offline mode:', res.error);
      }
    } catch (err: any) {
      console.warn('Error during update check, continuing in offline mode:', err);
    } finally {
      if (showSplash) {
        setIsCheckingUpdate(false);
      }
    }
  }, []);

  // 1. Initial launch check (silent, non-blocking for offline readiness)
  useEffect(() => {
    runUpdateCheck(false);
  }, [runUpdateCheck]);

  // 2. Lifecycle check: When returning from installer or settings, recheck version silently
  useEffect(() => {
    const appStateSub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        if (updateResult.status === 'UPDATE_REQUIRED') {
          runUpdateCheck(false);
        }
      }
    });

    return () => appStateSub.remove();
  }, [updateResult.status, runUpdateCheck]);

  // Background auto-sync and update check on network reconnect & every 4 hours
  useEffect(() => {
    const triggerSyncIfOnline = async () => {
      try {
        const state = await NetInfo.fetch();
        if (state.isConnected && state.isInternetReachable !== false) {
          const res = await syncAllOfflineSubmissions();
          if (res.synced > 0 && Platform.OS === 'android') {
            ToastAndroid.show(
              `☁️ Synced ${res.synced} offline submission(s) to cloud!`,
              ToastAndroid.LONG,
            );
          }
        }
      } catch (e) {
        console.warn('Auto-sync error:', e);
      }
    };

    // Initial sync check on mount
    triggerSyncIfOnline();

    // Automatically trigger sync AND check for updates ONLY when internet comes
    const unsubscribeNet = NetInfo.addEventListener(state => {
      if (state.isConnected && state.isInternetReachable !== false) {
        triggerSyncIfOnline();
        runUpdateCheck(false);
      }
    });

    // Periodic trigger every 4 hours
    const fourHourTimer = setInterval(() => {
      triggerSyncIfOnline();
      runUpdateCheck(false);
    }, FOUR_HOURS_MS);

    // Trigger when app comes back to foreground
    const appStateSub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        triggerSyncIfOnline();
      }
    });

    return () => {
      unsubscribeNet();
      clearInterval(fourHourTimer);
      appStateSub.remove();
    };
  }, [runUpdateCheck]);

  // Restore saved session on app launch (allowed offline; only blocked if mandatory update required)
  useEffect(() => {
    if (updateResult.status === 'UPDATE_REQUIRED') return;

    const restoreSession = async () => {
      try {
        const saved = await AsyncStorage.getItem(SESSION_KEY);
        if (saved) {
          setCurrentVendor(JSON.parse(saved));
        }
      } catch (_) {
        // If restore fails, just show login
      } finally {
        setIsRestoringSession(false);
      }
    };
    restoreSession();
  }, [updateResult.status]);

  const handleLoginSuccess = async (vendor: VendorProfile) => {
    try {
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(vendor));
    } catch (_) {}
    setIsJustLoggedIn(true);
    setCurrentVendor(vendor);
  };

  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem(SESSION_KEY);
    } catch (_) {}
    setIsJustLoggedIn(false);
    setCurrentVendor(null);
  };

  // 1. Initial Update Verification Loading Screen (only if actively checking with splash)
  if (isCheckingUpdate) {
    return (
      <SafeAreaProvider>
        <View style={styles.splashContainer}>
          <View style={styles.splashLogoBadge}>
            <Image
              source={require('./src/assets/logo.png')}
              style={styles.splashLogo}
              resizeMode="contain"
            />
          </View>
          <ActivityIndicator size="large" color="#0284C7" />
          <Text style={styles.splashText}>Verifying application version...</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  // 2. Mandatory Update Required Gate (Blocks all app navigation & features when mandatory update exists)
  if (updateResult.status === 'UPDATE_REQUIRED' && updateResult.manifest) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <NetworkStatusBar />
          <MandatoryUpdateScreen
            manifest={updateResult.manifest}
            installedInfo={updateResult.installedInfo}
            onUpdateCompleted={() => {
              runUpdateCheck(false);
            }}
            onRetryCheck={() => runUpdateCheck(true)}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // 3. Session restoration screen (Only reached once verified or in offline mode)
  if (isRestoringSession) {
    return (
      <SafeAreaProvider>
        <View style={styles.splashContainer}>
          <ActivityIndicator size="large" color="#0284C7" />
        </View>
      </SafeAreaProvider>
    );
  }

  // 5. Existing Normal Application Tree
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {/* Real-time Network Connectivity Bar at Top of Every Screen */}
        <NetworkStatusBar />

        <View style={styles.container}>
          {currentVendor ? (
            <HomeScreen
              currentVendor={currentVendor}
              onLogout={handleLogout}
              isJustLoggedIn={isJustLoggedIn}
            />
          ) : (
            <LoginScreen onLoginSuccess={handleLoginSuccess} />
          )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  splashContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  splashLogoBadge: {
    width: 80,
    height: 80,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  splashLogo: {
    width: 52,
    height: 52,
  },
  splashText: {
    marginTop: 16,
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  checkFailedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  errorIconBadge: {
    marginBottom: 12,
  },
  errorIconText: {
    fontSize: 36,
  },
  failedTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  failedDesc: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  errorDetailCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 14,
    width: '100%',
    marginBottom: 24,
  },
  errorDetailText: {
    color: '#B91C1C',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#0284C7',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
