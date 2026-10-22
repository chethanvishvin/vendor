import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  ActivityIndicator,
  AppState,
  Platform,
  ToastAndroid,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { NetworkStatusBar } from './src/components/NetworkStatusBar';
import { VendorProfile } from './src/types';
import { syncAllOfflineSubmissions } from './src/db/sqliteService';

const SESSION_KEY = '@vendor_session';
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export default function App() {
  const [currentVendor, setCurrentVendor] = useState<VendorProfile | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  const [isJustLoggedIn, setIsJustLoggedIn] = useState(false);

  // Background auto-sync on network reconnect & every 4 hours
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

    // 1. Initial check on mount
    triggerSyncIfOnline();

    // 2. Automatically trigger when device comes online
    const unsubscribeNet = NetInfo.addEventListener(state => {
      if (state.isConnected && state.isInternetReachable !== false) {
        triggerSyncIfOnline();
      }
    });

    // 3. Periodic trigger every 4 hours
    const fourHourTimer = setInterval(() => {
      triggerSyncIfOnline();
    }, FOUR_HOURS_MS);

    // 4. Trigger when app comes back to foreground
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
  }, []);

  // Restore saved session on app launch
  useEffect(() => {
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
  }, []);

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

  if (isRestoringSession) {
    return (
      <SafeAreaProvider>
        <View style={styles.splashContainer}>
          <ActivityIndicator size="large" color="#0284C7" />
        </View>
      </SafeAreaProvider>
    );
  }

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
  },
});

